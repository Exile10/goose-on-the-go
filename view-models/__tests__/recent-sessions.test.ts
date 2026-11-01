/**
 * What a conversation row on Home and the wall says about a session.
 *
 * The row carries two lines now: the conversation's name, and under it how it opened. The rule
 * worth a test is that it never says the same thing twice — a session whose title the Pond
 * derived from the first message has a preview that is that same message.
 */

import type { SessionSummary } from '@/services/types';
import { toRecent } from '@/view-models/use-recent-sessions';

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 's1',
    created_at: '2026-10-30T19:00:00Z',
    updated_at: '2026-10-30T20:00:00Z',
    ...over,
  };
}

it('names the conversation and shows how it opened under it', () => {
  const row = toRecent(session({ title: 'Heater schedule', preview: 'set it to 19 after nine' }));
  expect(row.text).toBe('Heater schedule');
  expect(row.preview).toBe('set it to 19 after nine');
});

it('does not say the same thing on both lines', () => {
  const row = toRecent(session({ title: 'Shopping list', preview: 'Shopping list' }));
  expect(row.text).toBe('Shopping list');
  expect(row.preview).toBeNull();
});

// The title is derived from the first user message, so it is absent until a turn is persisted.
it('falls back to the preview for a conversation the Pond has not named', () => {
  const row = toRecent(session({ preview: 'add oat milk' }));
  expect(row.text).toBe('add oat milk');
  expect(row.title).toBeNull();
  // Already the line above; a second copy of it is not a second line.
  expect(row.preview).toBeNull();
});

it('still names a session with neither', () => {
  const row = toRecent(session());
  expect(row.text.length).toBeGreaterThan(0);
  expect(row.preview).toBeNull();
});

it('ignores whitespace the Pond sent', () => {
  const row = toRecent(session({ title: '  Heater  ', preview: '   ' }));
  expect(row.text).toBe('Heater');
  expect(row.preview).toBeNull();
});
