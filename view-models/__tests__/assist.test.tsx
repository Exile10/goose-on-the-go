// The assist overlay: what it shows of the conversation, when it decides the conversation is over,
// and how it reaches the Pond and the app.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { Message } from '@/models/chat';
import type { VoiceState } from '@/models/voice';
import { NOT_STARTED, followVoice, lastExchange, useAssist, type UseAssist } from '@/view-models/use-assist';

const mockSession = { ready: jest.fn<Promise<boolean>, []>() };
jest.mock('@/services/pond-session', () => ({ ensurePondSession: () => mockSession.ready() }));

const mockClose = jest.fn(async () => undefined);
const mockLock = { locked: false, unlock: jest.fn(async () => true) };
jest.mock('@/services/phone-assistant', () => ({
  closeAssist: () => mockClose(),
  phoneLocked: () => mockLock.locked,
  unlockPhone: () => mockLock.unlock(),
}));

const mockLinking = { openURL: jest.fn(async (_url: string) => true) };
jest.mock('expo-linking', () => ({
  createURL: (path: string, options?: { queryParams?: Record<string, string> }) =>
    `gooseonthego://${path.replace(/^\//, '')}${options?.queryParams ? `?${new URLSearchParams(options.queryParams)}` : ''}`,
  openURL: (url: string) => mockLinking.openURL(url),
}));

const mockChat = {
  connections: [] as { hydrated: boolean; isScreenReal: (screen: 'chat') => boolean }[],
  messages: [] as Message[],
  sessionId: null as string | null,
  send: jest.fn(),
  stop: jest.fn(),
};
jest.mock('@/view-models/use-chat', () => ({
  useChatOn: (connection: { hydrated: boolean; isScreenReal: (screen: 'chat') => boolean }) => {
    mockChat.connections.push(connection);
    return {
      data: { messages: mockChat.messages, sessionId: mockChat.sessionId },
      actions: { send: mockChat.send, stop: mockChat.stop },
    };
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const message = (role: Message['role'], content: string): Message => ({ id: `${role}-${content}`, role, content, timestamp: 0 });

describe('followVoice', () => {
  const run = (states: VoiceState[]) => states.reduce(followVoice, NOT_STARTED);

  it('does not read the rest before the first listen as an ending', () => {
    expect(run(['idle'])).toEqual({ started: false, ended: false });
  });

  it('reads a return to rest after listening as the end', () => {
    expect(run(['idle', 'wait', 'recording', 'thinking', 'speaking', 'wait', 'idle']).ended).toBe(true);
  });

  it('does not end on an error, which a tap can still recover', () => {
    expect(run(['idle', 'error'])).toEqual({ started: false, ended: false });
    expect(run(['idle', 'wait', 'recording', 'thinking', 'error']).ended).toBe(false);
  });
});

describe('lastExchange', () => {
  it('is empty before anything is asked', () => {
    expect(lastExchange([])).toEqual({ asked: null, answer: null });
  });

  it('shows the last question and the answer after it, as it arrives', () => {
    const messages = [message('user', 'first'), message('assistant', 'one'), message('user', ' lights off '), message('assistant', '')];
    expect(lastExchange(messages)).toEqual({ asked: 'lights off', answer: null });
    messages[3] = message('assistant', 'Done.');
    expect(lastExchange(messages)).toEqual({ asked: 'lights off', answer: 'Done.' });
  });
});

const trees: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => trees.splice(0).forEach((t) => t.unmount()));
  jest.clearAllMocks();
  mockChat.connections.length = 0;
  mockChat.messages = [];
  mockChat.sessionId = null;
});

async function mount(ready: boolean) {
  mockSession.ready.mockResolvedValue(ready);
  let latest!: UseAssist;
  const Probe = () => {
    latest = useAssist();
    return null;
  };
  await act(async () => {
    trees.push(create(<Probe />));
  });
  return { get vm() { return latest; } };
}

describe('useAssist', () => {
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('is ready once the Pond session is, and only then counts as hydrated', async () => {
    const view = await mount(true);
    expect(view.vm.data.link).toBe('ready');
    expect(mockChat.connections[0].hydrated).toBe(false);
    expect(mockChat.connections[mockChat.connections.length - 1].hydrated).toBe(true);
    // No Developer screen reaches the overlay: chat is the release answer, the real Pond.
    expect(mockChat.connections[0].isScreenReal('chat')).toBe(true);
  });

  it('says so when no Pond can be reached', async () => {
    const view = await mount(false);
    expect(view.vm.data.link).toBe('unreachable');
  });

  it('closes once, when the conversation ends', async () => {
    const view = await mount(true);
    act(() => view.vm.actions.voiceChanged('idle'));
    expect(mockClose).not.toHaveBeenCalled();
    for (const state of ['wait', 'recording', 'thinking', 'speaking', 'wait'] as const) act(() => view.vm.actions.voiceChanged(state));
    expect(mockClose).not.toHaveBeenCalled();
    act(() => view.vm.actions.voiceChanged('idle'));
    act(() => view.vm.actions.voiceChanged('idle'));
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('asks as a locked phone over the lock screen, and as the member once unlocked', async () => {
    mockLock.locked = true;
    const view = await mount(true);
    expect(view.vm.data.locked).toBe(true);
    act(() => {
      void view.vm.actions.send('what is on my calendar', [], { voice: true });
    });
    expect(mockChat.send).toHaveBeenLastCalledWith('what is on my calendar', [], { voice: true, locked: true });

    mockLock.unlock.mockImplementationOnce(async () => {
      mockLock.locked = false;
      return true;
    });
    await act(async () => {
      await view.vm.actions.unlock();
    });
    expect(view.vm.data.locked).toBe(false);
    act(() => {
      void view.vm.actions.send('and tomorrow', [], { voice: true });
    });
    expect(mockChat.send).toHaveBeenLastCalledWith('and tomorrow', [], { voice: true, locked: false });
  });

  it('opens the app from a locked phone only once it is unlocked', async () => {
    mockLock.locked = true;
    mockLinking.openURL.mockClear();
    const view = await mount(true);
    mockLock.unlock.mockResolvedValueOnce(false);
    await act(async () => {
      view.vm.actions.openApp();
      await Promise.resolve();
    });
    expect(mockLinking.openURL).not.toHaveBeenCalled();
    mockLock.locked = false;
  });

  it('carries the conversation into the app, or opens the app when there is none yet', async () => {
    const view = await mount(true);
    act(() => view.vm.actions.openApp());
    expect(mockLinking.openURL).toHaveBeenLastCalledWith('gooseonthego://');
    mockChat.sessionId = 'abc';
    const again = await mount(true);
    act(() => again.vm.actions.openApp());
    expect(mockLinking.openURL).toHaveBeenLastCalledWith('gooseonthego://conversation?session=abc');
  });
});
