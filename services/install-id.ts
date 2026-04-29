/**
 * Stable per-install identifier used as `client_id` in every GIAP handshake.
 *
 * Generated lazily on first use and persisted to SecureStorage. Reusing the
 * same UUID across re-pairings lets the server recognize a returning device
 * (so it can revoke prior sessions instead of creating a duplicate row).
 *
 * The value is opaque and not personally identifying; rotating it manually
 * (via `resetInstallId`) is safe — the server treats the next handshake as
 * a brand-new device.
 */

import { SecureStorage } from './secure-storage';

let cached: string | null = null;
let pending: Promise<string> | null = null;

function uuidV4(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function getInstallId(): Promise<string> {
  if (cached) return cached;
  if (pending) return pending;
  pending = (async () => {
    const stored = await SecureStorage.get('installId');
    if (stored) {
      cached = stored;
      return stored;
    }
    const fresh = uuidV4();
    await SecureStorage.set('installId', fresh);
    cached = fresh;
    return fresh;
  })();
  try {
    return await pending;
  } finally {
    pending = null;
  }
}

export async function resetInstallId(): Promise<string> {
  cached = null;
  await SecureStorage.remove('installId');
  return getInstallId();
}
