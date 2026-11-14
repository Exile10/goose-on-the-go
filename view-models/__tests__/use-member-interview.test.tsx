// The member's interview against the Pond's routes. Pinned: the body each kind of answer sends, the
// 1.5 s read while the Pond writes up and its stop at review, that approve sends only what is
// ticked, and that a refused call leaves the question, the typing and the ticks as they were.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { Interest, InterviewTurn } from '@/models/interests';
import { EMPTY_INTERVIEW, type MemberInterview } from '@/models/member-interview';
import { ApiError, api } from '@/services/api-client';
import { currentSnackbar, resetSnackbar } from '@/services/snackbar';
import { MEMBER_INTERVIEW_IDLE_MS, useMemberInterview, type UseMemberInterview } from '@/view-models/use-member-interview';
import { INTERVIEW_POLL_MS } from '@/view-models/use-live';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/secure-random', () => ({ randomBytes: (n: number) => new Uint8Array(n).fill(7) }));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect: run } = jest.requireActual('react');
    run(effect, [effect]);
  },
}));
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true, isScreenReal: () => true }) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      memberInterview: jest.fn(),
      startMemberInterview: jest.fn(),
      answerMemberInterview: jest.fn(),
      finishMemberInterview: jest.fn(),
      approveMemberInterview: jest.fn(),
    },
  };
});

const pond = jest.mocked(api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function ask(id: string, text: string, over: Partial<InterviewTurn> = {}): InterviewTurn {
  return { id, role: 'goose', text, choices: [], multi: false, allowFree: false, at: null, ...over };
}

function asking(question: InterviewTurn, done = 1): MemberInterview {
  return {
    ...EMPTY_INTERVIEW,
    status: 'asking',
    turns: [question],
    heading: 'Food and health',
    progress: { done, total: 8 },
  };
}

const DIET = ask('q1', 'How do you eat?', { choices: ['Anything', 'Vegetarian', 'Vegan'], allowFree: true });
const SPORTS = ask('q2', 'Which of these do you do?', { choices: ['Running', 'Cycling', 'Swimming'], multi: true, allowFree: true });
const WHY = ask('q3', 'What got you into rowing?', { allowFree: true });

const THINKING: MemberInterview = { ...EMPTY_INTERVIEW, status: 'thinking', progress: { done: 8, total: 8 } };

function interest(id: string, topic: string): Interest {
  return {
    id,
    topic,
    category: 'sport',
    facets: [],
    depth: 'curious',
    news: 'off',
    avoid: false,
    origin: 'chat',
    evidence: 0,
    confirmed: false,
    picture: null,
    updatedAt: null,
  };
}

function review(over: Partial<MemberInterview> = {}): MemberInterview {
  return {
    ...EMPTY_INTERVIEW,
    status: 'review',
    progress: { done: 8, total: 8 },
    facts: [
      { id: 'f1', about: 'diet', content: 'Jerry is vegetarian.' },
      { id: 'f2', about: 'sport', content: 'Jerry rows on Sundays.' },
      { id: 'f3', about: 'home', content: 'Jerry lives in Nairobi.' },
    ],
    interests: [interest('d1', 'Rowing'), interest('d2', 'Formula 1')],
    news: 'digest',
    ...over,
  };
}

async function mount() {
  let latest!: UseMemberInterview;
  const Probe = () => {
    latest = useMemberInterview();
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
    await jest.advanceTimersByTimeAsync(0);
  });
  return {
    get vm() {
      return latest;
    },
    unmount: () => act(() => tree.unmount()),
  };
}

const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  // Not reset: that would also empty React Native's own AppState mock, which the poll listens on.
  jest.clearAllMocks();
  resetSnackbar();
  pond.memberInterview.mockResolvedValue(asking(DIET));
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  warn.mockRestore();
});

describe('answering', () => {
  it('reads the interview on arrival and shows its open question', async () => {
    const m = await mount();
    expect(pond.memberInterview).toHaveBeenCalledTimes(1);
    expect(m.vm.loading).toBe(false);
    expect(m.vm.question?.id).toBe('q1');
    await m.unmount();
  });

  it('sends a single tap as that one choice, and shows the next question at once', async () => {
    pond.answerMemberInterview.mockResolvedValue(asking(SPORTS, 2));
    const m = await mount();
    await act(async () => {
      await m.vm.actions.answer({ choices: ['Vegetarian'] });
    });
    expect(pond.answerMemberInterview).toHaveBeenCalledWith({ choices: ['Vegetarian'] });
    expect(m.vm.question?.id).toBe('q2');
    expect(m.vm.data.progress.done).toBe(2);
    expect(m.vm.busy).toBe(false);
    await m.unmount();
  });

  it('sends every picked choice of a multi question, with what was typed beside them', async () => {
    pond.memberInterview.mockResolvedValue(asking(SPORTS));
    pond.answerMemberInterview.mockResolvedValue(asking(WHY));
    const m = await mount();
    await act(async () => {
      await m.vm.actions.answer({ choices: ['Running', 'Cycling'], text: '' });
    });
    expect(pond.answerMemberInterview).toHaveBeenLastCalledWith({ choices: ['Running', 'Cycling'] });
    await act(async () => {
      await m.vm.actions.answer({ choices: ['Swimming'], text: ' and rowing ' });
    });
    expect(pond.answerMemberInterview).toHaveBeenLastCalledWith({ choices: ['Swimming'], text: 'and rowing' });
    await m.unmount();
  });

  it('sends typed words trimmed, and nothing at all for an empty answer', async () => {
    pond.memberInterview.mockResolvedValue(asking(WHY));
    pond.answerMemberInterview.mockResolvedValue(asking(DIET));
    const m = await mount();
    await act(async () => {
      await m.vm.actions.answer({ choices: [], text: '   ' });
    });
    expect(pond.answerMemberInterview).not.toHaveBeenCalled();
    await act(async () => {
      await m.vm.actions.answer({ choices: [], text: '  A friend took me out on the river. ' });
    });
    expect(pond.answerMemberInterview).toHaveBeenCalledWith({ text: 'A friend took me out on the river.' });
    await m.unmount();
  });

  it('sends a skip as a skip', async () => {
    pond.answerMemberInterview.mockResolvedValue(asking(SPORTS));
    const m = await mount();
    await act(async () => {
      await m.vm.actions.skip();
    });
    expect(pond.answerMemberInterview).toHaveBeenCalledWith({ skip: true });
    expect(m.vm.question?.id).toBe('q2');
    await m.unmount();
  });

  it('sends a second tap nowhere while the first is out, so it cannot answer the next question', async () => {
    let settle!: (next: MemberInterview) => void;
    pond.answerMemberInterview.mockReturnValue(new Promise<MemberInterview>((resolve) => (settle = resolve)));
    const m = await mount();
    let first!: Promise<unknown>;
    await act(async () => {
      first = m.vm.actions.answer({ choices: ['Vegan'] });
      await m.vm.actions.answer({ choices: ['Vegan'] });
    });
    expect(m.vm.busy).toBe(true);
    expect(pond.answerMemberInterview).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle(asking(SPORTS));
      await first;
    });
    expect(m.vm.busy).toBe(false);
    expect(m.vm.question?.id).toBe('q2');
    await m.unmount();
  });

  it('does not put back the question before, from a read the answer overtook', async () => {
    const m = await mount();
    let settle!: (stale: MemberInterview) => void;
    pond.memberInterview.mockReturnValueOnce(new Promise<MemberInterview>((resolve) => (settle = resolve)));
    pond.memberInterview.mockResolvedValue(asking(SPORTS));
    pond.answerMemberInterview.mockResolvedValue(asking(SPORTS));
    let reading!: Promise<void>;
    await act(async () => {
      reading = m.vm.actions.reload();
      await m.vm.actions.answer({ choices: ['Vegan'] });
    });
    expect(m.vm.question?.id).toBe('q2');
    await act(async () => {
      settle(asking(DIET));
      await reading;
    });
    expect(m.vm.question?.id).toBe('q2');
    await m.unmount();
  });

  it('starts, and stops early, through their own routes', async () => {
    pond.memberInterview.mockResolvedValue(EMPTY_INTERVIEW);
    pond.startMemberInterview.mockResolvedValue(asking(DIET, 0));
    pond.finishMemberInterview.mockResolvedValue(review());
    const m = await mount();
    expect(m.vm.data.status).toBe('not_started');
    await act(async () => {
      await m.vm.actions.start();
    });
    expect(m.vm.question?.id).toBe('q1');
    await act(async () => {
      await m.vm.actions.finish();
    });
    expect(pond.finishMemberInterview).toHaveBeenCalledTimes(1);
    expect(m.vm.data.status).toBe('review');
    await m.unmount();
  });
});

describe('while the Pond writes up', () => {
  it('reads every 1.5 s while it is thinking, and stops at review', async () => {
    pond.memberInterview.mockResolvedValue(asking(WHY, 8));
    pond.answerMemberInterview.mockResolvedValue(THINKING);
    const m = await mount();
    pond.memberInterview.mockResolvedValue(THINKING);
    await act(async () => {
      await m.vm.actions.answer({ text: 'A friend took me.' });
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(m.vm.data.status).toBe('thinking');
    const arrived = pond.memberInterview.mock.calls.length;

    await advance(INTERVIEW_POLL_MS - 1);
    expect(pond.memberInterview).toHaveBeenCalledTimes(arrived);
    await advance(1);
    expect(pond.memberInterview).toHaveBeenCalledTimes(arrived + 1);
    expect(m.vm.data.status).toBe('thinking');

    pond.memberInterview.mockResolvedValue(review());
    await advance(INTERVIEW_POLL_MS);
    expect(pond.memberInterview).toHaveBeenCalledTimes(arrived + 2);
    expect(m.vm.data.status).toBe('review');
    expect(m.vm.review.keepCount).toBe(5);

    await advance(MEMBER_INTERVIEW_IDLE_MS / 2);
    expect(pond.memberInterview).toHaveBeenCalledTimes(arrived + 2);
    await m.unmount();
  });

  it('keeps reading through a read that fails', async () => {
    pond.memberInterview.mockResolvedValue(THINKING);
    const m = await mount();
    const arrived = pond.memberInterview.mock.calls.length;
    pond.memberInterview.mockRejectedValueOnce(new ApiError('GET → 503', 503, null));
    pond.memberInterview.mockResolvedValue(review());
    await advance(INTERVIEW_POLL_MS);
    expect(m.vm.data.status).toBe('thinking');
    expect(m.vm.failed).toBe(false);
    await advance(INTERVIEW_POLL_MS);
    expect(pond.memberInterview).toHaveBeenCalledTimes(arrived + 2);
    expect(m.vm.data.status).toBe('review');
    await m.unmount();
  });
});

describe('approving', () => {
  it('starts with every drafted fact and interest ticked, and the news switch on', async () => {
    pond.memberInterview.mockResolvedValue(review());
    pond.approveMemberInterview.mockResolvedValue({ facts: 3, interests: 2, news: true });
    const m = await mount();
    expect(m.vm.review.keepCount).toBe(5);
    expect(m.vm.review.applyNews).toBe(true);
    await act(async () => {
      await m.vm.actions.approve();
    });
    expect(pond.approveMemberInterview).toHaveBeenCalledWith({ facts: ['f1', 'f2', 'f3'], interests: ['d1', 'd2'], news: true });
    await m.unmount();
  });

  it('sends only the ticked ids, the rewording of a kept fact, and the news switch', async () => {
    pond.memberInterview.mockResolvedValue(review());
    pond.approveMemberInterview.mockResolvedValue({ facts: 2, interests: 1, news: false });
    const m = await mount();
    act(() => {
      m.vm.actions.keepFact('f2', false);
      m.vm.actions.keepInterest('d2', false);
      m.vm.actions.reword('f1', '  Jerry eats no meat. ');
      m.vm.actions.reword('f2', 'Jerry rows most weekends.');
      m.vm.actions.reword('f3', 'Jerry lives in Nairobi.');
      m.vm.actions.setApplyNews(false);
    });
    expect(m.vm.review.keepCount).toBe(3);
    expect(m.vm.review.facts.map((f) => [f.content, f.kept])).toEqual([
      ['Jerry eats no meat.', true],
      ['Jerry rows most weekends.', false],
      ['Jerry lives in Nairobi.', true],
    ]);

    await act(async () => {
      await m.vm.actions.approve();
    });
    expect(pond.approveMemberInterview).toHaveBeenCalledWith({
      facts: ['f1', 'f3'],
      interests: ['d1'],
      edits: { f1: 'Jerry eats no meat.' },
      news: false,
    });
    expect(m.vm.data.status).toBe('done');
    expect(currentSnackbar()).toMatchObject({ tone: 'success', message: 'Saved. Goose now knows 2 more about you and follows 1 more for you.' });
    await m.unmount();
  });

  it('takes a blanked rewording back to the drafted sentence, and a re-ticked row back in', async () => {
    pond.memberInterview.mockResolvedValue(review());
    pond.approveMemberInterview.mockResolvedValue({ facts: 3, interests: 2, news: true });
    const m = await mount();
    act(() => {
      m.vm.actions.reword('f1', 'Jerry eats no meat.');
      m.vm.actions.keepFact('f2', false);
    });
    act(() => {
      m.vm.actions.reword('f1', '   ');
      m.vm.actions.keepFact('f2', true);
    });
    expect(m.vm.review.facts[0].content).toBe('Jerry is vegetarian.');
    await act(async () => {
      await m.vm.actions.approve();
    });
    expect(pond.approveMemberInterview).toHaveBeenCalledWith({ facts: ['f1', 'f2', 'f3'], interests: ['d1', 'd2'], news: true });
    await m.unmount();
  });

  it('leaves the news settings alone when the interview drafted none, and says when nothing was kept', async () => {
    pond.memberInterview.mockResolvedValue(review({ facts: [], interests: [], news: null }));
    pond.approveMemberInterview.mockResolvedValue({ facts: 0, interests: 0, news: false });
    const m = await mount();
    expect(m.vm.review.keepCount).toBe(0);
    await act(async () => {
      await m.vm.actions.approve();
    });
    expect(pond.approveMemberInterview).toHaveBeenCalledWith({ facts: [], interests: [], news: false });
    expect(m.vm.data.status).toBe('done');
    expect(currentSnackbar()).toMatchObject({ tone: 'neutral', message: 'Nothing was kept.' });
    await m.unmount();
  });

  it('ticks everything again for the draft of an interview taken again', async () => {
    pond.memberInterview.mockResolvedValue(review());
    pond.approveMemberInterview.mockResolvedValue({ facts: 2, interests: 2, news: true });
    pond.startMemberInterview.mockResolvedValue(asking(DIET, 0));
    pond.finishMemberInterview.mockResolvedValue(review());
    const m = await mount();
    act(() => m.vm.actions.keepFact('f1', false));
    await act(async () => {
      await m.vm.actions.approve();
    });
    await act(async () => {
      await m.vm.actions.start();
    });
    await act(async () => {
      await m.vm.actions.finish();
    });
    expect(m.vm.review.keepCount).toBe(5);
    await m.unmount();
  });
});

describe('a call the Pond refuses', () => {
  it('keeps the question open after a failed answer, says so, and takes the next try', async () => {
    pond.answerMemberInterview.mockRejectedValueOnce(new ApiError('POST → 500', 500, null));
    pond.answerMemberInterview.mockResolvedValue(asking(SPORTS));
    const m = await mount();
    let answered: unknown = undefined;
    await act(async () => {
      answered = await m.vm.actions.answer({ choices: ['Vegan'] });
    });
    expect(answered).toBeNull();
    expect(m.vm.question?.id).toBe('q1');
    expect(m.vm.busy).toBe(false);
    expect(m.vm.failed).toBe(false);
    expect(currentSnackbar()?.tone).toBe('danger');

    await act(async () => {
      await m.vm.actions.answer({ choices: ['Vegan'] });
    });
    expect(pond.answerMemberInterview).toHaveBeenCalledTimes(2);
    expect(m.vm.question?.id).toBe('q2');
    await m.unmount();
  });

  it('keeps the draft and its ticks after a failed approve', async () => {
    pond.memberInterview.mockResolvedValue(review());
    pond.approveMemberInterview.mockRejectedValueOnce(new ApiError('POST → 503', 503, null));
    pond.approveMemberInterview.mockResolvedValue({ facts: 2, interests: 2, news: true });
    const m = await mount();
    act(() => m.vm.actions.keepFact('f3', false));
    let kept: unknown = undefined;
    await act(async () => {
      kept = await m.vm.actions.approve();
    });
    expect(kept).toBeNull();
    expect(m.vm.data.status).toBe('review');
    expect(m.vm.review.keepCount).toBe(4);
    expect(m.vm.busy).toBe(false);
    expect(currentSnackbar()?.tone).toBe('danger');

    await act(async () => {
      await m.vm.actions.approve();
    });
    expect(pond.approveMemberInterview).toHaveBeenLastCalledWith({ facts: ['f1', 'f2'], interests: ['d1', 'd2'], news: true });
    expect(m.vm.data.status).toBe('done');
    await m.unmount();
  });

  it('reports a first read that fails as failed, and recovers on the next', async () => {
    pond.memberInterview.mockRejectedValueOnce(new ApiError('GET → 500', 500, null));
    const m = await mount();
    expect(m.vm.failed).toBe(true);
    expect(m.vm.loading).toBe(false);
    await act(async () => {
      await m.vm.actions.reload();
    });
    expect(m.vm.failed).toBe(false);
    expect(m.vm.question?.id).toBe('q1');
    await m.unmount();
  });
});
