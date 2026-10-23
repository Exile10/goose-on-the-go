/**
 * Leaving a conversation mid-answer and coming back to it, through the hook.
 *
 * What used to happen: leaving gave the stream up, and the reopened
 * conversation showed the question with nothing under it until the answer
 * was saved. What must not happen instead: every conversation opened from the
 * wall asking the Pond about a run, when only one that ends in an unanswered
 * question can have one.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { api } from '@/services/api-client';
import '@/services/i18n';
import type { ChatFrame, SessionMessage } from '@/services/types';
import { useChat, type UseChat } from '@/view-models/use-chat';

jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      listSessionMessages: jest.fn(),
      listSessions: jest.fn(),
      activeRun: jest.fn(),
      reattachRun: jest.fn(),
      streamChat: jest.fn(),
      cancelRun: jest.fn(),
    },
  };
});

jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: true, isScreenReal: () => true }),
}));

jest.mock('@/services/card-cache', () => ({
  cardsFor: () => Promise.resolve({}),
  rememberCard: () => Promise.resolve(),
}));

const pond = jest.mocked(api);

interface Opened {
  onFrame: (frame: ChatFrame) => void;
  resolve: () => void;
}

/** Each call to a streaming route stays open until the test ends it. */
function holdOpen(route: jest.Mock): Opened[] {
  const opened: Opened[] = [];
  route.mockImplementation((...args: unknown[]) => {
    const onFrame = args[args.length - 2] as (frame: ChatFrame) => void;
    return new Promise<void>((resolve) => opened.push({ onFrame, resolve }));
  });
  return opened;
}

function row(role: SessionMessage['role'], content: string, id: string): SessionMessage {
  return { id, session_id: 's1', role, content, created_at: '2026-10-23T10:00:00Z' };
}

async function mount(): Promise<{ readonly vm: UseChat; unmount: () => Promise<void> }> {
  let latest!: UseChat;
  const Probe = () => {
    latest = useChat();
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

/** Let the stream's frames reach the screen, which batches them. */
const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 80)));

/** Frames as the Pond sends them, then the end of the stream if `end`. */
const deliver = (stream: Opened, frames: ChatFrame[], end = false) =>
  act(async () => {
    for (const frame of frames) stream.onFrame(frame);
    if (end) stream.resolve();
  });

beforeEach(() => {
  jest.clearAllMocks();
  pond.listSessions.mockResolvedValue([]);
  pond.cancelRun.mockResolvedValue(undefined);
  pond.activeRun.mockResolvedValue(null);
});

describe('opening a conversation', () => {
  it('asks about no run when the conversation ends in an answer', async () => {
    pond.listSessionMessages.mockResolvedValue([row('user', 'Hi', 'm1'), row('assistant', 'Hello.', 'm2')]);
    const chat = await mount();
    await act(async () => chat.vm.actions.open('s1', 'Hi'));
    await flush();

    expect(chat.vm.data.messages.map((m) => m.content)).toEqual(['Hi', 'Hello.']);
    expect(chat.vm.data.streaming).toBe(false);
    expect(pond.listSessionMessages).toHaveBeenCalledTimes(1);
    expect(pond.activeRun).not.toHaveBeenCalled();
    expect(pond.reattachRun).not.toHaveBeenCalled();
    await chat.unmount();
  });

  it('finds the run once for an unanswered question, and draws the reply as it streams', async () => {
    pond.listSessionMessages.mockResolvedValue([row('user', 'Will it rain?', 'm1')]);
    pond.activeRun.mockResolvedValue({
      run_id: 'r1',
      session_id: 's1',
      state: 'running',
      started_at: '2026-10-23T10:00:00Z',
      first_seq: 1,
      last_seq: 3,
      epoch: 'e1',
    });
    const reattached = holdOpen(pond.reattachRun);
    const chat = await mount();
    await act(async () => chat.vm.actions.open('s1', 'Rain'));
    await flush();

    expect(pond.activeRun).toHaveBeenCalledTimes(1);
    expect(pond.reattachRun).toHaveBeenCalledTimes(1);
    expect(pond.reattachRun.mock.calls[0].slice(0, 3)).toEqual(['r1', 0, 'e1']);
    expect(chat.vm.data.streaming).toBe(true);

    await deliver(reattached[0], [{ type: 'text', content: 'Not today.', seq: 4 }]);
    await flush();
    const reply = chat.vm.data.messages[chat.vm.data.messages.length - 1];
    expect(reply).toMatchObject({ role: 'assistant', content: 'Not today.', pending: true });

    await deliver(reattached[0], [{ done: true, session_id: 's1', seq: 5 }], true);
    await flush();
    expect(chat.vm.data.streaming).toBe(false);
    expect(chat.vm.data.messages.map((m) => [m.role, m.content, Boolean(m.pending)])).toEqual([
      ['user', 'Will it rain?', false],
      ['assistant', 'Not today.', false],
    ]);
    expect(pond.listSessionMessages).toHaveBeenCalledTimes(1);
    await chat.unmount();
  });

  it('follows nothing when the Pond has no run for the question', async () => {
    pond.listSessionMessages.mockResolvedValue([row('user', 'Will it rain?', 'm1')]);
    const chat = await mount();
    await act(async () => chat.vm.actions.open('s1'));
    await flush();
    expect(pond.activeRun).toHaveBeenCalledTimes(1);
    expect(pond.reattachRun).not.toHaveBeenCalled();
    expect(chat.vm.data.streaming).toBe(false);
    await chat.unmount();
  });
});

describe('leaving mid-answer', () => {
  it('does not stop the turn, and the conversation reopens on the reply so far', async () => {
    const streams = holdOpen(pond.streamChat);
    const first = await mount();
    await act(async () => void first.vm.actions.send('Will it rain?'));
    await deliver(streams[0], [
      { type: 'run_started', run_id: 'r1', session_id: 's1', epoch: 'e1', seq: 1 },
      { type: 'text', content: 'Not ', seq: 2 },
    ]);
    await flush();
    await first.unmount();
    expect(pond.cancelRun).not.toHaveBeenCalled();

    // Back from the wall: the Pond has saved the question and nothing else yet.
    pond.listSessionMessages.mockResolvedValue([row('user', 'Will it rain?', 'm1')]);
    const again = await mount();
    await act(async () => again.vm.actions.open('s1', 'Rain'));
    await flush();
    expect(pond.activeRun).not.toHaveBeenCalled();
    expect(again.vm.data.streaming).toBe(true);

    await deliver(
      streams[0],
      [
        { type: 'text', content: 'today.', seq: 3 },
        { done: true, session_id: 's1', seq: 4 },
      ],
      true,
    );
    await flush();
    expect(again.vm.data.messages.map((m) => m.content)).toEqual(['Will it rain?', 'Not today.']);
    expect(again.vm.data.streaming).toBe(false);
    expect(pond.streamChat).toHaveBeenCalledTimes(1);
    expect(pond.reattachRun).not.toHaveBeenCalled();
    await again.unmount();
  });
});
