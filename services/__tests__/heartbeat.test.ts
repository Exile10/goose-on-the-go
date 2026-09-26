/**
 * When the phone tells the Pond it is still here.
 *
 * The first version skipped the beat a cold start was meant to send. It fired as soon as the
 * paired identity loaded, and at that moment two things could still be unsettled: the base URL,
 * which the connection manager sets only once a probe reaches the Pond, and AppState, which on an
 * Android cold start can read 'unknown' before the activity resumes. It required AppState to be
 * 'active' and never looked at the URL, so the first beat went nowhere and the card stayed
 * offline until the two-minute interval came round.
 */
import { canBeat } from '../heartbeat';

const ready = { paired: true, pairing: false, url: 'https://192.168.1.10:4443', appState: 'active' as const };

it('beats once the phone is paired, reachable and in front', () => {
  expect(canBeat(ready)).toBe(true);
});

it('waits for the Pond to be reached, rather than beating at a default address', () => {
  expect(canBeat({ ...ready, url: null })).toBe(false);
});

// A cold start: the identity has loaded and the Pond is reached, but AppState has not caught up.
// The app is plainly on screen -- nothing but the UI mounts this provider.
it('beats on a cold start whose AppState has not caught up yet', () => {
  expect(canBeat({ ...ready, appState: 'unknown' })).toBe(true);
  expect(canBeat({ ...ready, appState: null })).toBe(true);
});

it('stays quiet in the background, where the phone is genuinely not reachable through the app', () => {
  expect(canBeat({ ...ready, appState: 'background' })).toBe(false);
});

it('does not beat for an identity that is not there, or while a pairing is half-built', () => {
  expect(canBeat({ ...ready, paired: false })).toBe(false);
  expect(canBeat({ ...ready, pairing: true })).toBe(false);
});
