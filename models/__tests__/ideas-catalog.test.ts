/**
 * Ideas and the catalogue: an unknown state is a new idea, a dismissed one is never shown, and a
 * screen this phone does not have is no destination.
 */

import { catalogHref, readCatalog } from '@/models/catalog';
import { featuredIdea, readIdea, readIdeas, shownIdeas } from '@/models/ideas';

const idea = {
  id: 'idea-1',
  title: 'Rehearse your talk twice',
  pitch: 'Run it with Goose keeping time.',
  why: 'You speak on the 19th.',
  grounded_in: [{ kind: 'conversation', label: 'Your talk' }, { kind: 'dream', label: 'x' }, { kind: 'memory' }],
  sources: [{ title: 'Programme', url: 'https://events.example.org' }],
  picture: '/api/v1/report-images/stage',
  goose_can: { label: 'Book two run-throughs', kind: 'schedule' },
  you_can: ['Export the slides', ''],
  state: 'new',
  progress: null,
  created_at: '2026-11-09T06:00:00Z',
};

describe('ideas', () => {
  it('keeps what Goose can do and the member’s steps', () => {
    expect(readIdea(idea)).toMatchObject({
      gooseCan: { label: 'Book two run-throughs', kind: 'schedule' },
      youCan: ['Export the slides'],
      groundedIn: [
        { kind: 'conversation', label: 'Your talk' },
        { kind: 'conversation', label: 'x' },
      ],
      taskId: null,
    });
  });

  it('reads an unknown state as new, and Goose’s part with no words as none', () => {
    expect(readIdea({ ...idea, state: 'pondering', goose_can: { kind: 'research' } })).toMatchObject({ state: 'new', gooseCan: null });
    expect(readIdea({ ...idea, progress: { task_id: 'task-9' } })?.taskId).toBe('task-9');
    expect(readIdeas({ ideas: [idea], state: 'napping' }).state).toBe('idle');
  });

  it('never shows a dismissed idea, and features the newest one not acted on', () => {
    const all = [
      readIdea({ ...idea, id: 'old', created_at: '2026-11-01T00:00:00Z' })!,
      readIdea({ ...idea, id: 'gone', state: 'dismissed' })!,
      readIdea({ ...idea, id: 'busy', state: 'working' })!,
      readIdea({ ...idea, id: 'new', created_at: '2026-11-09T09:00:00Z' })!,
    ];
    expect(shownIdeas(all).map((i) => i.id)).toEqual(['busy', 'new', 'old']);
    expect(featuredIdea(all)?.id).toBe('new');
    expect(featuredIdea([all[2]])?.id).toBe('busy');
  });
});

describe('the catalogue', () => {
  it('keeps a prompt to try and opens only screens this phone has', () => {
    const items = readCatalog({
      items: [
        { id: 'a', title: 'Hear the digest', body: '', icon: 'speaker', state: 'off', try: null, opens: 'news' },
        { id: 'b', title: 'Book a table', body: '', icon: 'utensils', state: 'glowing', try: 'Book a table', opens: 'restaurants' },
      ],
    });
    expect(items[0]).toMatchObject({ opens: 'news', icon: 'speaker', state: 'off' });
    expect(items[1]).toMatchObject({ opens: null, icon: 'utensils', state: 'off', try: 'Book a table' });
    expect(catalogHref('web_watches')).toBe('/(stack)/web-watches');
  });
});
