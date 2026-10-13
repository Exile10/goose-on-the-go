/** Remote access is contacted only after explicit user opt-in and local pairing. */
import { AppState, NativeModules } from 'react-native';
import { ApiError, api } from './api-client';
import { isLocalPairingUrl, normalizeHttpsUrl } from '@/models/connection';
import i18n from './i18n';

/** Setup cannot proceed until the operator configures remote infrastructure. */
/**
 * The pond will not replace this device's enrollment.
 *
 * Raised only from the recovery request, where a 409 means something specific:
 * the coordinator still calls this device active, so superseding it would be a
 * way to take over a live enrollment rather than repair a broken one. Revoking
 * the old enrollment first is what makes it replaceable, and signing out is
 * what queues that.
 *
 * Distinct from the 409 that enrollment raises, which means the opposite --
 * already enrolled, use recovery. Sharing one message between them told the
 * user to press the button they had just pressed.
 */
export class RemoteReplacementUnavailableError extends Error {
  constructor() {
    super(i18n.t('remote.replacementBlocked'));
    this.name = 'RemoteReplacementUnavailableError';
  }
}

export class RemoteInfrastructureUnavailableError extends Error {
  constructor() { super(i18n.t('remote.unconfigured')); this.name = 'RemoteInfrastructureUnavailableError'; }
}

type NativeStatus = { state: string; authUrl?: string; nodeKey?: string; machineKey?: string; addresses: string[] };
let generation = 0;
let busy = false;
let pendingRecovery: { endpoint: string; id: string } | null = null;
async function cancelPendingRecovery(): Promise<void> {
  const pending = pendingRecovery; pendingRecovery = null;
  if (pending) await api.requestLocal(pending.endpoint, `/api/v1/remote-access/recovery/${pending.id}`, { method: 'DELETE' })
    .catch(() => console.warn('[remote] recovery cancellation could not reach Pond; approval will expire'));
}
export type RemoteProgress = 'approval' | 'review' | 'enrolling' | 'connecting' | 'enabled';
const native = () => {
  if (!NativeModules.PondTls?.beginRemote) throw new Error(i18n.t('remote.unsupported'));
  return NativeModules.PondTls;
};
function status(raw: string): NativeStatus {
  const value = JSON.parse(raw) as NativeStatus;
  if (typeof value.state !== 'string' || !Array.isArray(value.addresses)) {
    console.warn('[remote] native status was not the expected shape:', raw.slice(0, 200));
    throw new Error(i18n.t('remote.failed'));
  }
  return value;
}
export async function cancelRemoteAccess(): Promise<void> {
  generation++;
  if (!busy) return;
  await cancelPendingRecovery();
  await native().cancelRemote();
}
export async function disableRemoteAccess(): Promise<void> {
  generation++;
  await cancelPendingRecovery();
  await native().disableRemote();
}
/**
 * `mkey:` and the first sixteen hex digits of a machine key, grouped in fours: what the
 * Pond's review shows beside a recovery request, so the two screens can be compared.
 */
export function machineKeyPreview(machineKey: string): string {
  const hex = machineKey.replace(/^mkey:/, '').slice(0, 16);
  return `mkey:${hex.match(/.{1,4}/g)?.join(' ') ?? ''}`;
}

export async function enableRemoteAccess(profileId: string, localUrl: string, progress: (value: RemoteProgress) => void,
  commit: (endpoint: string, control: string, current: () => void) => Promise<void>,
  /** `keyPreview` is what the Pond's review should show for this request. */
  recovery?: { onReview: (id: string, keyPreview: string) => void },
  /** When this device's remote access lapses if it does not come home. */
  onLapse?: (lapsesAt: string | null) => void): Promise<void> {
  if (busy) throw new Error(i18n.t('remote.busy'));
  if (!isLocalPairingUrl(localUrl)) throw new Error(i18n.t('pairing.lan'));
  const current = ++generation;
  busy = true;
  const check = () => {
    if (current !== generation || AppState.currentState !== 'active') throw new Error(i18n.t('remote.cancelled'));
  };
  let committed = false;
  try {
    check();
    const config = await api.requestLocal<{ enabled: boolean; controlUrl: string; lapsesAt?: string | null }>(localUrl, '/api/v1/remote-access/configuration');
    onLapse?.(config.lapsesAt ?? null);
    check();
    if (!config.controlUrl?.trim()) throw new RemoteInfrastructureUnavailableError();
    if (!config.enabled) { progress('approval'); throw new Error(i18n.t('remote.approval')); }
    const control = normalizeHttpsUrl(config.controlUrl);
    progress('enrolling');
    let state = status(await native().beginRemote(profileId, control));
    check();
    let submitted = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      check();
      if (state.state === 'Running') {
        progress('connecting');
        const info = await api.requestLocal<{ tailnet_address?: string; https_port?: number }>(localUrl, '/api/v1/system/info');
        check();
        const ip = info.tailnet_address?.split('.').map(Number);
        if (!ip || ip.length !== 4 || ip.some((n) => !Number.isInteger(n) || n < 0 || n > 255) || ip[0] !== 100 || ip[1] < 64 || ip[1] > 127 || !Number.isInteger(info.https_port) || info.https_port! < 1 || info.https_port! > 65535) {
          // Names both values: an IPv6-only tailnet address, or a missing port,
          // are indistinguishable from a malformed one in the message shown.
          console.warn('[remote] Pond reported an unusable tailnet endpoint:', JSON.stringify({ tailnet_address: info.tailnet_address, https_port: info.https_port }));
          throw new Error(i18n.t('remote.failed'));
        }
        // This address came from an authenticated request to the pinned local Pond.
        const endpoint = normalizeHttpsUrl(`https://${info.tailnet_address}:${info.https_port}`);
        check(); await commit(endpoint, control, check); committed = true;
        progress('enabled'); return;
      }
      if (state.authUrl && !submitted) {
        if (new URL(state.authUrl).origin !== control) {
          console.warn('[remote] node offered an authUrl for a different coordinator:', new URL(state.authUrl).origin, 'expected', control);
          throw new Error(i18n.t('remote.failed'));
        }
        submitted = true;
        // Never automatically replay this enrollment write after an ambiguous failure.
        const body = JSON.stringify({ authUrl: state.authUrl, nodeKey: state.nodeKey ?? '', machineKey: state.machineKey ?? '' });
        if (recovery) {
          const request = await api
            .requestLocal<{ id: string }>(localUrl, '/api/v1/remote-access/recovery', { method: 'POST', body })
            .catch((cause) => {
              if (cause instanceof ApiError && cause.status === 409) {
                throw new RemoteReplacementUnavailableError();
              }
              throw cause;
            });
          if (!/^[a-f0-9-]{36}$/.test(request.id)) throw new Error(i18n.t('remote.failed'));
          pendingRecovery = { endpoint: localUrl, id: request.id };
          check(); recovery.onReview(request.id, machineKeyPreview(state.machineKey ?? '')); progress('review');
          let approved = false;
          for (let reviewAttempt = 0; reviewAttempt < 24; reviewAttempt++) {
            check();
            const review = await api.requestLocal<{ approved: boolean }>(localUrl, `/api/v1/remote-access/recovery/${request.id}`);
            check();
            if (review.approved === true) { approved = true; break; }
            await new Promise<void>((resolve) => setTimeout(resolve, 5000));
          }
          if (!approved) throw new Error(i18n.t('remote.reviewExpired'));
          check(); progress('enrolling');
          // Only the current, still-authenticated LAN phone can consume approval.
          await api.requestLocal(localUrl, `/api/v1/remote-access/recovery/${request.id}`, { method: 'POST' });
          pendingRecovery = null;
        } else {
          await api.requestLocal(localUrl, '/api/v1/remote-access/enrollment', { method: 'POST', body });
        }
        check();
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      check(); state = status(await native().remoteStatus());
    }
    console.warn('[remote] node did not reach Running within the enrollment window; last state:', state.state);
    throw new Error(i18n.t('remote.failed'));
  } finally {
    await cancelPendingRecovery();
    busy = false;
    if (!committed) await native().cancelRemote().catch(() => console.warn('[remote] transport restoration failed'));
  }
}

/**
 * Bring the embedded node back if it did not survive the app being backgrounded.
 *
 * The node runs inside the app process, and nothing holds that process up: there is no
 * foreground service on Android and no background mode on iOS. So returning to the
 * foreground is the first moment the app can discover the node is gone.
 *
 * Nothing used to ask. `AppState` reaches `ConnectionManager.environment`, which re-probes
 * HTTP endpoints, and probing cannot tell a dead node from an unreachable Pond -- it simply
 * retries a tailnet address that no longer routes, for as long as the user is prepared to
 * wait. `restoreRemoteAccess` was called only at mount and at sign-out.
 *
 * Returns whether the transport was restarted, so the caller can re-probe immediately
 * rather than wait for the next scheduled attempt. A resume onto a healthy node costs one
 * bridge call.
 */
export async function resumeRemoteAccess(profileId: string, control: string): Promise<boolean> {
  // Local-only profiles have no node, and an enrollment in flight is already driving the
  // transport and must not have it pulled from under it.
  if (!control || busy) return false;
  const bridge = NativeModules.PondTls;
  if (!bridge?.remoteStatus || !bridge.activateRemote) return false;
  let running = false;
  try {
    running = status(await bridge.remoteStatus()).state === 'Running';
  } catch {
    // An unreadable status is not evidence of health, and the costs are asymmetric: a
    // needless restart is a moment, a missed one is no remote access until the next launch.
    console.warn('[remote] node status unreadable on resume; restarting transport');
  }
  if (running) return false;
  await restoreRemoteAccess(profileId, control);
  return true;
}

/** Restore transport before trust, credentials, health checks, or notification streams. */
export async function restoreRemoteAccess(profileId: string, control: string): Promise<void> {
  generation++;
  await cancelPendingRecovery();
  if (!NativeModules.PondTls?.activateRemote) {
    if (control) throw new Error(i18n.t('remote.unsupported'));
    return;
  }
  await NativeModules.PondTls.activateRemote(profileId, control);
}
