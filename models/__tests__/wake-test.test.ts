// The wake test's counting: what woke the phone, and what the voice check or the Pond turned away.

import {
  falseWakes,
  outcome,
  resolveCandidates,
  scorePhrase,
  type ResolvedCandidate,
} from '@/models/wake-test';
import type { WakeTestCandidate } from '@/services/phone-wake';

function cand(over: Partial<ResolvedCandidate>): ResolvedCandidate {
  return { t: 1, p: 0.9, voice: 0.7, decision: 'wake', segment: null, pond: null, ...over };
}

it('counts a wake, and an ask the Pond heard, as waking the phone; nothing else', () => {
  expect(outcome(cand({ decision: 'wake' }))).toBe('woke');
  expect(outcome(cand({ decision: 'ask_pond', pond: true }))).toBe('woke');
  expect(outcome(cand({ decision: 'ask_pond', pond: false }))).toBe('quiet');
  expect(outcome(cand({ decision: 'ask_pond', pond: null }))).toBe('quiet');
  expect(outcome(cand({ decision: 'ignore' }))).toBe('quiet');
  expect(outcome(cand({ decision: 'below' }))).toBe('quiet');
});

it('scores the phrase part, never past the times it was said, and says why the rest were missed', () => {
  const run = [
    ...Array.from({ length: 6 }, () => cand({ decision: 'wake' })),
    cand({ decision: 'ask_pond', pond: true }),
    cand({ decision: 'ask_pond', pond: false }),
    cand({ decision: 'ask_pond', pond: null }),
    cand({ decision: 'ignore', voice: 0.1 }),
    cand({ decision: 'below', p: 0.55 }),
  ];
  expect(scorePhrase(run)).toEqual({ caught: 7, said: 10, below: 1, voiceRefused: 1, pondRefused: 2 });
  expect(scorePhrase(Array.from({ length: 12 }, () => cand({})), 10).caught).toBe(10);
});

it('counts every wake in the talking part as a false wake', () => {
  expect(falseWakes([cand({ decision: 'ignore' }), cand({ decision: 'ask_pond', pond: true }), cand({ decision: 'below' })])).toBe(1);
  expect(falseWakes([])).toBe(0);
});

it('asks the Pond only about the candidates the phone would have asked it about', async () => {
  const ask = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(null);
  const run: WakeTestCandidate[] = [
    { t: 1, p: 0.98, voice: 0.8, decision: 'wake', segment: null },
    { t: 3, p: 0.7, voice: 0.6, decision: 'ask_pond', segment: 'file:///a.wav' },
    { t: 5, p: 0.7, voice: 0.6, decision: 'ask_pond', segment: 'file:///b.wav' },
    { t: 7, p: 0.7, voice: 0.6, decision: 'ask_pond', segment: null },
  ];
  const resolved = await resolveCandidates(run, ask);
  expect(ask.mock.calls).toEqual([['file:///a.wav'], ['file:///b.wav']]);
  expect(resolved.map((c) => c.pond)).toEqual([null, true, null, null]);
});
