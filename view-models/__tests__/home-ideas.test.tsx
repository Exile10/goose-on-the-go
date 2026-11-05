/**
 * Home's ideas: what it keeps from each of the Pond's four sources, when it may say nothing needs
 * you, and that a decision's confirmation goes away by itself.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import type { AgentSuggestion, Proposal, Reminder, Suggestion } from '@/services/types';
import {
  HOME_PROMPT_LIMIT,
  useHomeIdeas,
  type UseHomeIdeas,
} from '@/view-models/use-home-ideas';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/secure-random', () => ({ randomBytes: (n: number) => new Uint8Array(n).fill(7) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      listProposals: jest.fn(),
      decideProposal: jest.fn(),
      listReminders: jest.fn(),
      listSuggestions: jest.fn(),
      takeSuggestion: jest.fn(),
      listAgentSuggestions: jest.fn(),
    },
  };
});
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: true, isScreenReal: () => true }),
}));

// The poll is `use-live.test.ts`'s business; here it is one read on mount.
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

function proposal(id: string): Proposal {
  return {
    id,
    summary: `Do ${id}`,
    rationale: `Because of ${id}`,
    confidence: 0.8,
    profile_id: 'm1',
    created_at: '2026-10-31T09:00:00+00:00',
    expires_at: '2026-10-31T21:00:00+00:00',
    proposed_action: { type: 'agent_prompt', prompt: `Do ${id}` },
    trigger: { kind: 'sensor', source_id: 'garage', signal: 'open', observed_at: '2026-10-31T08:00:00+00:00' },
  };
}

function reminder(id: string, about: string): Reminder {
  return {
    id,
    about,
    when_said: '',
    subject: 'Jerry',
    profile_id: 'm1',
    said_at: '2026-10-30T09:00:00+00:00',
    captured_at: '2026-10-30T10:00:00+00:00',
    disposition: 'pending',
    session_id: 's1',
    window_id: 'w1',
  };
}

function offered(id: string): Suggestion {
  return { id, prompt: `Ask ${id}`, because: '', answered_by: 'goose', composed: true };
}

const WELCOME: AgentSuggestion = {
  template: 'welcome-back',
  title: ' Welcome back ',
  description: 'Says hello when someone comes home.',
  why: 'This Pond can tell when a phone arrives.',
  needs: ['presence'],
  activations_summary: 'When you come home',
};

interface Mounted {
  readonly vm: UseHomeIdeas;
  unmount: () => Promise<void>;
}

async function mount(): Promise<Mounted> {
  let latest!: UseHomeIdeas;
  const Probe = () => {
    latest = useHomeIdeas();
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
  jest.resetAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  pond.listProposals.mockResolvedValue([]);
  pond.decideProposal.mockResolvedValue({ id: 'p1', status: 'approved', executed: false });
  pond.listReminders.mockResolvedValue([]);
  pond.listSuggestions.mockResolvedValue({ suggestions: [], audience: 'personal' });
  pond.takeSuggestion.mockResolvedValue(undefined);
  pond.listAgentSuggestions.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useHomeIdeas', () => {
  it('puts every suggestion on the board, in the order the Pond gave', async () => {
    pond.listProposals.mockResolvedValue(['p1', 'p2', 'p3', 'p4'].map(proposal));
    const m = await mount();

    expect(m.vm.data.proposals.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    await m.unmount();
  });

  it('has nothing to put on the board when the Pond proposed nothing', async () => {
    const m = await mount();
    expect(m.vm.data.proposals).toEqual([]);
    await m.unmount();
  });

  // The fixed starters are right in an empty conversation and wrong here: the same chips every
  // day would be chrome, and the row would claim the Pond had ideas it does not.
  it('offers only the questions the Pond itself composed, never the fixed starters', async () => {
    const m = await mount();
    expect(m.vm.data.prompts).toEqual([]);
    await m.unmount();

    pond.listSuggestions.mockResolvedValue({ suggestions: ['a', 'b', 'c', 'd'].map(offered), audience: 'personal' });
    const n = await mount();
    expect(n.vm.data.prompts.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'].slice(0, HOME_PROMPT_LIMIT));
    await n.unmount();
  });

  it('asks for suggestions under a label of its own, never a real conversation', async () => {
    const m = await mount();
    const [label] = pond.listSuggestions.mock.calls[0];
    expect(label).toMatch(/^gotg-home-[0-9a-f]{32}$/);
    await m.unmount();
  });

  it('names the first reminder and how many wait behind it', async () => {
    pond.listReminders.mockResolvedValue([reminder('r1', ' Call the plumber '), reminder('r2', 'Pay rent'), reminder('r3', 'Book')]);
    const m = await mount();

    expect(m.vm.data.reminders?.first.text).toBe('Call the plumber');
    expect(m.vm.data.reminders?.more).toBe(2);
    expect(m.vm.data.reminderCount).toBe(3);
    await m.unmount();
  });

  it('offers the first agent the Pond could run, and none when that read fails', async () => {
    pond.listAgentSuggestions.mockResolvedValue([WELCOME]);
    const m = await mount();
    expect(m.vm.data.agent).toEqual({ template: 'welcome-back', title: 'Welcome back', when: 'When you come home' });
    await m.unmount();

    pond.listAgentSuggestions.mockRejectedValue(new ApiError('GET → 404', 404, null));
    const n = await mount();
    expect(n.vm.data.agent).toBeNull();
    await n.unmount();
  });

  describe('quiet', () => {
    it('says nothing needs you once both reads have answered with nothing', async () => {
      const m = await mount();
      expect(m.vm.quiet).toBe(true);
      await m.unmount();
    });

    it('is not quiet while a suggestion or a reminder waits', async () => {
      pond.listReminders.mockResolvedValue([reminder('r1', 'Call')]);
      const m = await mount();
      expect(m.vm.quiet).toBe(false);
      await m.unmount();
    });

    // A failed read is unknown, not empty: "nothing needs you" would be a guess stated as fact.
    it('is not quiet when a read failed', async () => {
      pond.listProposals.mockRejectedValue(new ApiError('GET → 502', 502, null));
      const m = await mount();
      expect(m.vm.data.proposals).toEqual([]);
      expect(m.vm.quiet).toBe(false);
      await m.unmount();
    });
  });

  it('decides with the Pond and re-reads', async () => {
    pond.listProposals.mockResolvedValueOnce([proposal('p1')]).mockResolvedValue([]);
    const m = await mount();

    await act(async () => {
      await m.vm.actions.approve('p1');
    });
    expect(pond.decideProposal).toHaveBeenCalledWith('p1', expect.stringMatching(/^gotg-suggestions-/), 'approve');
    expect(m.vm.data.proposals).toEqual([]);
    expect(m.vm.quiet).toBe(true);
    await m.unmount();
  });

  it('declines as a reject', async () => {
    pond.listProposals.mockResolvedValue([proposal('p1')]);
    const m = await mount();
    await act(async () => {
      await m.vm.actions.decline('p1');
    });
    expect(pond.decideProposal).toHaveBeenCalledWith('p1', expect.any(String), 'reject');
    await m.unmount();
  });

  it('tells the Pond a composed question was used', async () => {
    pond.listSuggestions.mockResolvedValue({ suggestions: [offered('a')], audience: 'personal' });
    const m = await mount();
    act(() => m.vm.actions.taken(m.vm.data.prompts[0]));
    expect(pond.takeSuggestion).toHaveBeenCalledWith('a');
    await m.unmount();
  });
});

describe('folding From your Pond', () => {
  // The suite's resetAllMocks empties the storage mock's own implementation, so this keeps its own.
  const kept = new Map<string, string>();
  beforeEach(() => {
    jest.mocked(AsyncStorage.getItem).mockImplementation(async (key: string) => kept.get(key) ?? null);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (key: string, value: string) => {
      kept.set(key, value);
    });
  });
  afterEach(() => kept.clear());

  it('opens unfolded, and keeps a fold for the next launch', async () => {
    const first = await mount();
    expect(first.vm.collapsed).toBe(false);
    await act(async () => first.vm.actions.toggleCollapsed());
    expect(first.vm.collapsed).toBe(true);
    await first.unmount();

    const next = await mount();
    expect(next.vm.collapsed).toBe(true);
    await act(async () => next.vm.actions.toggleCollapsed());
    expect(next.vm.collapsed).toBe(false);
    expect(await AsyncStorage.getItem('@goose/home-ideas-collapsed')).toBe('0');
    await next.unmount();
  });
});
