/**
 * A phone waiting on a locked Pond asks every three seconds and no faster, one request at a
 * time, and stops the moment it is answered, the request runs out, or the screen lets go.
 */

import type { HeldPairing } from '@/models/pairing-lock';
import { ApiError, type HandshakeResponse, type PairingClaim } from '@/services/api-client';
import { CLAIM_EVERY_MS, waitForPairing } from '@/services/pairing-request';

const T0 = Date.parse('2026-11-13T10:00:00Z');
const held: HeldPairing = { requestId: 'req-1', claimSecret: 'secret', expiresAt: '2026-11-13T10:10:00Z' };
const tokens = { accepted: true, session_token: 's', refresh_token: 'r' } as HandshakeResponse;

/** A clock the sleeps move, and the waits they were asked for. */
function clock() {
  let now = T0;
  const waits: number[] = [];
  return {
    waits,
    now: () => now,
    sleep: async (ms: number) => {
      waits.push(ms);
      now += ms;
    },
  };
}

const answers = (...list: (PairingClaim | Error)[]) => {
  const claim = jest.fn(async (_held: HeldPairing): Promise<PairingClaim> => {
    const next = list.shift() ?? { status: 'waiting' as const };
    if (next instanceof Error) throw next;
    return next;
  });
  return claim;
};

describe('waitForPairing', () => {
  it('asks again every three seconds while the Pond says to wait, and stops on the pairing', async () => {
    const time = clock();
    const claim = answers({ status: 'waiting' }, { status: 'waiting' }, { status: 'paired', response: tokens });

    const outcome = await waitForPairing(held, { claim, ...time }, new AbortController().signal);

    expect(outcome).toEqual({ status: 'paired', response: tokens });
    expect(claim).toHaveBeenCalledTimes(3);
    expect(claim).toHaveBeenCalledWith(held);
    expect(time.waits).toEqual([CLAIM_EVERY_MS, CLAIM_EVERY_MS]);
  });

  it.each(['declined', 'gone'] as const)('stops on %s without asking again', async (status) => {
    const time = clock();
    const claim = answers({ status });
    await expect(waitForPairing(held, { claim, ...time }, new AbortController().signal)).resolves.toEqual({ status });
    expect(claim).toHaveBeenCalledTimes(1);
    expect(time.waits).toEqual([]);
  });

  it('gives up when the request runs out, having asked no more than once every three seconds', async () => {
    const time = clock();
    const claim = answers();

    const outcome = await waitForPairing(held, { claim, ...time }, new AbortController().signal);

    expect(outcome).toEqual({ status: 'gone' });
    // Ten minutes at three seconds apart.
    expect(claim).toHaveBeenCalledTimes(200);
  });

  it('asks nothing of a request that has already run out', async () => {
    const time = clock();
    const claim = answers();
    const stale = { ...held, expiresAt: '2026-11-13T09:59:00Z' };
    await expect(waitForPairing(stale, { claim, ...time }, new AbortController().signal)).resolves.toEqual({ status: 'gone' });
    expect(claim).not.toHaveBeenCalled();
  });

  it('keeps asking through no answer at all, and through a Pond in trouble', async () => {
    const time = clock();
    const claim = answers(new TypeError('Network request failed'), new ApiError('claim → 503', 503, null), { status: 'declined' });
    await expect(waitForPairing(held, { claim, ...time }, new AbortController().signal)).resolves.toEqual({ status: 'declined' });
    expect(claim).toHaveBeenCalledTimes(3);
    expect(time.waits).toEqual([CLAIM_EVERY_MS, CLAIM_EVERY_MS]);
  });

  it('waits as long as a rate limit asks before it asks again', async () => {
    const time = clock();
    const claim = answers(new ApiError('claim → 429', 429, 20), { status: 'declined' });
    await waitForPairing(held, { claim, ...time }, new AbortController().signal);
    expect(time.waits).toEqual([20_000]);
  });

  it('stops on a refusal that is not about the request, and hands it back', async () => {
    const time = clock();
    const refusal = new ApiError('claim → 403', 403, null);
    const claim = answers(refusal);
    await expect(waitForPairing(held, { claim, ...time }, new AbortController().signal)).resolves.toEqual({ status: 'refused', error: refusal });
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('asks nothing more once the screen lets go, even of a request already in flight', async () => {
    const stop = new AbortController();
    const time = clock();
    const claim = jest.fn(async (): Promise<PairingClaim> => {
      stop.abort();
      return { status: 'paired', response: tokens };
    });
    await expect(waitForPairing(held, { claim, ...time }, stop.signal)).resolves.toEqual({ status: 'stopped' });
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('waits ten minutes at most when the Pond named no deadline it can read', async () => {
    const time = clock();
    const claim = answers();
    await waitForPairing({ ...held, expiresAt: '' }, { claim, ...time }, new AbortController().signal);
    expect(claim).toHaveBeenCalledTimes(200);
  });
});
