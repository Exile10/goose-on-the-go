/**
 * The Suggestions view-model: what a proposal becomes on screen, what an empty or refused
 * read leaves, and what Accept and Decline call, re-read and report.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import { currentSnackbar, resetSnackbar } from '@/services/snackbar';
import type { Proposal } from '@/services/types';
import { describeProposalError, toProposalRow, useProposals, type UseProposals } from '@/view-models/use-proposals';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/secure-random', () => ({ randomBytes: (n: number) => new Uint8Array(n).fill(7) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { listProposals: jest.fn(), decideProposal: jest.fn() } };
});
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true }) }));

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

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: 'p1',
    summary: 'Close the garage door',
    rationale: 'It has been open for an hour and nobody is home.',
    confidence: 0.8,
    profile_id: 'm1',
    created_at: '2026-10-19T09:00:00+00:00',
    expires_at: '2026-10-19T13:00:00+00:00',
    proposed_action: { type: 'agent_prompt', prompt: 'Close the garage door' },
    trigger: { kind: 'sensor', source_id: 'garage', signal: 'open', observed_at: '2026-10-19T08:00:00+00:00' },
    ...over,
  };
}

interface Mounted {
  readonly vm: UseProposals;
  unmount: () => Promise<void>;
}

async function mount(): Promise<Mounted> {
  let latest!: UseProposals;
  const Probe = () => {
    latest = useProposals();
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
  jest.spyOn(console, 'info').mockImplementation(() => {});
  pond.listProposals.mockResolvedValue([]);
  pond.decideProposal.mockResolvedValue({ id: 'p1', status: 'approved', executed: false });
});

afterEach(() => jest.restoreAllMocks());

describe('toProposalRow', () => {
  it('keeps the rationale beside the summary, never instead of it', () => {
    const row = toProposalRow(proposal({ summary: ' Close it ', rationale: ' Open an hour ' }));

    expect(row).toEqual({ id: 'p1', summary: 'Close it', rationale: 'Open an hour', expires: expect.any(String) });
    expect(row.expires).not.toBe('');
  });

  it('leaves the expiry blank rather than printing an unreadable date', () => {
    expect(toProposalRow(proposal({ expires_at: 'not a date' })).expires).toBe('');
  });
});

describe('describeProposalError', () => {
  it('explains a 403 as an unaddressed caller, which the shared reading would hide', () => {
    expect(describeProposalError(new ApiError('GET → 403', 403, null, 'nobody said who is asking'))).toMatch(
      /cannot tell which household member/,
    );
  });

  it('leaves the onboarding refusal to the onboarding gate', () => {
    expect(describeProposalError(new ApiError('GET → 403', 403, null, 'onboarding_required'))).toBeNull();
  });
});

describe('the list', () => {
  it('reads with a session label that is never blank and stays the same across calls', async () => {
    pond.listProposals.mockResolvedValue([proposal(), proposal({ id: 'p2', summary: 'Turn the heating down' })]);
    const m = await mount();

    expect(m.vm.data.rows.map((r) => [r.id, r.summary])).toEqual([
      ['p1', 'Close the garage door'],
      ['p2', 'Turn the heating down'],
    ]);
    const label = pond.listProposals.mock.calls[0][0];
    expect(label).toMatch(/^gotg-suggestions-[0-9a-f]{32}$/);

    await act(async () => m.vm.actions.refresh());
    expect(pond.listProposals.mock.calls[1][0]).toBe(label);
    await m.unmount();
  });

  it('is empty, not failed, when nothing is waiting', async () => {
    const m = await mount();

    expect(m.vm.data.rows).toEqual([]);
    expect(m.vm.failed).toBe(false);
    expect(m.vm.error).toBeNull();
    await m.unmount();
  });

  it('shows why when the Pond cannot address this phone', async () => {
    pond.listProposals.mockRejectedValue(new ApiError('GET → 403', 403, null, 'nobody said who is asking'));
    const m = await mount();

    expect(m.vm.failed).toBe(true);
    expect(m.vm.error).toMatch(/cannot tell which household member/);
    await m.unmount();
  });
});

describe('deciding', () => {
  it('accepts with approve and the same session, says nothing ran, and re-reads', async () => {
    pond.listProposals.mockResolvedValueOnce([proposal()]).mockResolvedValueOnce([]);
    const m = await mount();
    const label = pond.listProposals.mock.calls[0][0];

    await act(async () => m.vm.actions.decide('p1', 'approve'));

    expect(pond.decideProposal).toHaveBeenCalledWith('p1', label, 'approve');
    expect(currentSnackbar()).toMatchObject({ tone: 'success', message: 'Accepted. The Pond has noted it; nothing was run.' });
    expect(pond.listProposals).toHaveBeenCalledTimes(2);
    expect(m.vm.data.rows).toEqual([]);
    expect(m.vm.deciding).toBeNull();
    await m.unmount();
  });

  it('declines with reject', async () => {
    pond.listProposals.mockResolvedValue([proposal()]);
    const m = await mount();

    await act(async () => m.vm.actions.decide('p1', 'reject'));

    expect(pond.decideProposal).toHaveBeenCalledWith('p1', expect.any(String), 'reject');
    expect(currentSnackbar()?.tone).toBe('success');
    await m.unmount();
  });

  it.each<[number, RegExp, boolean]>([
    [404, /expired or was already decided/, false],
    [409, /would not record that decision/, false],
    [403, /cannot tell which household member/, true],
  ])('reports a %i visibly and still refreshes', async (status, sentence, retriable) => {
    pond.listProposals.mockResolvedValue([proposal()]);
    pond.decideProposal.mockRejectedValue(new ApiError(`POST → ${status}`, status, null));
    const m = await mount();

    await act(async () => m.vm.actions.decide('p1', 'approve'));

    expect(currentSnackbar()?.tone).toBe('danger');
    expect(currentSnackbar()?.message).toMatch(sentence);
    expect(currentSnackbar()?.action !== undefined).toBe(retriable);
    expect(pond.listProposals).toHaveBeenCalledTimes(2);
    await m.unmount();
  });

  it('shows a failure even when the shared reading has nothing to add', async () => {
    pond.listProposals.mockResolvedValue([proposal()]);
    pond.decideProposal.mockRejectedValue(new TypeError('Network request failed'));
    const m = await mount();

    await act(async () => m.vm.actions.decide('p1', 'reject'));

    expect(currentSnackbar()).toMatchObject({ tone: 'danger', message: 'Could not save that decision.' });
    await act(async () => currentSnackbar()?.action?.onPress());
    expect(pond.decideProposal).toHaveBeenCalledTimes(2);
    await m.unmount();
  });
});
