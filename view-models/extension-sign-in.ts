/**
 * Signing an extension in to a provider such as Spotify or Uber (#93).
 *
 * The Pond starts the sign-in and keeps the tokens: the provider sends the browser back to the
 * Pond, never to this phone. So the phone opens the provider's page, and once the person closes
 * it, asks the Pond how the sign-in went.
 */

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { api } from '@/services/api-client';
import type { OAuthSignInStatus } from '@/services/types';

/** How often the Pond is asked while it may still be swapping the provider's code for tokens. */
export const SIGN_IN_POLL_MS = 1_500;
/** How long it is asked after the page closes. The swap is one request from the Pond. */
export const SIGN_IN_SETTLE_MS = 15_000;

export type SignInOutcome = 'connected' | 'failed' | 'unfinished';

interface Clock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Ask until the sign-in ends or `settleMs` passes. A read that fails is asked again: the page
 * closing is the moment a phone on mobile data is most likely to be reconnecting. `unknown` is a
 * nonce the Pond no longer holds, so nothing more will come of it.
 */
export async function settleSignIn(
  read: () => Promise<OAuthSignInStatus>,
  settleMs = SIGN_IN_SETTLE_MS,
  clock: Clock = realClock,
): Promise<SignInOutcome> {
  const until = clock.now() + settleMs;
  for (;;) {
    const answer = await read().catch(() => null);
    if (answer?.status === 'completed') return 'connected';
    if (answer?.status === 'failed' || answer?.status === 'unknown') return 'failed';
    if (clock.now() + SIGN_IN_POLL_MS > until) return 'unfinished';
    await clock.sleep(SIGN_IN_POLL_MS);
  }
}

/**
 * Start a sign-in for `secretKey` on extension `extensionId`, show the provider's page, and say
 * how it ended. A refusal to start is thrown, for the caller to word.
 */
export async function signInExtension(secretKey: string, extensionId: string): Promise<SignInOutcome> {
  const started = await api.startOAuth(secretKey, extensionId);
  // An auth session rather than a plain browser: it resolves when the page is closed on both
  // platforms, where a plain browser resolves at once on Android. The return address is this
  // app's own, which the provider never sends the browser to, so closing the page is the signal.
  await WebBrowser.openAuthSessionAsync(started.auth_url, Linking.createURL('/extensions'));
  return settleSignIn(() => api.oauthStatus(started.state));
}
