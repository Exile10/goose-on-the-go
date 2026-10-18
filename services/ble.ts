/**
 * The Pond's BLE setup service (pond-setup-channel.md, "Advertising" and "GATT"), through the
 * `PondBle` native module in plugins/pond-ble. The module is a byte pipe; everything that makes it
 * a setup channel is in services/setup-channel.
 *
 * Absent in Expo Go and on the web, and present but `unsupported` on the iOS simulator, which has
 * no Bluetooth. Every caller has the card and the network to fall back on.
 */

import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';

import { cardIdOf, SETUP_ADVERT_PREFIX, setupAdvertUuid } from '@/models/nearby-pond';
import type { SetupLink } from './setup-channel/session';
import { fromBase64, toBase64 } from './setup-channel/sealing';

export const SETUP_SERVICE_UUID = '185b51bd-e038-4b6c-99b0-4e2379dd362c';
// The advertised UUID carries the card id in its last two bytes; the GATT service is always the one above.
const ADVERT_BASE = `${SETUP_ADVERT_PREFIX}0000`;
const ADVERT_MASK = 'ffffffff-ffff-ffff-ffff-ffffffff0000';
export const RX_UUID = '72172de5-d65e-47ad-857d-1b9dd7623d33';
export const TX_UUID = '1065b140-d075-431c-b981-7e1a735960cb';

/** Bluetooth could not be opened to a Pond: out of range, switched off, or it refused the link. */
export class BleUnreachableError extends Error {
  constructor(cause: unknown) {
    super(`Pond not reachable over Bluetooth: ${cause instanceof Error ? cause.message : 'not heard'}`);
    this.name = 'BleUnreachableError';
  }
}

/** The Pond answered with another card id than it advertised: not the Pond that was picked. */
export class WrongPondError extends Error {
  constructor(advertised: string, answered: string) {
    super(`advertised as ${advertised}, answered as ${answered}`);
    this.name = 'WrongPondError';
  }
}

export type BleState = 'on' | 'off' | 'unauthorized' | 'unsupported' | 'unknown';

export interface BleSighting {
  /** The phone's handle for the advertiser: an address on Android, a UUID on iOS. */
  peripheral: string;
  /** The advertised setup service UUIDs, whose last two bytes are the card's id. */
  services: string[];
  /** The advertised local name, a label only: it rides in a scan response that may never come. */
  name: string | null;
  rssi: number;
}

interface PondBleModule {
  state(): Promise<BleState>;
  startScan(service: string, mask: string | null): Promise<void>;
  stopScan(): Promise<void>;
  connect(id: string, service: string, rx: string, tx: string): Promise<{ writeSize: number }>;
  write(id: string, value: string): Promise<void>;
  disconnect(id: string): Promise<void>;
}

const native = (NativeModules.PondBle ?? null) as PondBleModule | null;
let emitter: NativeEventEmitter | null = null;

function events(): NativeEventEmitter | null {
  if (!native) return null;
  emitter ??= new NativeEventEmitter(NativeModules.PondBle);
  return emitter;
}

export function bleAvailable(): boolean {
  return native !== null && (Platform.OS === 'ios' || Platform.OS === 'android');
}

/**
 * Ask for what a scan needs, in context. Android 12 and later name Bluetooth scanning and
 * connecting; older Android only lets a scan see anything with location. iOS asks by itself the
 * first time the module touches Bluetooth.
 */
export async function requestBlePermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const wanted = Number(Platform.Version) >= 31
    ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const answers = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => answers[p] === PermissionsAndroid.RESULTS.GRANTED);
}

export async function bleState(): Promise<BleState> {
  if (!bleAvailable() || !native) return 'unsupported';
  try {
    return await native.state();
  } catch {
    return 'unknown';
  }
}

export function onBleState(listener: (state: BleState) => void): () => void {
  const sub = events()?.addListener('PondBleState', (e: { state: BleState }) => listener(e.state));
  return () => sub?.remove();
}

/**
 * Scan for setup advertisements until the returned stop is called: every card id, or only `cardId`'s.
 * One scan at a time.
 */
export async function scanForPonds(
  onSighting: (sighting: BleSighting) => void,
  onFailed: () => void,
  cardId?: string,
): Promise<() => void> {
  if (!native) throw new Error('Bluetooth is not available in this build');
  const subs = [
    events()?.addListener('PondBleDiscovered', (e: { id: string; name: string | null; services?: string[]; rssi: number }) =>
      onSighting({ peripheral: e.id, services: e.services ?? [], name: e.name ?? null, rssi: e.rssi })),
    events()?.addListener('PondBleScanFailed', () => onFailed()),
  ];
  try {
    await (cardId ? native.startScan(setupAdvertUuid(cardId), null) : native.startScan(ADVERT_BASE, ADVERT_MASK));
  } catch (e) {
    subs.forEach((s) => s?.remove());
    throw e;
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    subs.forEach((s) => s?.remove());
    void native.stopScan().catch(() => undefined);
  };
}

/** Connect to one advertiser and hand back its setup service as an ordered byte link. */
export async function connectPond(peripheral: string): Promise<SetupLink> {
  if (!native) throw new Error('Bluetooth is not available in this build');
  const source = events();
  const dataListeners = new Set<(bytes: Uint8Array) => void>();
  const closeListeners = new Set<(error?: Error) => void>();
  let closed = false;
  // Listening first, so a notification sent the moment the Pond sees the subscription is not lost.
  const subs = [
    source?.addListener('PondBleData', (e: { id: string; value: string }) => {
      if (e.id !== peripheral || closed) return;
      let bytes: Uint8Array;
      try {
        bytes = fromBase64(e.value);
      } catch {
        return;
      }
      dataListeners.forEach((l) => l(bytes));
    }),
    source?.addListener('PondBleDisconnected', (e: { id: string; reason: string }) => {
      if (e.id !== peripheral || closed) return;
      closed = true;
      subs.forEach((s) => s?.remove());
      closeListeners.forEach((l) => l(new Error(e.reason)));
    }),
  ];
  let writeSize: number;
  try {
    ({ writeSize } = await native.connect(peripheral, SETUP_SERVICE_UUID, RX_UUID, TX_UUID));
  } catch (e) {
    closed = true;
    subs.forEach((s) => s?.remove());
    throw e;
  }
  return {
    // ATT's floor is 23, so 20 is always safe if a platform reports nothing usable.
    writeSize: Number.isInteger(writeSize) && writeSize >= 20 ? writeSize : 20,
    write: (bytes) => (closed ? Promise.reject(new Error('link closed')) : native.write(peripheral, toBase64(bytes))),
    onData(listener) {
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },
    onClose(listener) {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    async close() {
      if (closed) return;
      closed = true;
      subs.forEach((s) => s?.remove());
      await native.disconnect(peripheral).catch(() => undefined);
    },
  };
}

/**
 * Scan until the Pond advertising `cardId` is heard, then stop: how a phone finds again a Pond it
 * was talking to. Null when it is not heard within `timeoutMs`, or Bluetooth is not on.
 */
export async function findPondById(cardId: string, timeoutMs = 20_000): Promise<string | null> {
  if ((await bleState()) !== 'on') return null;
  return new Promise((resolve) => {
    let done = false;
    let stop: (() => void) | null = null;
    const finish = (peripheral: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop?.();
      resolve(peripheral);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    scanForPonds(
      (s) => {
        if (cardIdOf(s) === cardId) finish(s.peripheral);
      },
      () => finish(null),
      cardId,
    )
      .then((next) => {
        stop = next;
        if (done) next();
      })
      .catch(() => finish(null));
  });
}
