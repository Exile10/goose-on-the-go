/**
 * Waiting on an extension sign-in once its page has closed: when it counts as connected, failed,
 * or still unfinished, and that a missed read is asked again rather than taken as an answer.
 */

import { api } from '@/services/api-client';
import type { OAuthSignInStatus } from '@/services/types';
import { SIGN_IN_POLL_MS, settleSignIn, signInExtension } from '@/view-models/extension-sign-in';
import * as WebBrowser from 'expo-web-browser';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { startOAuth: jest.fn(), oauthStatus: jest.fn() } };
});
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `gooseonthego://${path.replace(/^\//, '')}` }));

const pond = jest.mocked(api);

beforeEach(() => {
  jest.clearAllMocks();
});

/** A clock the waiting moves forward, so no test sleeps for real. */
function fakeClock() {
  let at = 0;
  return {
    now: () => at,
    sleep: async (ms: number) => {
      at += ms;
    },
    get elapsed() {
      return at;
    },
  };
}

function answers(...list: (OAuthSignInStatus | Error)[]) {
  const read = jest.fn<Promise<OAuthSignInStatus>, []>();
  for (const a of list) {
    if (a instanceof Error) read.mockRejectedValueOnce(a);
    else read.mockResolvedValueOnce(a);
  }
  return read;
}

describe('settleSignIn', () => {
  it('is connected once the Pond says the sign-in completed', async () => {
    const read = answers({ status: 'pending' }, { status: 'completed' });
    await expect(settleSignIn(read, 15_000, fakeClock())).resolves.toBe('connected');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('fails on a failed or forgotten sign-in, without asking again', async () => {
    await expect(settleSignIn(answers({ status: 'failed', error: 'denied' }), 15_000, fakeClock())).resolves.toBe('failed');
    const forgotten = answers({ status: 'unknown' });
    await expect(settleSignIn(forgotten, 15_000, fakeClock())).resolves.toBe('failed');
    expect(forgotten).toHaveBeenCalledTimes(1);
  });

  it('asks again after a read that got no answer', async () => {
    const read = answers(new TypeError('Network request failed'), { status: 'completed' });
    await expect(settleSignIn(read, 15_000, fakeClock())).resolves.toBe('connected');
  });

  it('is unfinished when the sign-in is still pending at the end of the wait', async () => {
    const clock = fakeClock();
    const read = jest.fn().mockResolvedValue({ status: 'pending' });
    await expect(settleSignIn(read, 6_000, clock)).resolves.toBe('unfinished');
    expect(clock.elapsed).toBeLessThanOrEqual(6_000);
    expect(read).toHaveBeenCalledTimes(Math.floor(6_000 / SIGN_IN_POLL_MS) + 1);
  });
});

describe('signInExtension', () => {
  it('opens the page the Pond gives and asks by its nonce', async () => {
    pond.startOAuth.mockResolvedValue({ auth_url: 'https://accounts.spotify.com/authorize?x=1', state: 'n1' });
    pond.oauthStatus.mockResolvedValue({ status: 'completed' });

    await expect(signInExtension('spotify_token', 'music')).resolves.toBe('connected');
    expect(pond.startOAuth).toHaveBeenCalledWith('spotify_token', 'music');
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://accounts.spotify.com/authorize?x=1',
      'gooseonthego://extensions',
    );
    expect(pond.oauthStatus).toHaveBeenCalledWith('n1');
  });

  it('opens nothing when the Pond refuses to start', async () => {
    pond.startOAuth.mockRejectedValue(new Error('refused'));
    await expect(signInExtension('spotify_token', 'music')).rejects.toThrow('refused');
    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });
});
