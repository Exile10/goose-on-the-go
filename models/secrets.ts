/**
 * The Pond's secret store, as the Secrets screen reads it.
 *
 * The Pond keeps API keys, tokens and client IDs for outside services under a flat key name, and
 * `GET /api/v1/secrets` lists the names only. Nothing here models a value: a value exists on the
 * phone only as what somebody typed, until the Pond has it.
 *
 * The routes need a paired session and nothing more, so any paired phone may list, set and delete.
 * The one exception is the keys members' Uber sign-ins live under (`UBER_` and anything after it):
 * the listing leaves them out and every other route answers 403 `secret_reserved`, because those
 * are managed only on the Pond itself.
 */

import { ApiError } from '@/services/api-client';
import type { TranslationKey } from '@/services/i18n';

/** The `code` the Pond puts on its 403 for a member's Uber key. */
export const SECRET_RESERVED_CODE = 'secret_reserved';

/**
 * Names for the keys the Pond's own catalogue and services store, as the dashboard shows them
 * from the catalogue's `display_name`. A key not listed here is shown as its own name.
 */
const KNOWN_LABELS: Readonly<Record<string, TranslationKey>> = {
  GITHUB_PERSONAL_ACCESS_TOKEN: 'secrets.known.github',
  BRAVE_API_KEY: 'secrets.known.braveExtension',
  BRAVE_SEARCH_API_KEY: 'secrets.known.braveWebSearch',
  WOLFRAM_APP_ID: 'secrets.known.wolfram',
  SLACK_BOT_TOKEN: 'secrets.known.slack',
  MUSIC_SERVICE: 'secrets.known.musicService',
  MUSIC_PLAYER: 'secrets.known.musicPlayer',
  SPOTIFY_CLIENT_ID: 'secrets.known.spotifyClientId',
  SPOTIFY_ACCESS_TOKEN: 'secrets.known.spotifySignIn',
  SPOTIFY_REFRESH_TOKEN: 'secrets.known.spotifyRefresh',
  APPLE_MUSIC_TEAM_ID: 'secrets.known.appleTeamId',
  APPLE_MUSIC_KEY_ID: 'secrets.known.appleKeyId',
  APPLE_MUSIC_PRIVATE_KEY: 'secrets.known.applePrivateKey',
};

/** The catalogue key for a stored key's friendly name, or null when the Pond's name is all there is. */
export function secretLabelKey(key: string): TranslationKey | null {
  return Object.prototype.hasOwnProperty.call(KNOWN_LABELS, key) ? KNOWN_LABELS[key] : null;
}

/** The longest key name the screen will send. The Pond sets no limit; a path segment should. */
export const SECRET_KEY_MAX = 128;

/**
 * Whether `key` is a name the screen will send: the environment-variable shape every key the Pond
 * itself stores has. The Pond would take more, but a name with spaces or slashes is a typo here,
 * and an extension could never read it from its environment.
 */
export function isValidSecretKey(key: string): boolean {
  return key.length <= SECRET_KEY_MAX && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key);
}

/** The Pond's 403 for a member's Uber key, which says where that key is managed instead. */
export function isReservedRefusal(e: unknown): boolean {
  if (!(e instanceof ApiError) || e.status !== 403) return false;
  const body = e.body as { code?: unknown } | null;
  return body !== null && typeof body === 'object' && body.code === SECRET_RESERVED_CODE;
}
