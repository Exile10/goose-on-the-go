/**
 * The loop every live screen polls through.
 *
 * The app used to read the Pond once, when a screen mounted, so Now Playing showed a track from
 * ten minutes earlier while another played. Polling fixes that, and polling is also how a client
 * denies itself service: the Pond rate-limits per IP, and a runaway loop once spent the whole
 * budget in seconds and locked this phone out of `/handshake`. Each rule below is one of the
 * things that keeps a poll a poll.
 */
import { MIN_POLL_MS, liveLoop } from '../use-live';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/** A read that resolves at once, counting its calls. */
function counter() {
  const calls = { n: 0 };
  return { calls, read: async () => { calls.n += 1; } };
}

it('reads as soon as it starts, so a screen shows current data on arrival', async () => {
  const { calls, read } = counter();
  liveLoop(read, () => 10_000).start();
  await jest.advanceTimersByTimeAsync(0);
  expect(calls.n).toBe(1);
});

it('reads again after the delay, and not before', async () => {
  const { calls, read } = counter();
  liveLoop(read, () => 10_000).start();
  await jest.advanceTimersByTimeAsync(9_999);
  expect(calls.n).toBe(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(calls.n).toBe(2);
});

// Backoff depends on what the last read said, so the delay is asked for after every read.
it('asks for the delay after each read, so a source can back off', async () => {
  const { calls, read } = counter();
  const delays = [10_000, 300_000];
  liveLoop(read, () => delays.shift() ?? 300_000).start();
  await jest.advanceTimersByTimeAsync(10_000);
  expect(calls.n).toBe(2);
  await jest.advanceTimersByTimeAsync(299_999);
  expect(calls.n).toBe(2);
  await jest.advanceTimersByTimeAsync(1);
  expect(calls.n).toBe(3);
});

// setInterval would fire regardless, stacking requests behind a slow Pond.
it('never starts a read while the last one is still out', async () => {
  let resolve: () => void = () => {};
  let calls = 0;
  const read = () => { calls += 1; return new Promise<void>((r) => { resolve = r; }); };
  liveLoop(read, () => 10_000).start();
  await jest.advanceTimersByTimeAsync(60_000);
  expect(calls).toBe(1);
  resolve();
  await jest.advanceTimersByTimeAsync(10_000);
  expect(calls).toBe(2);
});

it('stops reading when stopped, including after a read that was already out', async () => {
  let resolve: () => void = () => {};
  let calls = 0;
  const read = () => { calls += 1; return new Promise<void>((r) => { resolve = r; }); };
  const loop = liveLoop(read, () => 10_000);
  loop.start();
  await jest.advanceTimersByTimeAsync(0);
  loop.stop();
  resolve();
  await jest.advanceTimersByTimeAsync(0);
  // Nothing left scheduled, not merely nothing read: a stopped loop should not keep the app's
  // JS thread waking up in the background for a tick that will only return.
  expect(jest.getTimerCount()).toBe(0);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(calls).toBe(1);
});

// The next tick is the retry. A failure must not end the loop, and must not be retried sooner.
it('keeps its cadence through a read that fails', async () => {
  let calls = 0;
  const read = async () => { calls += 1; throw new Error('offline'); };
  liveLoop(read, () => 10_000).start();
  await jest.advanceTimersByTimeAsync(5_000);
  expect(calls).toBe(1);
  await jest.advanceTimersByTimeAsync(5_000);
  expect(calls).toBe(2);
});

// A zero, a negative or a NaN from a buggy delay function must not become a flood.
it('never polls faster than its floor, whatever it is asked for', async () => {
  for (const bad of [0, -1, Number.NaN]) {
    const { calls, read } = counter();
    const loop = liveLoop(read, () => bad);
    loop.start();
    await jest.advanceTimersByTimeAsync(MIN_POLL_MS - 1);
    expect(calls.n).toBe(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(calls.n).toBe(2);
    loop.stop();
  }
});

// Focus and foreground can both say "start" for the same screen.
it('runs one loop however many times it is started', async () => {
  const { calls, read } = counter();
  const loop = liveLoop(read, () => 10_000);
  loop.start();
  loop.start();
  await jest.advanceTimersByTimeAsync(0);
  loop.start();
  await jest.advanceTimersByTimeAsync(10_000);
  expect(calls.n).toBe(2);
});

it('reads at once when restarted, as a screen returned to should', async () => {
  const { calls, read } = counter();
  const loop = liveLoop(read, () => 10_000);
  loop.start();
  await jest.advanceTimersByTimeAsync(0);
  loop.stop();
  loop.start();
  await jest.advanceTimersByTimeAsync(0);
  expect(calls.n).toBe(2);
});
