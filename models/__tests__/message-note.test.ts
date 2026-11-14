// The note the Pond stores beside a message is the only source of what a reply set: a field of
// the wrong shape reads as missing, and nothing is ever read out of the reply's words.

import { readNote, readReceipt, withOfferState, withReceipt } from '@/models/message-note';

describe('readNote', () => {
  it('is null for no note, and for one that holds nothing this app draws', () => {
    expect(readNote(undefined)).toBeNull();
    expect(readNote({})).toBeNull();
    expect(readNote({ receipts: [], from: {} })).toBeNull();
    expect(readNote('From your schedule')).toBeNull();
  });

  it('keeps the label of a kind it does not know, and drops a line with nothing to say', () => {
    expect(readNote({ from: { kind: 'errand', label: 'Passport office hours' } })?.from).toEqual({ kind: null, label: 'Passport office hours', refId: null });
    expect(readNote({ from: { kind: 'errand' } })).toBeNull();
    expect(readNote({ from: { kind: 'reminder' } })?.from).toEqual({ kind: 'reminder', label: '', refId: null });
  });

  it('reads an offer in any state, but not an open one with nothing to send', () => {
    const offer = { noticed: 'Bin day is tomorrow.', action: 'Remind me', prompt: 'Remind me tonight', state: 'open' };
    expect(readNote({ suggestion: offer })?.offer?.state).toBe('open');
    expect(readNote({ suggestion: { ...offer, state: 'done', prompt: '' } })?.offer?.state).toBe('done');
    expect(readNote({ suggestion: { ...offer, prompt: ' ' } })).toBeNull();
    expect(readNote({ suggestion: { ...offer, state: 'pending' } })).toBeNull();
  });
});

describe('readReceipt', () => {
  it('needs to know what, and whether it was set', () => {
    expect(readReceipt({ kind: 'timer', outcome: 'set', what: '10 minutes' })).toEqual({ kind: 'timer', outcome: 'set', what: '10 minutes', reason: null });
    expect(readReceipt({ kind: 'timer', outcome: 'set' })).toBeNull();
    expect(readReceipt({ kind: 'timer', what: '10 minutes' })).toBeNull();
    expect(readReceipt(null)).toBeNull();
  });
});

describe('changing a note', () => {
  it('adds a receipt without touching what was there', () => {
    const first = withReceipt(undefined, { kind: 'todo', outcome: 'set', what: 'Milk', reason: null });
    const second = withReceipt(first, { kind: 'todo', outcome: 'not_set', what: 'Eggs', reason: 'The list is full.' });
    expect(first.receipts).toHaveLength(1);
    expect(second.receipts?.map((r) => r.what)).toEqual(['Milk', 'Eggs']);
  });

  it('answers an offer, and leaves a note with no offer as it is', () => {
    const note = readNote({ suggestion: { noticed: 'n', action: 'a', prompt: 'p', state: 'open' } })!;
    expect(withOfferState(note, 'dismissed').offer?.state).toBe('dismissed');
    const plain = { receipts: [] };
    expect(withOfferState(plain, 'done')).toBe(plain);
  });
});
