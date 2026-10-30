/**
 * A Pond client for work that runs with no screen up, such as a push wake.
 *
 * When the app is already running, the shared client is signed in and its
 * connection manager knows the route, so that is the one to use. A cold start
 * for a push has neither: the OS launched the bundle only to run the task. Then
 * the saved pairing is read and the Pond is tried at its home addresses with the
 * same pin. The embedded remote-access node is not started for this (#50), so a
 * phone away from home that was not already running reaches nothing here.
 *
 * The background client never refreshes its session. Refreshing rotates the
 * refresh token, and the app starting up at the same moment would present the
 * old one and be treated as revoked. An expired session just means this wake
 * shows less; the next time the app opens it refreshes as usual.
 */

import { api, PondApiClient } from './api-client';
import { loadPairedProfile } from './paired-profile';
import { configurePondTrust } from './pond-trust';

export async function pondForBackground(): Promise<PondApiClient | null> {
  if (api.signedIn) return api;
  const { saved } = await loadPairedProfile();
  if (!saved) return null;
  const { profile, identity } = saved;
  // The manager's own set, so a provider mounting alongside is not left without its remote pin.
  const remote = profile.remoteAccess?.mode === 'embedded' && profile.remoteUrl ? [profile.remoteUrl] : [];
  await configurePondTrust([...profile.localUrls, ...remote].map((url) => ({ url, pin: identity.pin })));
  for (const url of profile.localUrls) {
    const client = new PondApiClient(url);
    if (!(await client.health()).ok) continue;
    client.setToken(identity.session);
    return client;
  }
  return null;
}
