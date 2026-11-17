/**
 * Goose's questions: a choice and the member's own words under Other are sent as the Pond takes
 * them, an answered or skipped question leaves the list, and a batch left empty goes with it.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { readQuestionBatches, type Question } from '@/models/anchors';
import { ApiError, api } from '@/services/api-client';
import { resetSnackbar } from '@/services/snackbar';
import { answerBody, canAnswer, EMPTY_DRAFT, pick, pickOther, useQuestions, type QuestionFilter, type UseQuestions } from '@/view-models/use-questions';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/secure-random', () => ({ randomBytes: (n: number) => new Uint8Array(n).fill(7) }));
jest.mock('@/services/haptics', () => ({ confirm: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { questions: jest.fn(), answerQuestion: jest.fn(), skipQuestion: jest.fn() } };
});
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true, isScreenReal: () => true }) }));
jest.mock('../use-live', () => ({
  useLive: (read: () => Promise<unknown>, _delay: unknown, enabled = true) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => {
      if (enabled) void read();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);
  },
}));

const pond = jest.mocked(api);

const held = () =>
  readQuestionBatches({
    batches: [
      {
        id: 'b1',
        purpose: 'anchor',
        anchor_id: 'a1',
        title: 'Questions about Diani trip',
        questions: [
          { id: 'q1', text: 'Where will you stay?', options: ['A hotel', 'A villa', 'Other'], multi: false },
          { id: 'q2', text: 'What do you want to do?', options: ['Snorkel', 'Kitesurf'], multi: true },
        ],
      },
      { id: 'b2', purpose: 'interest', anchor_id: null, title: 'Things you keep coming back to', questions: [{ id: 'q3', text: 'Follow chess?', options: ['Follow it', 'Not interested'], multi: false }] },
      { id: 'b3', purpose: 'profile', questions: [] },
    ],
  });

async function mount(filter?: QuestionFilter): Promise<{ readonly vm: UseQuestions; unmount: () => Promise<void> }> {
  let latest!: UseQuestions;
  const Probe = () => {
    latest = useQuestions(filter);
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  return {
    get vm() {
      return latest;
    },
    unmount: async () => {
      await act(async () => tree.unmount());
    },
  };
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  resetSnackbar();
  jest.resetAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  pond.questions.mockImplementation(async () => held());
  pond.answerQuestion.mockResolvedValue(undefined);
  pond.skipQuestion.mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('choosing an answer', () => {
  const single: Pick<Question, 'multi'> = { multi: false };
  const multi: Pick<Question, 'multi'> = { multi: true };

  it('keeps one choice in a single-answer question, and Other stands in for the options', () => {
    const a = pick(single, EMPTY_DRAFT, 'A hotel');
    const b = pick(single, a, 'A villa');
    expect(b.choices).toEqual(['A villa']);
    expect(pickOther(single, b, true)).toEqual({ choices: [], other: true, text: '' });
  });

  it('toggles choices in a multi-answer question, beside Other', () => {
    const a = pickOther(multi, pick(multi, pick(multi, EMPTY_DRAFT, 'Snorkel'), 'Kitesurf'), true);
    expect(a).toMatchObject({ choices: ['Snorkel', 'Kitesurf'], other: true });
    expect(pick(multi, a, 'Snorkel').choices).toEqual(['Kitesurf']);
  });

  it('sends the words under Other only when Other holds some', () => {
    expect(canAnswer({ choices: [], other: true, text: '  ' })).toBe(false);
    expect(answerBody({ choices: [], other: true, text: ' A friend’s flat ' })).toEqual({ choices: [], text: 'A friend’s flat' });
    expect(answerBody({ choices: ['A hotel'], other: false, text: 'left over' })).toEqual({ choices: ['A hotel'] });
  });
});

describe('the questions view-model', () => {
  it('reads the open batches, and drops one with no questions and an option named Other', async () => {
    const m = await mount();
    expect(m.vm.batches.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(m.vm.batches[0].questions[0].options).toEqual(['A hotel', 'A villa']);
    expect(m.vm.count).toBe(3);
    await m.unmount();
  });

  it('shows only the batch a notification named, or a plan’s batches', async () => {
    const named = await mount({ batchId: 'b2' });
    expect(named.vm.batches.map((b) => b.id)).toEqual(['b2']);
    await named.unmount();
    const plan = await mount({ anchorId: 'a1' });
    expect(plan.vm.batches.map((b) => b.id)).toEqual(['b1']);
    await plan.unmount();
  });

  it('answers with Other in the member’s own words, and the question leaves the list', async () => {
    const m = await mount();
    const q1 = m.vm.batches[0].questions[0];
    await act(async () => {
      m.vm.actions.chooseOther(q1, true);
    });
    await act(async () => {
      m.vm.actions.setOtherText(q1, 'With my aunt in Ukunda');
    });
    await act(async () => {
      await m.vm.actions.answer(q1);
    });
    expect(pond.answerQuestion).toHaveBeenCalledWith('q1', { choices: [], text: 'With my aunt in Ukunda' });
    expect(m.vm.batches[0].questions.map((q) => q.id)).toEqual(['q2']);
    expect(m.vm.draftOf('q1')).toEqual(EMPTY_DRAFT);
    await m.unmount();
  });

  it('sends nothing without a choice or words', async () => {
    const m = await mount();
    let sent = true;
    await act(async () => {
      sent = await m.vm.actions.answer(m.vm.batches[0].questions[0]);
    });
    expect(sent).toBe(false);
    expect(pond.answerQuestion).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('keeps the question and its answer when the Pond refuses', async () => {
    pond.answerQuestion.mockRejectedValue(new ApiError('POST → 422', 422, null));
    const m = await mount();
    const q3 = m.vm.batches[1].questions[0];
    await act(async () => {
      m.vm.actions.choose(q3, 'Follow it');
    });
    await act(async () => {
      await m.vm.actions.answer(q3);
    });
    expect(m.vm.batches[1].questions).toHaveLength(1);
    expect(m.vm.draftOf('q3').choices).toEqual(['Follow it']);
    await m.unmount();
  });

  it('skips a question, and a batch left empty goes with it', async () => {
    const m = await mount();
    await act(async () => {
      await m.vm.actions.skip(m.vm.batches[1].questions[0]);
    });
    expect(pond.skipQuestion).toHaveBeenCalledWith('q3');
    expect(m.vm.batches.map((b) => b.id)).toEqual(['b1']);
    await m.unmount();
  });
});
