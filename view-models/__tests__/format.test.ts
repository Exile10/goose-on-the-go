/**
 * The pure formatters behind the models screen and the home strip.
 *
 * Both turn server fields into the strings a user reads, and both have a
 * boundary that is easy to get wrong: a size that should roll over to GB, and a
 * timestamp that should stop being relative once relative stops helping.
 */

import { formatContextWindow, formatSize, isLocalProvider } from '@/view-models/use-models';
import { formatRelativeTime } from '@/view-models/use-recent-sessions';

describe('formatSize', () => {
  it('rolls over to GB at 1024 MB', () => {
    expect(formatSize(1023)).toBe('1023 MB');
    expect(formatSize(1024)).toBe('1.0 GB');
    expect(formatSize(4300)).toBe('4.2 GB');
  });

  /** Absent is not zero: a Pond that did not report a size shows nothing. */
  it('returns null when the server did not report a size', () => {
    expect(formatSize(undefined)).toBeNull();
  });
});

describe('formatContextWindow', () => {
  it('reads in thousands once it is worth doing', () => {
    expect(formatContextWindow(128_000)).toBe('128K tokens');
    expect(formatContextWindow(999)).toBe('999 tokens');
  });

  it('returns null for absent or zero, rather than "0 tokens"', () => {
    expect(formatContextWindow(undefined)).toBeNull();
    expect(formatContextWindow(0)).toBeNull();
  });
});

describe('isLocalProvider', () => {
  /** This drives the "On your Pond" badge, which is a privacy claim. */
  it('recognises the on-device providers, case-insensitively', () => {
    expect(isLocalProvider('ollama')).toBe(true);
    expect(isLocalProvider('Llamafile')).toBe(true);
    expect(isLocalProvider('local-inference')).toBe(true);
  });

  it('treats anything else as cloud', () => {
    expect(isLocalProvider('openai')).toBe(false);
    expect(isLocalProvider('anthropic')).toBe(false);
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-09-15T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('walks the units up to a week', () => {
    expect(formatRelativeTime(ago(30_000), now)).toBe('Just now');
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe('5m ago');
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toBe('3h ago');
    expect(formatRelativeTime(ago(30 * 3_600_000), now)).toBe('Yesterday');
    expect(formatRelativeTime(ago(3 * 86_400_000), now)).toBe('3d ago');
  });

  /** Past a week a date is easier to read than a count of days. */
  it('falls back to a date beyond a week', () => {
    expect(formatRelativeTime(ago(30 * 86_400_000), now)).toMatch(/\d/);
    expect(formatRelativeTime(ago(30 * 86_400_000), now)).not.toContain('ago');
  });

  /** A malformed timestamp should not render the string "NaN" to a user. */
  it('returns empty for an unparseable timestamp', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('');
  });
});
