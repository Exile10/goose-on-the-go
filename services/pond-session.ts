/**
 * Reaching the paired Pond without the React tree.
 *
 * A push wake-up can start the app's JavaScript headless, with no
 * ServerProvider to have restored the pairing. This restores it the way the
 * provider does at launch -- the saved identity and addresses, the remote
 * transport, native pinning, then an endpoint chosen by the same
 * ConnectionManager -- onto the shared `api` client, and nothing more: no
 * state, no banner, no heartbeat.
 */

import { api, PondApiClient } from './api-client';
import { ConnectionManager } from './connection-manager';
import { loadPairedProfile } from './paired-profile';
import { configurePondTrust, PondTrustError } from './pond-trust';
import { remoteNodeRunning, restoreRemoteAccess } from './remote-access';
import { SecureStorage } from './secure-storage';

/** Pin every address of a pairing to its key. Shared with ServerProvider. */
export const trustPond = (urls: string[], pin: string) => configurePondTrust(urls.map((url) => ({ url, pin })));

/** Whether a Pond answers at `url`, throwing when it answers with the wrong key. Shared with ServerProvider. */
export const probePond = async (url: string) => {
  const result = await new PondApiClient(url).health();
  if (result.trustFailure) throw new PondTrustError();
  return result.ok;
};

/**
 * Make `api` ready to call the paired Pond. Returns false when there is no
 * pairing or no endpoint answers. Never throws.
 *
 * When `api` already holds a session, the app is running and its provider owns
 * the pairing; this leaves it alone rather than racing it with a second copy
 * (see `PondApiClient.hasSession`).
 */
export async function ensurePondSession(): Promise<boolean> {
  if (api.hasSession) return true;
  try {
    const { saved } = await loadPairedProfile();
    if (!saved) {
      console.info('[session] no pairing to restore', { kind: 'background_session' });
      return false;
    }
    const remote = saved.profile.remoteAccess;
    try {
      await restoreRemoteAccess(saved.identity.id, remote?.mode === 'embedded' ? remote.controlUrl : '');
    } catch {
      console.warn('[session] remote transport unavailable; trying local addresses', { kind: 'background_session' });
    }
    const manager = new ConnectionManager({
      probe: probePond,
      trust: trustPond,
      remoteReady: remoteNodeRunning,
      // No mDNS in a headless start: the saved addresses and the tailnet are what it has.
      discover: async () => null,
      changed: (next) => { if (next.url) api.setBaseUrl(next.url); },
    });
    await manager.configure(saved.profile, saved.identity.pin);
    // A refresh here rotates the pair, and the app would otherwise wake up holding a dead refresh token.
    let identity = saved.identity;
    api.setOnTokensRotated((session, refresh) => {
      identity = { ...identity, session, refresh };
      SecureStorage.set('pondIdentity', JSON.stringify(identity)).catch(() => {
        console.warn('[session] rotated credentials could not be saved', { kind: 'background_session' });
      });
    });
    // Endpoints are probed without a bearer token, so the tokens go on only once one answers:
    // a client left holding a session and no endpoint would read as restored to the next wake-up.
    const url = await manager.recover(true);
    if (!url) {
      console.warn('[session] no endpoint answered', { kind: 'background_session' });
      return false;
    }
    api.setToken(saved.identity.session);
    api.setRefreshToken(saved.identity.refresh);
    console.info('[session] restored', { kind: 'background_session' });
    return true;
  } catch (e) {
    console.warn('[session] could not restore the pairing', { kind: 'background_session', error: String(e) });
    return false;
  }
}
