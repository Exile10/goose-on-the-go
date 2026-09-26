/** Atomic secure identity commit with separately stored, non-secret addresses. */
import { Storage } from './storage';
import { SecureStorage } from './secure-storage';
import { parseConnectionProfile, validPin, type ConnectionProfile } from '@/models/connection';

export interface PondIdentity { id: string; pin: string; session: string; refresh: string | null; profileKey?: string }
export interface SavedPond { identity: PondIdentity; profile: ConnectionProfile }

export async function loadPairedProfile(): Promise<{ saved: SavedPond | null; upgrade: boolean }> {
  const [secure, addresses, legacy] = await Promise.all([
    SecureStorage.get('pondIdentity'), Storage.get('connectionProfile'), Storage.get('serverUrl'),
  ]);
  try {
    const identity = secure ? JSON.parse(secure) as PondIdentity : null;
    const records = addresses ? JSON.parse(addresses) as Record<string, unknown> : {};
    const profile = identity ? parseConnectionProfile(records[identity.profileKey ?? identity.id]) : null;
    if (identity && typeof identity.pin === 'string' && validPin(identity.pin) &&
        typeof identity.id === 'string' && typeof identity.session === 'string' && identity.session &&
        (identity.refresh === null || typeof identity.refresh === 'string') && profile) {
      return { saved: { identity, profile }, upgrade: false };
    }
  } catch { /* Corrupt or old profiles require a local rescan, never HTTP bootstrap. */ }
  return { saved: null, upgrade: !!legacy || !!secure };
}

export async function commitPairedProfile(previous: SavedPond | null, next: SavedPond): Promise<SavedPond> {
  // The SecureStore record selects one address revision. Replacing addresses for the
  // same pairing must not change the previous profile before this commit succeeds.
  const profileKey = `${next.identity.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  next = { ...next, identity: { ...next.identity, profileKey } };
  const records = previous ? { [previous.identity.profileKey ?? previous.identity.id]: previous.profile, [profileKey]: next.profile }
    : { [profileKey]: next.profile };
  await Storage.set('connectionProfile', JSON.stringify(records));
  // A failure before this atomic secure write leaves the old identity and its addresses usable.
  await SecureStorage.set('pondIdentity', JSON.stringify(next.identity));
  return next;
}
