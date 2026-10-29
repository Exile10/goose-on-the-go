// A finished short answer is read whole on its card, where the conversation is; a report keeps its
// one line and the button that opens it. Against goose-in-a-pond's feat/answer-shape.

import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { LongTaskCard } from '@/components/patterns/long-task-card';
import { api } from '@/services/api-client';
import { forgetLongTasks } from '@/services/long-task-cache';
import type { LongTask } from '@/services/types';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
// lucide is not transformed under jest.
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));
jest.mock('@/providers/confirm-provider', () => ({ useConfirm: () => jest.fn().mockResolvedValue(false) }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect: run } = jest.requireActual('react');
    run(effect, [effect]);
  },
}));
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true, online: true, isScreenReal: () => true }) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { longTask: jest.fn(), cancelLongTask: jest.fn() } };
});

const pond = jest.mocked(api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = 'task-short-0001';
const ANSWER = 'Take the **Madaraka Express** at 08:00 and stay two nights by Nyali beach.\n\nFort Jesus is a short walk from the old town. [Timetable](https://metickets.krc.co.ke)';

function task(over: Partial<LongTask> = {}): LongTask {
  return {
    id: ID,
    kind: 'research',
    goal: 'A weekend in Mombasa',
    state: 'completed',
    origin_session_id: 's1',
    created_at: '',
    updated_at: '',
    finished_at: '',
    steps: [],
    artifacts: [{ id: 'art1', task_id: ID, step_key: null, kind: 'report', title: 'Weekend in Mombasa', summary: 'Two nights by the beach.', tokens: 90, created_at: '' }],
    result_artifact_id: 'art1',
    queue: null,
    ...over,
  };
}

async function draw(t: LongTask): Promise<ReactTestRenderer> {
  pond.longTask.mockResolvedValue(t);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<LongTaskCard taskId={ID} callId={`deep-research-${ID}`} />);
  });
  return tree;
}

function words(node: ReactTestInstance): string {
  const out: string[] = [];
  const walk = (n: ReactTestInstance | string) => {
    if (typeof n === 'string') out.push(n);
    else n.children.forEach(walk);
  };
  walk(node);
  return out.join('');
}

const text = (tree: ReactTestRenderer) => words(tree.root);

const buttons = (tree: ReactTestRenderer) =>
  tree.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'button').map(words);

let warn: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  forgetLongTasks();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

describe("the card's answer", () => {
  it('shows a finished short answer whole, and no report to open', async () => {
    const tree = await draw(task({ answer: 'short', answer_text: ANSWER }));
    const shown = text(tree);
    expect(shown).toContain('Madaraka Express');
    expect(shown).toContain('Fort Jesus is a short walk from the old town.');
    expect(shown).toContain('Timetable');
    expect(shown).not.toContain('Weekend in Mombasa');
    expect(buttons(tree)).not.toContain('Read the result');
    await act(async () => tree.unmount());
  });

  it("keeps a report's line and the button that opens it", async () => {
    const tree = await draw(task({ answer: 'report', answer_text: null }));
    expect(text(tree)).toContain('Weekend in Mombasa');
    expect(text(tree)).not.toContain('Madaraka Express');
    expect(buttons(tree)).toContain('Read the result');
    await act(async () => tree.unmount());
  });

  it("keeps the report's line for an older Pond, and for a short answer with no text", async () => {
    for (const t of [task(), task({ answer: 'short', answer_text: '  ' }), task({ answer: 'short', answer_text: null })]) {
      const tree = await draw(t);
      expect(text(tree)).toContain('Weekend in Mombasa');
      expect(buttons(tree)).toContain('Read the result');
      await act(async () => tree.unmount());
      forgetLongTasks();
    }
  });

  it('does not show a short answer before the task has finished', async () => {
    const tree = await draw(task({ state: 'running', answer: 'short', answer_text: ANSWER, result_artifact_id: null, artifacts: [], finished_at: null }));
    expect(text(tree)).not.toContain('Madaraka Express');
    await act(async () => tree.unmount());
  });
});
