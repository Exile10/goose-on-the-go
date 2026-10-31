/**
 * The interview's wire, read defensively: an unknown status offers nothing, a draft with no words is
 * not a note, and the phone names topics in its own strings, falling back to the Pond's label.
 */

import {
  draftByTopic,
  inTopicOrder,
  interviewProgress,
  inviteFor,
  readInterview,
  readInterviewOffer,
  readMemberNotes,
  topicNameKey,
} from '@/models/interview';

const wire = {
  profile_id: 'amina',
  status: 'awaiting_approval',
  session_id: 's-1',
  topics: [
    { id: 'address', label: 'What to call you', status: 'answered' },
    { id: 'food', label: 'Food', status: 'answered' },
    { id: 'household', label: 'Your household', status: 'skipped' },
    { id: 'gardening', label: 'Your garden', status: 'pending' },
  ],
  draft: [
    { key: 'me_food', topic: 'food', instruction: 'No pork.' },
    { key: 'me_address', topic: 'address', instruction: 'Call her Mama Amina.' },
    { key: 'me_other', topic: 'other', instruction: '   ' },
  ],
};

describe('reading the interview', () => {
  it('keeps the topics and the draft, and drops a drafted note with no words', () => {
    const iv = readInterview(wire, 'ignored');
    expect(iv).toMatchObject({ profileId: 'amina', status: 'awaiting_approval', sessionId: 's-1' });
    expect(iv.topics).toHaveLength(4);
    expect(iv.draft.map((d) => d.key)).toEqual(['me_food', 'me_address']);
  });

  it('reads not_started, which has no session, and takes the member from the request when the body omits it', () => {
    expect(readInterview({ status: 'not_started' }, 'amina')).toEqual({
      profileId: 'amina',
      status: 'not_started',
      sessionId: null,
      topics: [],
      draft: [],
    });
  });

  it('reads a status it does not know as finished, so nothing offers to start it', () => {
    const iv = readInterview({ status: 'paused_by_admin' }, 'amina');
    expect(iv.status).toBe('done');
    expect(inviteFor(iv)).toBeNull();
  });

  it('takes the owner’s interview from /onboard/complete, and none from an older Pond', () => {
    expect(readInterviewOffer({ status: 'completed', interview: { profile_id: 'owner', status: 'not_started', start: '/x' } })).toEqual({
      profileId: 'owner',
      status: 'not_started',
    });
    expect(readInterviewOffer({ status: 'completed', interview: null })).toBeNull();
    expect(readInterviewOffer({ status: 'completed' })).toBeNull();
  });

  it('reads the member’s notes and the shared limits', () => {
    const read = readMemberNotes({
      notes: [{ key: 'me_food', instruction: 'No pork.', active: true, sort_order: 0 }, { instruction: 'no key' }],
      limits: { max_notes: 20, max_total_chars: 4000, used_chars: 9 },
    });
    expect(read.notes).toEqual([{ key: 'me_food', instruction: 'No pork.', active: true, sort_order: 0 }]);
    expect(read.limits).toEqual({ maxNotes: 20, maxTotalChars: 4000, usedChars: 9 });
  });
});

describe('what the phone says of it', () => {
  it('counts answered and skipped topics as dealt with', () => {
    expect(interviewProgress(readInterview(wire, 'amina').topics)).toEqual({ settled: 3, total: 4 });
  });

  it('offers to start, carry on or check, and nothing once done', () => {
    expect(inviteFor({ status: 'not_started' })).toBe('start');
    expect(inviteFor({ status: 'in_progress' })).toBe('resume');
    expect(inviteFor({ status: 'stopped' })).toBe('resume');
    expect(inviteFor({ status: 'awaiting_approval' })).toBe('review');
    expect(inviteFor({ status: 'done' })).toBeNull();
    expect(inviteFor(null)).toBeNull();
  });

  it('lists the draft in the order the topics were asked', () => {
    expect(draftByTopic(readInterview(wire, 'amina')).map((d) => [d.key, d.label])).toEqual([
      ['me_address', 'What to call you'],
      ['me_food', 'Food'],
    ]);
  });

  it('names a topic by id or note key, and leaves one a newer Pond added to its own label', () => {
    expect(topicNameKey('food')).toBe('interview.topics.food');
    expect(topicNameKey('me_food')).toBe('interview.topics.food');
    expect(topicNameKey('gardening')).toBeNull();
    expect(topicNameKey('house_notes')).toBeNull();
  });

  it('puts the interview’s notes first, in topic order, then the member’s others', () => {
    const notes = ['custom', 'me_food', 'me_address'].map((key, i) => ({ key, instruction: key, active: true, sort_order: i }));
    expect(inTopicOrder(notes).map((n) => n.key)).toEqual(['me_address', 'me_food', 'custom']);
  });
});
