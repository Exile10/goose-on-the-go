// What Goose did, as the phone reads it: each kind has its icon, and a phone the Pond removed is
// never offered to be taken back, whatever the Pond says of it.

import { ACTIVITY_KINDS, activityIcon, readGooseActivity } from '@/models/goose-activity';

describe('a phone the Pond removed', () => {
  const removed = {
    id: 'a9',
    kind: 'phone_removed',
    summary: 'Removed the phone Old Pixel: it had not connected for 30 days',
    at: '2026-11-13T06:00:00+00:00',
  };

  it('reads as its own kind, with its line and a device for its icon', () => {
    const [entry] = readGooseActivity({ activity: [removed], unseen: 1 }).items;
    expect(entry).toMatchObject({ kind: 'phone_removed', summary: removed.summary, canUndo: false, undone: false });
    expect(activityIcon(entry.kind)).toBe('device');
  });

  it('cannot be taken back even if the Pond were to say it could', () => {
    const [entry] = readGooseActivity({ activity: [{ ...removed, can_undo: true }] }).items;
    expect(entry.canUndo).toBe(false);
  });
});

describe('the other kinds', () => {
  it('keep what the Pond says about taking them back', () => {
    const [entry] = readGooseActivity({ activity: [{ id: 'a1', kind: 'reminder', summary: 'Set a reminder', can_undo: true }] }).items;
    expect(entry.canUndo).toBe(true);
  });

  it('each have an icon', () => {
    for (const kind of ACTIVITY_KINDS) expect(activityIcon(kind)).toBeTruthy();
  });
});
