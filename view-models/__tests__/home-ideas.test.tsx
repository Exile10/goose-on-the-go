/**
 * Home's ideas: what it takes from the Pond's three idea sources, and the one rule that is not
 * about layout.
 *
 * That rule is the session label. `GET /suggestions` keys off a session id to decide whose data
 * it may read, and Home has no conversation open. Borrowing one from the recent list would make
 * the Pond bind that session to this device's member, quietly claiming somebody else's
 * conversation -- so Home must mint a label that names no session, and must not reuse a real one.
 * The test for it looks at what the api was actually called with.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { api } from '@/services/api-client';
import { HOME_PROMPT_LIMIT, HOME_PROPOSAL_LIMIT, useHomeIdeas, type UseHomeIdeas } from '@/view-models/use-home-ideas';

jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      listProposals: jest.fn(),
      decideProposal: jest.fn(),
      listSuggestions: jest.fn(),
      takeSuggestion: jest.fn(),
      listReminders: jest.fn(),
    },
  };
});

jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true }) }));

jest.mock('../use-live', () => ({
  useLive: (read: () => Promise<unknown>, _delay: unknown, enabled = true) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => {
      if (enabled) void read();
    }, [enabled, read]);
  },
}));

const pond = jest.mocked(api);

function proposal(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    summary: 'Turn the heater off at nine',
    rationale: 'it ran six nights and the house was empty',
    confidence: 0.8,
    profile_id: null,
    created_at: '2026-10-30T20:00:00Z',
    expires_at: '2026-11-02T20:00:00Z',
    proposed_action: { type: 'note' },
    trigger: { kind: 'pattern', source_id: null },
    ...over,
  };
}

async function mount() {
  let vm!: UseHomeIdeas;
  function Probe() {
    vm = useHomeIdeas();
    return null;
  }
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  await act(async () => {});
  return {
    get vm() {
      return vm;
    },
    unmount: () => act(async () => tree.unmount()),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  pond.listProposals.mockResolvedValue([] as never);
  pond.listSuggestions.mockResolvedValue({ suggestions: [] } as never);
  pond.listReminders.mockResolvedValue([] as never);
});

it('asks for prompts under a label that names no session', async () => {
  const m = await mount();
  expect(pond.listSuggestions).toHaveBeenCalled();
  const [label] = pond.listSuggestions.mock.calls[0] as [string];
  expect(label).toMatch(/^gotg-home-[0-9a-f]{32}$/);
  await m.unmount();
});

it('mints a different label each visit, so one is never a session anyone else holds', async () => {
  const first = await mount();
  await first.unmount();
  const a = pond.listSuggestions.mock.calls[0]?.[0];
  pond.listSuggestions.mockClear();
  const second = await mount();
  await second.unmount();
  const b = pond.listSuggestions.mock.calls[0]?.[0];
  expect(a).not.toBe(b);
});

it('shows only as many proposals as Home has room for, and says how many are left', async () => {
  pond.listProposals.mockResolvedValue([
    proposal(),
    proposal({ id: 'p2' }),
    proposal({ id: 'p3' }),
    proposal({ id: 'p4' }),
  ] as never);
  const m = await mount();
  expect(m.vm.data.proposals).toHaveLength(HOME_PROPOSAL_LIMIT);
  expect(m.vm.data.proposalCount).toBe(4);
  await m.unmount();
});

it('keeps a prompt row short enough to stay a row', async () => {
  pond.listSuggestions.mockResolvedValue({
    suggestions: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, prompt: `Ask ${i}`, composed: true })),
  } as never);
  const m = await mount();
  expect(m.vm.data.prompts).toHaveLength(HOME_PROMPT_LIMIT);
  await m.unmount();
});

// The fixed starters are the conversation's way to begin. Under "Ideas from your Pond" they would
// be the same three chips every day, and would stop the section ever being absent.
it('offers nothing of its own when the Pond composed nothing', async () => {
  const m = await mount();
  expect(m.vm.data.prompts).toEqual([]);
  expect(m.vm.empty).toBe(true);
  await m.unmount();
});

// Home draws nothing at all when the Pond has offered nothing, which is the rest of Home's rule.
it('is empty only when all three sources are', async () => {
  const quiet = await mount();
  expect(quiet.vm.empty).toBe(true);
  await quiet.unmount();

  pond.listReminders.mockResolvedValue([
    { id: 'r1', about: 'call the vet', when_said: 'tomorrow', said_at: '2026-10-30T20:00:00Z' },
  ] as never);
  const withOne = await mount();
  expect(withOne.vm.empty).toBe(false);
  expect(withOne.vm.data.reminderCount).toBe(1);
  await withOne.unmount();
});

it('decides a proposal as the Suggestions screen does', async () => {
  pond.listProposals.mockResolvedValue([proposal()] as never);
  pond.decideProposal.mockResolvedValue({ id: 'p1', status: 'approved', executed: false } as never);
  const m = await mount();
  await act(async () => m.vm.actions.approve('p1'));
  // `useProposals` mints its own label for the same reason; either way it names no session.
  expect(pond.decideProposal).toHaveBeenCalledWith('p1', expect.stringMatching(/^gotg-[a-z]+-[0-9a-f]{32}$/), 'approve');
  await m.unmount();
});
