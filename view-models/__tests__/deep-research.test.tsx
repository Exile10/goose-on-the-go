// Deep research from the composer, against the contract in goose-in-a-pond's feat/deep-research: what
// the menu offers, what the stream is sent, what a refusal says, and that the card finds the task. How
// much it writes is feat/answer-shape's `deep_research_answer`.

import React from 'react';
import type { TFunction } from 'i18next';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { Message } from '@/models/chat';
import { readLongTask, readResearchAvailability, researchOffer, startedTaskId } from '@/models/long-tasks';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { SessionMessage } from '@/services/types';
import { taskEyebrow } from '@/view-models/long-task-words';
import { applyFrame } from '@/services/chat-runs';
import { describeTurnError, fromHistory, streamBody } from '@/view-models/use-chat';
import {
  RESEARCH_ANSWERS,
  researchAnswerWords,
  researchItem,
  researchRefusal,
  useResearchMode,
  useResearchOffer,
  type ResearchMode,
} from '@/view-models/use-deep-research';
import { mockLongTasks, mockTaskStart, resetMockLongTasks } from '@/view-models/use-long-task';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
const server = { hydrated: true, online: true, profileId: 'pond-a', isScreenReal: () => true };
jest.mock('@/providers/server-provider', () => ({ useServer: () => server }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { deepResearchAvailability: jest.fn() } };
});

const pond = jest.mocked(api);
const t = i18n.t.bind(i18n) as unknown as TFunction;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const UUID = '7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

let warn: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  server.profileId = 'pond-a';
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

describe('what the menu offers', () => {
  it('reads the three answers, and anything else as nothing to offer', () => {
    expect(researchOffer(readResearchAvailability({ available: true }))).toBe('available');
    expect(researchOffer(readResearchAvailability({ available: false, reason: 'off' }))).toBe('hidden');
    expect(researchOffer(readResearchAvailability({ available: false, reason: 'unidentified' }))).toBe('unidentified');
    expect(researchOffer(readResearchAvailability({ available: false, reason: 'later' }))).toBe('hidden');
    expect(researchOffer(readResearchAvailability({ ok: true }))).toBe('hidden');
    expect(researchOffer(null)).toBe('hidden');
  });

  it('hides the row, greys it with why, or offers it; and never with pictures waiting', () => {
    expect(researchItem('hidden', 0)).toEqual({ shown: false, disabled: true, noteKey: null });
    expect(researchItem('unidentified', 0)).toEqual({ shown: true, disabled: true, noteKey: 'chat.research.unidentified' });
    expect(researchItem('available', 0)).toEqual({ shown: true, disabled: false, noteKey: null });
    expect(researchItem('available', 2)).toEqual({ shown: true, disabled: true, noteKey: 'chat.research.noAttachments' });
  });
});

describe('asking the Pond whether it offers research', () => {
  async function mount() {
    let latest = 'unset';
    let renders = 0;
    const Probe = ({ tick }: { tick: number }) => {
      renders += tick >= 0 ? 1 : 0;
      latest = useResearchOffer();
      return null;
    };
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<Probe tick={0} />);
    });
    return {
      get offer() {
        return latest;
      },
      get renders() {
        return renders;
      },
      rerender: (tick: number) => act(async () => tree.update(<Probe tick={tick} />)),
      unmount: () => act(() => tree.unmount()),
    };
  }

  it('asks once when the dock mounts, not on every render, and again for another Pond', async () => {
    pond.deepResearchAvailability.mockResolvedValue({ available: true });
    const m = await mount();
    expect(m.offer).toBe('available');
    await m.rerender(1);
    await m.rerender(2);
    expect(m.renders).toBeGreaterThan(2);
    expect(pond.deepResearchAvailability).toHaveBeenCalledTimes(1);

    server.profileId = 'pond-b';
    pond.deepResearchAvailability.mockResolvedValue({ available: false, reason: 'unidentified' });
    await m.rerender(3);
    expect(pond.deepResearchAvailability).toHaveBeenCalledTimes(2);
    expect(m.offer).toBe('unidentified');
    await m.unmount();
  });

  it('offers nothing on a Pond that predates research, or one that switched it off', async () => {
    pond.deepResearchAvailability.mockRejectedValue(new ApiError('GET → 404', 404, null));
    const old = await mount();
    expect(old.offer).toBe('hidden');
    await old.unmount();

    pond.deepResearchAvailability.mockResolvedValue({ available: false, reason: 'off' });
    const off = await mount();
    expect(off.offer).toBe('hidden');
    await off.unmount();
  });
});

describe('the composer in research mode', () => {
  async function mount(conversation: string | null) {
    let latest!: ResearchMode;
    const Probe = ({ c }: { c: string | null }) => {
      latest = useResearchMode(c);
      return null;
    };
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<Probe c={conversation} />);
    });
    return {
      get mode() {
        return latest;
      },
      move: (c: string | null) => act(async () => tree.update(<Probe c={c} />)),
      unmount: () => act(() => tree.unmount()),
    };
  }

  it('turns on, goes with one message, and is off for the next', async () => {
    const m = await mount('s1');
    await act(async () => {
      m.mode.start(0);
    });
    expect(m.mode.on).toBe(true);
    let wasResearch = false;
    await act(async () => {
      wasResearch = m.mode.take();
    });
    expect(wasResearch).toBe(true);
    expect(m.mode.on).toBe(false);
    await act(async () => {
      wasResearch = m.mode.take();
    });
    expect(wasResearch).toBe(false);
    await m.unmount();
  });

  it('comes off with its chip, and with a change of conversation', async () => {
    const m = await mount('s1');
    await act(async () => {
      m.mode.start(0);
    });
    await act(async () => m.mode.clear());
    expect(m.mode.on).toBe(false);

    await act(async () => {
      m.mode.start(0);
    });
    await m.move(null);
    expect(m.mode.on).toBe(false);
    await m.unmount();
  });

  it('asks the Pond to decide how much to write until the person picks', async () => {
    const m = await mount('s1');
    expect(m.mode.answer).toBe('auto');
    await act(async () => {
      m.mode.start(0);
    });
    expect(m.mode.answer).toBe('auto');
    await m.unmount();
  });

  it('keeps the pick for the next research, in this conversation or another, while the composer is up', async () => {
    const m = await mount('s1');
    await act(async () => {
      m.mode.start(0);
    });
    await act(async () => m.mode.choose('short'));
    expect(m.mode.answer).toBe('short');
    await act(async () => {
      m.mode.take();
    });
    expect(m.mode.on).toBe(false);
    expect(m.mode.answer).toBe('short');

    await act(async () => {
      m.mode.start(0);
    });
    await act(async () => m.mode.clear());
    await m.move('s2');
    expect(m.mode.answer).toBe('short');
    await m.unmount();

    const again = await mount('s2');
    expect(again.mode.answer).toBe('auto');
    await again.unmount();
  });

  it('offers the three in order, each with its words', () => {
    expect(RESEARCH_ANSWERS).toEqual(['auto', 'short', 'report']);
    expect(RESEARCH_ANSWERS.map((a) => [t(researchAnswerWords(a).labelKey), t(researchAnswerWords(a).hintKey)])).toEqual([
      ['Pond decides', 'Short for a quick question, a report for a big one.'],
      ['Short answer', 'A few sentences, here in the chat.'],
      ['Full report', 'Sections with sources, to read and export.'],
    ]);
    expect(t('chat.research.answer.label')).toBe('How much to write');
  });

  it('will not turn on while pictures or files wait to be sent', async () => {
    const m = await mount(null);
    let started = true;
    await act(async () => {
      started = m.mode.start(1);
    });
    expect(started).toBe(false);
    expect(m.mode.on).toBe(false);
    await m.unmount();
  });
});

describe('sending a research question', () => {
  it('carries deep_research only when the message is research', () => {
    expect(streamBody('Which solar panels suit a flat roof?', [], { research: true }, 's1')).toEqual({
      message: 'Which solar panels suit a flat roof?',
      session_id: 's1',
      voice_mode: false,
      resumable: true,
      deep_research: true,
    });
    expect('deep_research' in streamBody('Hello', [], {}, null)).toBe(false);
  });

  it('says how much to write for a short answer or a report, and leaves it to the Pond otherwise', () => {
    expect(streamBody('Is it worth it?', [], { research: true, answer: 'short' }, 's1')).toMatchObject({
      deep_research: true,
      deep_research_answer: 'short',
    });
    expect(streamBody('Compare the three', [], { research: true, answer: 'report' }, 's1')).toMatchObject({
      deep_research: true,
      deep_research_answer: 'report',
    });
    expect('deep_research_answer' in streamBody('Which?', [], { research: true, answer: 'auto' }, 's1')).toBe(false);
    expect('deep_research_answer' in streamBody('Which?', [], { research: true }, 's1')).toBe(false);
  });

  it('never says how much to write on a turn that is not research', () => {
    for (const answer of RESEARCH_ANSWERS) {
      const body = streamBody('Hello', [], { answer }, 's1');
      expect('deep_research' in body).toBe(false);
      expect('deep_research_answer' in body).toBe(false);
    }
    expect('deep_research_answer' in streamBody('Hello', [], { voice: true, answer: 'short' }, null)).toBe(false);
  });

  it("says the Pond's two refusals in words, and leaves other refusals alone", () => {
    const off = new ApiError('POST → 409', 409, null, 'switched off', { error: 'switched off', reason: 'deep_research_off' });
    const who = new ApiError('POST → 403', 403, null, 'who', { error: 'who', reason: 'deep_research_unidentified' });
    expect(researchRefusal(off)).toBe('off');
    expect(researchRefusal(who)).toBe('unidentified');
    expect(describeTurnError(off, t)).toBe('Your Pond has research switched off, so it did not take the question.');
    expect(describeTurnError(who, t)).toBe("Only a household member can ask for research, and your Pond doesn't know this phone as one.");
    expect(researchRefusal(new ApiError('POST → 403', 403, null, null, { reason: 'something_else' }))).toBeNull();
    expect(researchRefusal(new ApiError('POST → 409', 409, null))).toBeNull();
  });
});

describe('the card a research question starts', () => {
  const ANSWER = `Started task ${UUID}. The pond works on it while the household is quiet and tells the person on their phone when it is done.`;

  it('is found in the frames the contract names, live, with no change to the card', () => {
    const empty: Message = { id: 'r', role: 'assistant', content: '', timestamp: 0, pending: true };
    const frames = [
      { type: 'tool_call', tool: 'giap-tasks__task_start', id: `deep-research-${UUID}`, input: { goal: 'Solar panels for a flat roof' } },
      { type: 'tool_result', tool: 'giap-tasks__task_start', id: `deep-research-${UUID}`, content: ANSWER },
      { type: 'text', content: "I've started researching that." },
    ];
    const reply = frames.reduce(applyFrame, empty);
    expect(reply.tools).toHaveLength(1);
    expect(startedTaskId(reply.tools![0])).toBe(UUID);
  });

  it('is found again in a reopened conversation, when the call and its result are both stored', () => {
    const rows = [
      { id: 'u', role: 'user', content: 'Solar panels for a flat roof', created_at: '' },
      {
        id: 'a',
        role: 'assistant',
        content: "I've started researching that.",
        created_at: '',
        tool_calls: [{ id: `deep-research-${UUID}`, name: 'giap-tasks__task_start', arguments: '{}' }],
      },
      { id: 't', role: 'tool', content: JSON.stringify({ content: ANSWER }), tool_call_id: `deep-research-${UUID}`, created_at: '' },
    ] as unknown as SessionMessage[];
    const reply = fromHistory(rows).find((m) => m.role === 'assistant');
    expect(reply?.tools && startedTaskId(reply.tools[0])).toBe(UUID);
  });

  it('is called Deep research, from the task once read and from the call before', () => {
    expect(taskEyebrow('research', 'anything')).toBe('Deep research');
    expect(taskEyebrow('general', `deep-research-${UUID}`)).toBe('Long task');
    expect(taskEyebrow(null, `deep-research-${UUID}`)).toBe('Deep research');
    expect(taskEyebrow(null, 'call-1')).toBe('Long task');
  });

  it("reads a task's kind, and an older Pond's task with none as general", () => {
    const base = { id: UUID, goal: 'g', state: 'running', steps: [], artifacts: [] };
    expect(readLongTask({ ...base, kind: 'research' })?.kind).toBe('research');
    expect(readLongTask(base)?.kind).toBe('general');
    expect(readLongTask({ ...base, kind: 'other' })?.kind).toBe('general');
  });

  it('is what the mock chat starts when asked for research', () => {
    const call = mockTaskStart('Solar panels for a flat roof', 'research');
    expect(call.id.startsWith('deep-research-')).toBe(true);
    expect(startedTaskId(call)).not.toBeNull();
  });

  it('is a short answer in the mock when the person asked for one', async () => {
    resetMockLongTasks();
    const short = startedTaskId(mockTaskStart('Is a flat roof fine for panels?', 'research', 'short'))!;
    const report = startedTaskId(mockTaskStart('Compare panels for a flat roof', 'research'))!;
    expect((await mockLongTasks().task(short)).answer).toBe('short');
    expect((await mockLongTasks().task(report)).answer).toBe('auto');
    resetMockLongTasks();
  });
});
