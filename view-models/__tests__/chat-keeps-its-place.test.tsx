/**
 * What a conversation keeps when the screen showing it goes away and comes
 * back: its messages, a reply still being written, and the draft.
 *
 * Each `mount` is a fresh conversation screen, as expo-router gives one each
 * time a conversation is pushed over the wall, so anything that survives an
 * unmount and remount here survives leaving and reopening on the phone.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { api } from '@/services/api-client';
import {
  MAX_THREADS,
  NEW_DRAFT,
  draftFor,
  forgetAllThreads,
  forgetThreads,
  keepThread,
  moveDraft,
  newThread,
  setDraft,
  threadFor,
} from '@/services/chat-threads';
import type { ChatFrame, SessionMessage } from '@/services/types';
import { useChat, type UseChat } from '@/view-models/use-chat';

jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      listSessionMessages: jest.fn(),
      listSessions: jest.fn(),
      streamChat: jest.fn(),
      reattachRun: jest.fn(),
      cancelRun: jest.fn(),
    },
  };
});
jest.mock('@/services/card-cache', () => ({
  cardsFor: jest.fn().mockResolvedValue({}),
  rememberCard: jest.fn().mockResolvedValue(undefined),
  forgetCalls: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: true, isScreenReal: () => true }),
}));

const pond = jest.mocked(api);

type OnFrame = (frame: ChatFrame) => void;

function row(over: Partial<SessionMessage>): SessionMessage {
  return {
    id: 'm1',
    session_id: 's1',
    role: 'user',
    content: 'Is the porch light on?',
    created_at: '2026-10-22T09:00:00Z',
    ...over,
  };
}

const HISTORY: SessionMessage[] = [
  row({ id: 'm1' }),
  row({ id: 'm2', role: 'assistant', content: 'It is off.' }),
];

/** A stream that stays open until it is given up, as a long reply does. */
function hangUntilAborted(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((_, reject) => {
    signal?.addEventListener('abort', () => {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      reject(e);
    });
  });
}

/** A promise settled from outside, to hold a read in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Mounted {
  readonly vm: UseChat;
  unmount: () => Promise<void>;
}

async function mount(): Promise<Mounted> {
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

/** Let pending promises and the 50ms flush run. */
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 80)));

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.resetAllMocks();
  forgetAllThreads();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  pond.listSessions.mockResolvedValue([]);
  pond.listSessionMessages.mockResolvedValue(HISTORY);
  pond.cancelRun.mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('reopening a conversation', () => {
  it('shows what was there at once, rather than an empty screen until the Pond answers', async () => {
    const first = await mount();
    await act(async () => first.vm.actions.open('s1', 'Porch light'));
    await settle();
    expect(first.vm.data.messages.map((m) => m.content)).toEqual(['Is the porch light on?', 'It is off.']);
    await first.unmount();

    // The Pond is slow to answer this time.
    const slow = deferred<SessionMessage[]>();
    pond.listSessionMessages.mockReturnValueOnce(slow.promise);
    const again = await mount();
    await act(async () => again.vm.actions.open('s1'));

    expect(again.vm.data.messages.map((m) => m.content)).toEqual(['Is the porch light on?', 'It is off.']);
    expect(again.vm.loading).toBe(false);
    expect(again.vm.data.title).toBe('Porch light');

    // And the re-read lands behind it.
    await act(async () => slow.resolve([...HISTORY, row({ id: 'm3', content: 'Turn it on' })]));
    await settle();
    expect(again.vm.data.messages).toHaveLength(3);
  });

  it('shows the loading state for a conversation it has never read', async () => {
    const slow = deferred<SessionMessage[]>();
    pond.listSessionMessages.mockReturnValueOnce(slow.promise);
    const screen = await mount();
    await act(async () => screen.vm.actions.open('s1'));
    expect(screen.vm.loading).toBe(true);
    await act(async () => slow.resolve(HISTORY));
    await settle();
    expect(screen.vm.loading).toBe(false);
    expect(screen.vm.data.messages).toHaveLength(2);
  });

  it('keeps what was on screen when the re-read fails', async () => {
    const first = await mount();
    await act(async () => first.vm.actions.open('s1'));
    await settle();
    await first.unmount();

    pond.listSessionMessages.mockRejectedValueOnce(new TypeError('Network request failed'));
    const again = await mount();
    await act(async () => again.vm.actions.open('s1'));
    await settle();
    expect(again.vm.data.messages).toHaveLength(2);
    expect(again.vm.error).toBeNull();
  });

  it('does not let a read that a new turn overtook wipe the turn', async () => {
    const slow = deferred<SessionMessage[]>();
    pond.listSessionMessages.mockReturnValueOnce(slow.promise);
    pond.streamChat.mockImplementation(async (_body, onFrame: OnFrame) => {
      onFrame({ type: 'text', content: 'On it.', seq: 1 });
      onFrame({ done: true, session_id: 's1', seq: 2 });
    });
    const screen = await mount();
    await act(async () => screen.vm.actions.open('s1'));
    await act(async () => {
      await screen.vm.actions.send('Turn it on');
    });
    await act(async () => slow.resolve(HISTORY));
    await settle();
    expect(screen.vm.data.messages.map((m) => m.content)).toEqual(['Turn it on', 'On it.']);
  });
});

describe('a reply still being written when the screen goes', () => {
  beforeEach(() => {
    pond.streamChat.mockImplementation(async (_body, onFrame: OnFrame, signal?: AbortSignal) => {
      onFrame({ type: 'run_started', run_id: 'r1', session_id: 's2', epoch: 7, seq: 1 });
      onFrame({ type: 'text', content: 'The porch ', seq: 2 });
      return hangUntilAborted(signal);
    });
    pond.reattachRun.mockImplementation(async (_run, _after, _epoch, onFrame: OnFrame) => {
      onFrame({ type: 'text', content: 'light is off.', seq: 3 });
      onFrame({ done: true, session_id: 's2', seq: 4 });
    });
  });

  it('keeps streaming while the screen is gone, and reopens on the reply so far', async () => {
    let more!: OnFrame;
    const end = deferred<void>();
    pond.streamChat.mockImplementationOnce(async (_body, onFrame: OnFrame) => {
      more = onFrame;
      onFrame({ type: 'run_started', run_id: 'r1', session_id: 's2', epoch: 7, seq: 1 });
      onFrame({ type: 'text', content: 'The porch ', seq: 2 });
      return end.promise;
    });
    const first = await mount();
    await act(async () => {
      void first.vm.actions.send('Is the porch light on?');
    });
    await settle();
    expect(first.vm.data.messages[1]).toMatchObject({ content: 'The porch ', pending: true });
    await first.unmount();

    // Left, not stopped: the stream is still held, and still writing.
    expect(pond.cancelRun).not.toHaveBeenCalled();
    await act(async () => more({ type: 'text', content: 'light is ', seq: 3 }));
    await settle();

    const again = await mount();
    await act(async () => again.vm.actions.open('s2'));
    // What arrived while nobody was looking is there at once.
    expect(again.vm.data.messages.map((m) => m.content)).toEqual(['Is the porch light on?', 'The porch light is ']);
    expect(again.vm.data.streaming).toBe(true);
    await act(async () => {
      more({ type: 'text', content: 'off.', seq: 4 });
      more({ done: true, session_id: 's2', seq: 5 });
      end.resolve();
    });
    await settle();

    expect(again.vm.data.messages[1]).toMatchObject({ content: 'The porch light is off.', pending: false });
    expect(again.vm.data.streaming).toBe(false);
    // Followed throughout: nothing to reattach, and nothing to re-read.
    expect(pond.reattachRun).not.toHaveBeenCalled();
    expect(pond.listSessionMessages).not.toHaveBeenCalled();
  });

  it('is read back from the Pond when the run is no longer in its memory', async () => {
    const { ApiError } = jest.requireActual('@/services/api-client');
    // The connection goes mid-reply, and by the time it is retried the Pond has restarted.
    pond.streamChat.mockImplementationOnce(async (_body, onFrame: OnFrame) => {
      onFrame({ type: 'run_started', run_id: 'r1', session_id: 's2', epoch: 7, seq: 1 });
      onFrame({ type: 'text', content: 'The porch ', seq: 2 });
    });
    pond.reattachRun.mockRejectedValueOnce(new ApiError('gone', 410, null, 'gone'));
    pond.listSessionMessages.mockResolvedValue([
      row({ id: 'm1', session_id: 's2', content: 'Is the porch light on?' }),
      row({ id: 'm2', session_id: 's2', role: 'assistant', content: 'The porch light is off.' }),
    ]);

    const first = await mount();
    await act(async () => {
      void first.vm.actions.send('Is the porch light on?');
    });
    await settle();
    await first.unmount();
    // The first reattach waits 800ms.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1000)));

    const again = await mount();
    await act(async () => again.vm.actions.open('s2'));
    await settle();
    expect(pond.listSessionMessages).toHaveBeenCalledWith('s2', expect.any(Number));
    expect(again.vm.data.messages.map((m) => m.content)).toEqual([
      'Is the porch light on?',
      'The porch light is off.',
    ]);
    expect(again.vm.error).toBeNull();
  });

  it('stays with its conversation when another is started, rather than being cancelled', async () => {
    let more!: OnFrame;
    const end = deferred<void>();
    pond.streamChat.mockImplementationOnce(async (_body, onFrame: OnFrame) => {
      more = onFrame;
      onFrame({ type: 'run_started', run_id: 'r1', session_id: 's2', epoch: 7, seq: 1 });
      onFrame({ type: 'text', content: 'The porch ', seq: 2 });
      return end.promise;
    });
    const screen = await mount();
    await act(async () => {
      void screen.vm.actions.send('Is the porch light on?');
    });
    await settle();
    await act(async () => screen.vm.actions.newConversation());
    await settle();

    expect(pond.cancelRun).not.toHaveBeenCalled();
    expect(screen.vm.data.messages).toEqual([]);
    expect(screen.vm.data.sessionId).toBeNull();
    expect(screen.vm.data.streaming).toBe(false);

    await act(async () => {
      more({ type: 'text', content: 'light is off.', seq: 3 });
      more({ done: true, session_id: 's2', seq: 4 });
      end.resolve();
    });
    await settle();
    // The kept thread has the whole reply before the Pond is read again behind it.
    pond.listSessionMessages.mockReturnValue(new Promise(() => {}));
    await act(async () => screen.vm.actions.open('s2'));
    expect(screen.vm.data.messages[1]).toMatchObject({ content: 'The porch light is off.', pending: false });
  });

  it('does not hold up the next conversation behind it', async () => {
    const end = deferred<void>();
    pond.streamChat.mockImplementationOnce(async (_body, onFrame: OnFrame) => {
      onFrame({ type: 'run_started', run_id: 'r1', session_id: 's2', epoch: 7, seq: 1 });
      return end.promise;
    });
    pond.streamChat.mockImplementationOnce(async (_body, onFrame: OnFrame) => {
      onFrame({ type: 'run_started', run_id: 'r2', session_id: 's3', epoch: 7, seq: 1 });
      onFrame({ type: 'text', content: 'Yes.', seq: 2 });
      onFrame({ done: true, session_id: 's3', seq: 3 });
    });
    const screen = await mount();
    await act(async () => {
      void screen.vm.actions.send('Is the porch light on?');
    });
    await settle();
    await act(async () => screen.vm.actions.newConversation());
    await act(async () => {
      void screen.vm.actions.send('Is the door locked?');
    });
    await settle();
    expect(pond.streamChat).toHaveBeenCalledTimes(2);
    expect(screen.vm.data.messages.map((m) => m.content)).toEqual(['Is the door locked?', 'Yes.']);
    await act(async () => end.resolve());
  });

  it('is still cancelled by stop, which is what stop means', async () => {
    const screen = await mount();
    await act(async () => {
      void screen.vm.actions.send('Is the porch light on?');
    });
    await settle();
    await act(async () => screen.vm.actions.stop());
    await settle();
    expect(pond.cancelRun).toHaveBeenCalledWith('r1');
    expect(screen.vm.data.messages[1]).toMatchObject({ content: 'The porch ', pending: false });
  });
});

describe('the thread and draft store', () => {
  it('keeps a draft per conversation, and moves a new one with it once named', () => {
    setDraft(NEW_DRAFT, 'and the kitchen');
    setDraft('s1', 'dim the lamp');
    expect(draftFor('s1')).toBe('dim the lamp');
    moveDraft(NEW_DRAFT, 's9');
    expect(draftFor(NEW_DRAFT)).toBe('');
    expect(draftFor('s9')).toBe('and the kitchen');
    setDraft('s1', '');
    expect(draftFor('s1')).toBe('');
  });

  it('forgets a deleted conversation and everything on sign-out', () => {
    const kept = newThread('s1');
    keepThread(kept);
    setDraft('s1', 'half a thought');
    forgetThreads(['s1']);
    expect(threadFor('s1')).toBeUndefined();
    expect(draftFor('s1')).toBe('');

    keepThread(newThread('s2'));
    setDraft('s2', 'x');
    forgetAllThreads();
    expect(threadFor('s2')).toBeUndefined();
    expect(draftFor('s2')).toBe('');
  });

  it('is bounded, opened least recently first, and never evicts a thread mid-turn', () => {
    const busy = newThread('busy');
    busy.turn = { key: 'turn-x', replyId: 'x', done: Promise.resolve() };
    keepThread(busy);
    keepThread(newThread('old'));
    for (let i = 0; i < MAX_THREADS; i += 1) keepThread(newThread(`s${i}`));
    expect(threadFor('busy')).toBe(busy);
    expect(threadFor('old')).toBeUndefined();
    expect(threadFor(`s${MAX_THREADS - 1}`)).toBeDefined();
  });

  it('holds no thread for a conversation the Pond has not named', () => {
    keepThread(newThread());
    expect(threadFor(NEW_DRAFT)).toBeUndefined();
  });
});
