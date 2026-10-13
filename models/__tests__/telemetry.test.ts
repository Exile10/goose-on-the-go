/**
 * Which conversation the Activity screen's telemetry card shows, and how its
 * figures read.
 */

import { formatDuration, formatPercent, latestSession } from '@/models/telemetry';
import type { SessionSummary } from '@/services/types';

function session(id: string, updated_at: string): SessionSummary {
  return { id, created_at: '2026-10-01T08:00:00Z', updated_at };
}

describe('latestSession', () => {
  it('picks the conversation touched most recently, whatever the order', () => {
    const sessions = [
      session('older', '2026-10-05T08:00:00Z'),
      session('newest', '2026-10-06T07:30:00Z'),
      session('middle', '2026-10-06T07:00:00Z'),
    ];
    expect(latestSession(sessions)?.id).toBe('newest');
  });

  it('is null when there are no conversations', () => {
    expect(latestSession([])).toBeNull();
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0 ms'],
    [412.6, '413 ms'],
    [999, '999 ms'],
    [1000, '1.0 s'],
    [2345, '2.3 s'],
  ])('%p ms reads as %p', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe('formatPercent', () => {
  it('rounds to a whole percent', () => {
    expect(formatPercent(24.5)).toBe('25%');
    expect(formatPercent(0)).toBe('0%');
  });
});
