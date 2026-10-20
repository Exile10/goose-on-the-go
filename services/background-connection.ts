/**
 * The notification stream, and the Android foreground service that keeps it
 * running after the user leaves the app.
 *
 * The stream used to belong to NotificationsProvider and stopped whenever the
 * app left the foreground. It lives here now, outside React, for one reason:
 * when Android destroys the activity -- the user swipes the app out of recents
 * -- React Native stops the surface and every provider unmounts, while the
 * process and its JavaScript runtime carry on under the foreground service. A
 * stream owned by a provider would stop exactly when it was meant to keep going.
 *
 * The provider still decides when the stream should run and supplies the
 * handlers that need the pairing (recover, revoke); with no provider mounted,
 * the stream keeps reconnecting with its own backoff and a refused token simply
 * stops it, leaving delivery to the push wake-up.
 *
 * iOS has no foreground services. There the stream runs only while the app is
 * open, and background delivery is the push wake-up alone.
 */

import { NativeModules, Platform } from 'react-native';

import i18n from './i18n';
import { api } from './api-client';
import { deliver, deliverAndAcknowledge } from './notification-delivery';
import { NotificationStream, type ServerNotification } from './notification-stream';
import { Storage } from './storage';

/** The inputs to the service decision; plain values so the rule can be tested on its own. */
export interface PresenceInputs {
  platform: string;
  /** A pairing is stored. */
  paired: boolean;
  /** The "Stay connected in the background" setting. */
  enabled: boolean;
}

/** Whether the foreground service should be running: Android, paired, and the setting on. */
export function shouldRunService({ platform, paired, enabled }: PresenceInputs): boolean {
  return platform === 'android' && paired && enabled;
}

/**
 * Whether the stream should stay open. Always in the foreground; in the
 * background only while the service holds the process.
 */
export function shouldHoldStream({ active, ...inputs }: PresenceInputs & { active: boolean }): boolean {
  return inputs.paired && (active || shouldRunService(inputs));
}

// --- The setting -----------------------------------------------------------

let enabled = true;
const settingListeners = new Set<(on: boolean) => void>();

/** The remembered choice. Nothing stored means on. */
export function stayConnectedEnabled(): boolean {
  return enabled;
}

/** Read the remembered choice at launch. */
export async function loadStayConnectedPreference(): Promise<boolean> {
  const stored = await Storage.get('stayConnected').catch(() => null);
  if (stored !== null) enabled = stored !== '0';
  return enabled;
}

/** The Settings switch: applies at once, tells whoever is listening, and is remembered on this phone. */
export async function saveStayConnectedPreference(next: boolean): Promise<void> {
  enabled = next;
  for (const listener of settingListeners) listener(next);
  await Storage.set('stayConnected', next ? '1' : '0').catch(() => {
    console.warn('[presence] setting could not be saved', { kind: 'background_connection' });
  });
}

/** Hear the setting change. Returns the unsubscribe. */
export function onStayConnectedChange(listener: (on: boolean) => void): () => void {
  settingListeners.add(listener);
  return () => { settingListeners.delete(listener); };
}

// --- The service -----------------------------------------------------------

interface PresenceBridge {
  start: (title: string, body: string, channelName: string, channelDescription: string) => Promise<boolean>;
  stop: () => Promise<boolean>;
}

function bridge(): PresenceBridge | null {
  return Platform.OS === 'android' ? ((NativeModules.PondPresence as PresenceBridge | undefined) ?? null) : null;
}

let serviceRunning = false;

/** Whether this runtime started the service and has not stopped it. */
export function presenceServiceRunning(): boolean {
  return serviceRunning;
}

/**
 * Start the service, or refresh its notification. Call from the foreground:
 * Android 12 and later refuse a start from the background, and the refusal is
 * logged and leaves delivery to the push wake-up.
 */
export async function startPresenceService(): Promise<boolean> {
  const native = bridge();
  if (!native) return false;
  try {
    await native.start(
      i18n.t('notifications.background.title'),
      i18n.t('notifications.background.body'),
      i18n.t('notifications.background.channel'),
      i18n.t('notifications.background.channelDescription'),
    );
    if (!serviceRunning) console.info('[presence] service started', { kind: 'background_connection' });
    serviceRunning = true;
    return true;
  } catch (e) {
    console.warn('[presence] service refused', { kind: 'background_connection', error: String(e) });
    serviceRunning = false;
    return false;
  }
}

export async function stopPresenceService(): Promise<void> {
  const native = bridge();
  if (!native || !serviceRunning) return;
  serviceRunning = false;
  try {
    await native.stop();
    console.info('[presence] service stopped', { kind: 'background_connection' });
  } catch (e) {
    console.warn('[presence] service could not be stopped', { kind: 'background_connection', error: String(e) });
  }
}

// --- The stream ------------------------------------------------------------

export interface LinkTarget { baseUrl: string; token: string; deviceId: string }

/** The provider that owns the pairing; absent while the React tree is unmounted. */
export interface LinkOwner {
  onDisconnect: () => void;
  onAuthFailure: () => void;
}

let stream: NotificationStream | null = null;
let streamKey = '';
let owner: LinkOwner | null = null;

/** Attach or detach the provider that owns the pairing. */
export function setLinkOwner(next: LinkOwner | null): void {
  owner = next;
}

/** Open the stream to `target`, or keep the one already open to it. */
export function connectLink(target: LinkTarget): void {
  const key = `${target.baseUrl}|${target.deviceId}|${target.token}`;
  if (stream && key === streamKey) return;
  stream?.stop();
  streamKey = key;
  const opened = new NotificationStream({
    ...target,
    onDisconnect: () => owner?.onDisconnect(),
    onAuthFailure: () => {
      // The stream has stopped itself; forgetting it lets the same target be connected again.
      if (stream === opened) disconnectLink();
      if (owner) { owner.onAuthFailure(); return; }
      // Nobody here can refresh the token or clear the pairing.
      console.warn('[presence] stream refused with no app to refresh it', { kind: 'background_connection' });
    },
    onNotification: (n) => { void presentFromStream(n); },
  });
  stream = opened;
  stream.start();
}

/** Close the stream. */
export function disconnectLink(): void {
  stream?.stop();
  stream = null;
  streamKey = '';
}

async function presentFromStream(n: ServerNotification): Promise<void> {
  // Acknowledged, repeats included, so the Pond stops re-sending it on every connection. Only
  // through a client whose token rotation is persisted: see PondApiClient.hasSession.
  if (api.hasSession) await deliverAndAcknowledge(api, n, 'stream');
  else await deliver(n);
}
