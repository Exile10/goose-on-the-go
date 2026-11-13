/**
 * Answering what a message offers, through the hook: one request to the Pond, the offer marked
 * answered, and, when it was taken, its prompt sent as the person's own turn in that conversation.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import '@/services/i18n';
import { forgetAllThreads } from '@/services/chat-threads';
import type { ChatFrame, ChatStreamRequest, SessionMessage } from '@/services/types';
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
      answerOffer: jest.fn(),
    },
  };
});

jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: true, isScreenReal: () => true }),
}));

jest.mock('@/services/card-cache', () => ({
  cardsFor: () => Promise.resolve({}),
  rememberCard: () => Promise.resolve(),
  forgetCalls: () => Promise.resolve(),
}));

const pond = jest.mocked(api);

const OFFER = { noticed: 'You asked about the bins twice this week.', action: 'Remind me weekly', prompt: 'Remind me every Thursday to take the bins out' };

function offered(state: 'open' | 'done' | 'dismissed' = 'open'): SessionMessage[] {
  return [
    {
      id: 'm-offer',
      session_id: 'goose-m1',
      role: 'assistant',
      content: 'Bin day keeps coming up.',
      created_at: '2026-11-13T08:00:00Z',
      note: { from: { kind: 'suggestion', label: '' }, suggestion: { ...OFFER, state } },
    },
  ];
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

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 80)));

async function opened(): Promise<Awaited<ReturnType<typeof mount>>> {
  const chat = await mount();
  await act(async () => chat.vm.actions.open('goose-m1', 'Goose'));
  await flush();
  return chat;
}

const offerOf = (chat: { vm: UseChat }) => chat.vm.data.messages.find((m) => m.id === 'm-offer')?.note?.offer;

beforeEach(() => {
  jest.clearAllMocks();
  forgetAllThreads();
  pond.listSessions.mockResolvedValue([]);
  pond.activeRun.mockResolvedValue(null);
  pond.listSessionMessages.mockResolvedValue(offered());
  // A turn that ends at once: the test is about what is asked, not what comes back.
  pond.streamChat.mockImplementation(async (_body: ChatStreamRequest, onFrame: (frame: ChatFrame) => void) => {
    onFrame({ done: true, session_id: 'goose-m1' });
  });
});

describe('taking an offer', () => {
  it('tells the Pond once, marks it done, and sends the prompt the Pond answered with in the same conversation', async () => {
    pond.answerOffer.mockResolvedValue({ state: 'done', prompt: 'Remind me every Thursday at 7 to take the bins out' });
    const chat = await opened();

    await act(async () => chat.vm.actions.answerOffer('m-offer', true));
    await flush();

    expect(pond.answerOffer.mock.calls).toEqual([['goose-m1', 'm-offer', true]]);
    expect(offerOf(chat)?.state).toBe('done');
    expect(pond.streamChat).toHaveBeenCalledTimes(1);
    expect(pond.streamChat.mock.calls[0][0]).toMatchObject({
      message: 'Remind me every Thursday at 7 to take the bins out',
      session_id: 'goose-m1',
    });
    await chat.unmount();
  });

  it('falls back to the offer\'s own prompt when the Pond answers with none', async () => {
    pond.answerOffer.mockResolvedValue({ state: 'done', prompt: '' });
    const chat = await opened();

    await act(async () => chat.vm.actions.answerOffer('m-offer', true));
    await flush();

    expect(pond.streamChat.mock.calls[0][0]).toMatchObject({ message: OFFER.prompt });
    await chat.unmount();
  });
});

describe('passing an offer over', () => {
  it('tells the Pond, marks it passed over, and sends nothing', async () => {
    pond.answerOffer.mockResolvedValue({ state: 'dismissed', prompt: OFFER.prompt });
    const chat = await opened();

    await act(async () => chat.vm.actions.answerOffer('m-offer', false));
    await flush();

    expect(pond.answerOffer.mock.calls).toEqual([['goose-m1', 'm-offer', false]]);
    expect(offerOf(chat)?.state).toBe('dismissed');
    expect(pond.streamChat).not.toHaveBeenCalled();
    await chat.unmount();
  });
});

describe('an offer that cannot be answered', () => {
  it('reads the message again when the Pond says it was already answered, and sends nothing', async () => {
    pond.answerOffer.mockRejectedValue(new ApiError('POST offer → 409', 409, null));
    const chat = await opened();
    pond.listSessionMessages.mockResolvedValue(offered('done'));

    await act(async () => chat.vm.actions.answerOffer('m-offer', true));
    await flush();

    expect(pond.listSessionMessages).toHaveBeenCalledTimes(2);
    expect(offerOf(chat)?.state).toBe('done');
    expect(pond.streamChat).not.toHaveBeenCalled();
    await chat.unmount();
  });

  it('says so and leaves the offer open when the Pond refuses for another reason', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    pond.answerOffer.mockRejectedValue(new ApiError('POST offer → 500', 500, null));
    const chat = await opened();

    await act(async () => chat.vm.actions.answerOffer('m-offer', true));
    await flush();

    expect(offerOf(chat)?.state).toBe('open');
    expect(chat.vm.error).toBeTruthy();
    expect(pond.streamChat).not.toHaveBeenCalled();
    warn.mockRestore();
    await chat.unmount();
  });

  it('asks the Pond nothing about an offer already answered', async () => {
    pond.listSessionMessages.mockResolvedValue(offered('dismissed'));
    const chat = await opened();

    await act(async () => chat.vm.actions.answerOffer('m-offer', true));

    expect(pond.answerOffer).not.toHaveBeenCalled();
    await chat.unmount();
  });
});
