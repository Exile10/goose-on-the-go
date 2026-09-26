import { describeLapse, lapseIn, LAPSE_WARNING_DAYS } from '@/models/lapse';

const NOW = Date.parse('2026-09-21T12:00:00Z');
const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

it('says nothing while the deadline is far off', () => {
  expect(lapseIn(inDays(30), NOW)?.warn).toBe(false);
  expect(describeLapse(lapseIn(inDays(30), NOW))).toBeNull();
});

it('starts warning a week out', () => {
  expect(lapseIn(inDays(LAPSE_WARNING_DAYS), NOW)?.warn).toBe(true);
  expect(describeLapse(lapseIn(inDays(3), NOW))).toMatch(/lapses in 3 days/);
  expect(describeLapse(lapseIn(inDays(1), NOW))).toMatch(/lapses in 1 day\b/);
});

it('reads the last day and the day after differently', () => {
  expect(describeLapse(lapseIn(inDays(0.5), NOW))).toMatch(/lapses today/);
  expect(describeLapse(lapseIn(inDays(-2), NOW))).toMatch(/has lapsed/);
});

// A Pond older than this feature reports no deadline at all. Silence must not
// read as "lapsing today", which would tell every such household its remote
// access was about to go.
it('says nothing when the Pond reports no deadline', () => {
  for (const absent of [null, undefined, '', 'not a date']) {
    expect(lapseIn(absent, NOW)).toBeNull();
    expect(describeLapse(lapseIn(absent, NOW))).toBeNull();
  }
});

// Rounded down, so "1 day" means at least a day is left rather than an hour.
it('does not round a few hours up into a day', () => {
  expect(lapseIn(inDays(1.9), NOW)?.days).toBe(1);
});
