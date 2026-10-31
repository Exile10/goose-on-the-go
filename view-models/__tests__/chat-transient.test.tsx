/**
 * Results the Pond keeps only for the turn: the phone draws their card live, never keeps it, and
 * shows the stub when the conversation is read back.
 *
 * Brave's terms allow search results only transient storage, so a search card kept in AsyncStorage
 * would outlive the copy the Pond itself throws away.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/services/i18n';
import { api } from '@/services/api-client';
import { cardsFor, forgetCalls, rememberCard } from '@/services/card-cache';
import type { ChatFrame, SessionMessage } from '@/services/types';
import { useChat, type UseChat } from '@/view-models/use-chat';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      streamChat: jest.fn(),
      reattachRun: jest.fn(),
      cancelRun: jest.fn(),
      listSessions: jest.fn(),
      listSessionMessages: jest.fn(),
    },
  };
});
jest.mock('@/services/card-cache', () => ({
  rememberCard: jest.fn(async () => undefined),
  cardsFor: jest.fn(async () => ({})),
  forgetCalls: jest.fn(async () => undefined),
}));
jest.mock('@/services/media', () => ({ composeMessage: (text: string) => text }));
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: true, isScreenReal: () => true }),
}));

const pond = jest.mocked(api);

const SEARCH = { card_type: 'search', data: { query: 'outage', results: [{ title: 'Notice', url: 'https://kplc.example/' }] } };
const WEATHER = { card_type: 'weather', data: { location: 'Nairobi', temperature: 23 } };
const STUB = 'Web search results are not kept after the turn. Sources: kenyapower.co.ke.';

/** A turn that searched (transient) and then checked the weather (kept), as `routes.rs` sends it. */
const turn = (named: boolean): ChatFrame[] => [
  { type: 'run_started', run_id: 'r1', ...(named ? { session_id: 's1' } : {}) },
  { type: 'tool_call', tool: 'giap-knowledge__search_web', id: 'c1' },
  { type: 'tool_result', tool: 'giap-knowledge__search_web', id: 'c1', transient: true, content: 'Web results for: outage', ui: SEARCH },
  { type: 'tool_call', tool: 'giap-weather__get_current_weather', id: 'c2' },
  { type: 'tool_result', tool: 'giap-weather__get_current_weather', id: 'c2', content: '23C', ui: WEATHER },
  { type: 'text', content: 'There is a notice for Westlands.' },
  { done: true, session_id: 's1' },
];

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

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.clearAllMocks();
  pond.listSessions.mockResolvedValue([]);
});

describe('a live turn', () => {
  it.each([
    ['named from the start', true],
    ['named only when it ends', false],
  ])('keeps the cards of a conversation %s, except a transient one', async (_, named) => {
    pond.streamChat.mockImplementation(async (_body, onFrame) => {
      for (const frame of turn(named)) onFrame(frame);
    });
    const m = await mount();

    await act(async () => {
      await m.vm.actions.send('Is there an outage?');
    });

    expect(rememberCard).toHaveBeenCalledTimes(1);
    expect(rememberCard).toHaveBeenCalledWith('s1', 'c2', { type: 'weather', data: WEATHER.data });
    // The turn on screen still draws the search card: only keeping it is refused.
    const reply = m.vm.data.messages.find((x) => x.role === 'assistant');
    expect(reply?.tools?.map((tool) => tool.card?.type)).toEqual(['search', 'weather']);
    await m.unmount();
  });
});

describe('reading a conversation back', () => {
  const rows: SessionMessage[] = [
    { id: 'u', session_id: 's1', role: 'user', content: 'Is there an outage?', created_at: '2026-10-28T10:00:00Z' },
    {
      id: 't1',
      session_id: 's1',
      role: 'tool',
      tool_call_id: 'c1',
      content: JSON.stringify({ tool_call_id: 'c1', tool: 'giap-knowledge__search_web', content: STUB, arguments: '{}', transient: true }),
      created_at: '2026-10-28T10:00:01Z',
    },
    {
      id: 't2',
      session_id: 's1',
      role: 'tool',
      tool_call_id: 'c2',
      content: JSON.stringify({ tool_call_id: 'c2', tool: 'giap-weather__get_current_weather', content: '23C', arguments: '{}' }),
      created_at: '2026-10-28T10:00:02Z',
    },
    {
      id: 'a',
      session_id: 's1',
      role: 'assistant',
      content: 'There is a notice for Westlands.',
      tool_calls: [
        { id: 'c1', name: 'giap-knowledge__search_web', arguments: '{}' },
        { id: 'c2', name: 'giap-weather__get_current_weather', arguments: '{}' },
      ],
      created_at: '2026-10-28T10:00:03Z',
    },
  ];

  it('shows the stub, and drops a card this phone kept before the Pond marked the result transient', async () => {
    pond.listSessionMessages.mockResolvedValue(rows);
    jest.mocked(cardsFor).mockResolvedValue({
      c1: { type: 'search', data: SEARCH.data },
      c2: { type: 'weather', data: WEATHER.data },
    });
    const m = await mount();

    await act(async () => {
      m.vm.actions.open('s1');
    });

    const answer = m.vm.data.messages.find((x) => x.role === 'assistant');
    expect(answer?.tools?.map((tool) => [tool.kept ?? null, tool.card?.type ?? null])).toEqual([
      [STUB, null],
      [null, 'weather'],
    ]);
    expect(forgetCalls).toHaveBeenCalledWith('s1', ['c1']);
    await m.unmount();
  });

  it('forgets nothing when nothing transient was kept', async () => {
    pond.listSessionMessages.mockResolvedValue(rows);
    jest.mocked(cardsFor).mockResolvedValue({ c2: { type: 'weather', data: WEATHER.data } });
    const m = await mount();

    await act(async () => {
      m.vm.actions.open('s1');
    });

    expect(forgetCalls).toHaveBeenCalledWith('s1', []);
    await m.unmount();
  });
});
