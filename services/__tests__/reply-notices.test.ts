/**
 * What the phone says when a reply finishes elsewhere, and whether it says it.
 */

import i18n from '@/services/i18n';
import {
  announceTurn,
  excerpt,
  loadReplyNoticePreference,
  noticeFor,
  replyNoticesEnabled,
  saveReplyNoticePreference,
} from '@/services/reply-notices';

const mockPresent = jest.fn().mockResolvedValue(undefined);
jest.mock('@/services/local-notifications', () => ({
  presentLocally: (...args: unknown[]) => mockPresent(...args),
}));

const answered = { kind: 'answered' as const, sessionId: 's-1', runId: 'r-1', title: 'Rain', text: 'Not today.' };

beforeEach(() => mockPresent.mockClear());

describe('excerpt', () => {
  it('reads markdown as the words it carries', () => {
    expect(excerpt('## Forecast\n\n- **Rain** at `3pm`, see [the map](https://example.com)')).toBe(
      'Forecast Rain at 3pm, see the map',
    );
  });

  it('leaves code out, and stops a long reply at a glance', () => {
    expect(excerpt('Run this:\n```sh\nrm -rf /\n```\nthen wait.')).toBe('Run this: then wait.');
    const long = excerpt('word '.repeat(80));
    expect(Array.from(long).length).toBeLessThanOrEqual(141);
    expect(long).toMatch(/word…$/);
  });
});

describe('noticeFor', () => {
  it('names the conversation, opens it on a tap, and is one notice per run', () => {
    expect(noticeFor(answered, new Date('2026-10-23T10:00:00Z'))).toEqual({
      id: 'reply-r-1',
      target: 'local',
      category: 'reply',
      title: 'Rain',
      body: 'Not today.',
      timestamp: '2026-10-23T10:00:00.000Z',
      data: { open: 'conversation', session_id: 's-1' },
    });
  });

  it('says something for a conversation with no name yet and a reply with no words', () => {
    const notice = noticeFor({ ...answered, title: null, text: '' });
    expect(notice.title).toBe(i18n.t('chat.notice.answeredTitle'));
    expect(notice.body).toBe(i18n.t('chat.notice.answeredBody'));
  });

  it('says a failed turn failed, and does not quote it', () => {
    const notice = noticeFor({ kind: 'failed', sessionId: 's-1', runId: 'r-1', title: null });
    expect(notice.title).toBe(i18n.t('chat.notice.failedTitle'));
    expect(notice.body).toBe(i18n.t('chat.notice.failedBody'));
  });
});

describe('the switch', () => {
  afterEach(() => saveReplyNoticePreference(true));

  it('is on until turned off, and off means nothing reaches the shade', async () => {
    await loadReplyNoticePreference();
    expect(replyNoticesEnabled()).toBe(true);
    await announceTurn(answered);
    expect(mockPresent).toHaveBeenCalledTimes(1);

    await saveReplyNoticePreference(false);
    await loadReplyNoticePreference();
    expect(replyNoticesEnabled()).toBe(false);
    await announceTurn(answered);
    expect(mockPresent).toHaveBeenCalledTimes(1);
  });
});
