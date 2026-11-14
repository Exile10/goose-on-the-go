// The one line above a message the Pond wrote for itself, and the line on each receipt.

import { fromWords, offerStateWords, receiptWords } from '@/view-models/note-words';

const from = (kind: Parameters<typeof fromWords>[0]['kind'], label = '') => ({ kind, label, refId: null });

describe('fromWords', () => {
  it('says where a message came from, with its name when it has one', () => {
    expect(fromWords(from('schedule', 'Daily Briefing'))).toBe('From your schedule: Daily Briefing');
    expect(fromWords(from('reminder'))).toBe('Reminder');
    expect(fromWords(from('task', 'Compare three laptops'))).toBe('Task finished: Compare three laptops');
    expect(fromWords(from('lookup', 'Passport office hours'))).toBe('Looked up: Passport office hours');
    expect(fromWords(from('watch', 'Flights to Kisumu'))).toBe('Watch: Flights to Kisumu');
    expect(fromWords(from('suggestion', 'ignored'))).toBe('Suggestion');
  });

  it('still reads without a name, and gives a kind it does not know its label alone', () => {
    expect(fromWords(from('schedule'))).toBe('From your schedule');
    expect(fromWords(from('task'))).toBe('Task finished');
    expect(fromWords(from(null, 'Errand'))).toBe('Errand');
  });
});

describe('receiptWords', () => {
  it('says set or not set, and what', () => {
    expect(receiptWords({ kind: 'reminder', outcome: 'set', what: 'Bins out, Thursday 7:00', reason: null })).toBe('Set: Bins out, Thursday 7:00');
    expect(receiptWords({ kind: 'timer', outcome: 'not_set', what: 'A 10 minute timer', reason: 'No speaker.' })).toBe('Not set: A 10 minute timer');
  });
});

describe('offerStateWords', () => {
  it('names an answered offer and says nothing of an open one', () => {
    expect(offerStateWords('done')).toBe('Done');
    expect(offerStateWords('dismissed')).toBe('Passed over');
    expect(offerStateWords('open')).toBeNull();
  });
});
