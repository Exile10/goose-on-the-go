/**
 * The mock Pond behind the Developer toggle answers as the contract says: the interview thinks
 * before its next question, an accepted offer becomes a timed to-do, and a fresh member has nothing.
 */

import { createMockHub, MOCK_THINK_MS } from '@/models/my-goose-mock';
import { openQuestion } from '@/models/interests';

describe('the mock hub', () => {
  it('thinks after an answer, then asks the next question', async () => {
    let now = Date.parse('2026-11-09T08:00:00Z');
    const hub = createMockHub({ clock: () => now });
    const started = await hub.startInterview();
    expect(openQuestion(started)?.multi).toBe(true);
    const thinking = await hub.answerInterview({ choices: ['Play games'] });
    expect(thinking.status).toBe('thinking');
    expect((await hub.interview()).status).toBe('thinking');
    now += MOCK_THINK_MS;
    const next = await hub.interview();
    expect(next.status).toBe('asking');
    expect(next.turns.map((t) => t.role)).toEqual(['goose', 'you', 'goose']);
    const review = await hub.finishInterview();
    expect(review.draft.length).toBeGreaterThan(0);
    expect(await hub.approveInterview({ keep: [review.draft[0].id], edits: {} })).toBe(1);
    expect((await hub.interview()).status).toBe('done');
  });

  it('turns an accepted offer into a to-do at the time sent, and forgets a declined one', async () => {
    const hub = createMockHub();
    const [timed, untimed] = await hub.todoOffers();
    expect(untimed.dueAt).toBeNull();
    const made = await hub.acceptTodoOffer(untimed.reminderId, '2026-11-12T09:00:00.000Z');
    expect(made.hooks[0].spec).toEqual({ kind: 'time', at: '2026-11-12T09:00:00.000Z' });
    await hub.declineTodoOffer(timed.reminderId);
    expect(await hub.todoOffers()).toEqual([]);
  });

  it('has nothing for a member Goose does not know yet, and says why there is no news', async () => {
    const hub = createMockHub({ fresh: true });
    expect(await hub.interests()).toEqual([]);
    expect(await hub.news()).toMatchObject({ stories: [], digest: null, blocked: 'no_interests' });
    expect(await hub.portrait()).toBeNull();
  });
});
