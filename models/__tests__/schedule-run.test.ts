/**
 * How a schedule's run reads in its row: the time it took in words, and the
 * plain lines a closed row shows of what it said.
 */

import { RUN_PREVIEW_CHARS, formatRunDuration, runPreview } from '@/models/schedule';

describe('formatRunDuration', () => {
  it.each([
    [0, '0 ms'],
    [850, '850 ms'],
    [999, '999 ms'],
    [1000, '1 s'],
    [59_000, '59 s'],
    // 59.6 s rounds to a minute, not to "60 s".
    [59_600, '1 min'],
    [128_820, '2 min 9 s'],
    [120_000, '2 min'],
    [3_600_000, '1 h'],
    [3_900_000, '1 h 5 min'],
    // From an hour up the seconds are dropped.
    [3_929_000, '1 h 5 min'],
  ])('reads %i ms as "%s"', (ms, words) => {
    expect(formatRunDuration(ms)).toBe(words);
  });

  it('never reads a negative duration as a negative number', () => {
    expect(formatRunDuration(-5)).toBe('0 ms');
  });
});

describe('runPreview', () => {
  const weather = [
    '**Weather in Nairobi:**',
    '',
    '* Temperature: 22 C',
    '* Humidity: *60%*',
    '* Wind: 10 km/h',
  ].join('\n');

  it('takes the markdown markers out, so no asterisk ever shows', () => {
    const { text } = runPreview(weather);
    expect(text).not.toMatch(/\*/);
    expect(text.split('\n')[0]).toBe('Weather in Nairobi:');
    expect(text.split('\n')[2]).toMatch(/^Humidity: 60%/);
  });

  it('shows three lines and says the rest was left out', () => {
    const preview = runPreview(weather);
    expect(preview.truncated).toBe(true);
    expect(preview.text.split('\n')).toHaveLength(3);
    expect(preview.text.endsWith('…')).toBe(true);
  });

  it('leaves a short answer whole and does not call it cut', () => {
    expect(runPreview('All **three** lights are off.')).toEqual({
      text: 'All three lights are off.',
      truncated: false,
    });
  });

  it('reads headings, links, inline code and entities as their words', () => {
    const { text } = runPreview('## Done\n\nSee [the forecast](https://example.com) and `lights.off` &amp; more');
    expect(text).toBe('Done\nSee the forecast and lights.off & more');
  });

  it('cuts one long paragraph at the character cap, so it cannot wrap past the preview', () => {
    const preview = runPreview('word '.repeat(80));
    expect(preview.truncated).toBe(true);
    // The cap plus the ellipsis.
    expect(preview.text.length).toBeLessThanOrEqual(RUN_PREVIEW_CHARS + 1);
  });

  it('does not count blank lines as lines', () => {
    expect(runPreview('one\n\n\n\ntwo\n\nthree')).toEqual({ text: 'one\ntwo\nthree', truncated: false });
  });
});
