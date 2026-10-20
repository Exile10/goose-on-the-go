/**
 * The Memories screen's two view-models against a stubbed Pond client: what the
 * list shows (the Pond's memories, or none, never the samples), that each
 * change reaches the Pond and the list is read back after it, and that a
 * tidy-up can start, report its stages, stop, and say why it could not.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { SAMPLE_MEMORIES } from '@/models/memory';
import { ApiError, CONSOLIDATION_NOT_BUILT, ONBOARDING_REQUIRED, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { ConsolidationEvent, MemoryFragment } from '@/services/types';
import { describeConsolidationError, useConsolidation, type UseConsolidation } from '@/view-models/use-consolidation';
import { describeMemoryError, useMemories, type UseMemories } from '@/view-models/use-memories';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      listMemories: jest.fn(),
      saveMemory: jest.fn(),
      updateMemory: jest.fn(),
      deleteMemory: jest.fn(),
      streamConsolidation: jest.fn(),
      stopConsolidation: jest.fn(),
    },
  };
});

const server = { hydrated: true, real: true };
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: server.hydrated, isScreenReal: () => server.real }),
}));

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
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A fragment as the Pond serialises it: optional fields present only when set. */
function fragment(id: string, patch: Partial<MemoryFragment> = {}): MemoryFragment {
  return {
    id,
    profile_id: null,
    session_id: 'session-1',
    content: `memory ${id}`,
    source: 'extraction',
    tags: [],
    created_at: '2026-10-01T09:00:00Z',
    segment: 'preference',
    importance: 0.7,
    tier: 'long',
    decay_rate: 0.01,
    access_count: 2,
    lifecycle: 'active',
    ...patch,
  };
}

const flush = () => act(async () => {});

async function mount<T>(hook: () => T) {
  let latest!: T;
  const Probe = () => {
    latest = hook();
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
    unmount: () => act(async () => tree.unmount()),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  server.hydrated = true;
  server.real = true;
  pond.listMemories.mockResolvedValue([]);
  pond.updateMemory.mockResolvedValue(undefined);
  pond.deleteMemory.mockResolvedValue(undefined);
  pond.stopConsolidation.mockResolvedValue(undefined);
});

describe('useMemories, on the real Pond', () => {
  it('shows what the Pond holds, and none of the samples', async () => {
    const held = [fragment('a', { tier: 'permanent' }), fragment('b', { segment: 'routine' })];
    pond.listMemories.mockResolvedValue(held);
    const m = await mount<UseMemories>(useMemories);
    expect(m.vm.data.memories).toEqual(held);
    expect(m.vm.data.memories.some((x) => SAMPLE_MEMORIES.some((s) => s.id === x.id))).toBe(false);
    expect(m.vm.loading).toBe(false);
    expect(m.vm.failed).toBe(false);
  });

  it('is empty, not sampled, when the Pond holds no memories', async () => {
    const m = await mount<UseMemories>(useMemories);
    expect(pond.listMemories).toHaveBeenCalledTimes(1);
    expect(m.vm.data.memories).toEqual([]);
    expect(m.vm.error).toBeNull();
    expect(m.vm.failed).toBe(false);
  });

  it('holds nothing before the first read lands, rather than the samples', async () => {
    server.hydrated = false;
    const m = await mount<UseMemories>(useMemories);
    expect(pond.listMemories).not.toHaveBeenCalled();
    expect(m.vm.data.memories).toEqual([]);
  });

  it('adds through the Pond with the segment and keep chosen, then reads the list back', async () => {
    const saved = fragment('new', { content: 'Likes tea', segment: 'routine', tier: 'permanent' });
    pond.saveMemory.mockResolvedValue(saved);
    const m = await mount<UseMemories>(useMemories);
    pond.listMemories.mockResolvedValue([saved]);

    let refused: string | null = 'unset';
    await act(async () => {
      refused = await m.vm.actions.save({ content: 'Likes tea', segment: 'routine', tier: 'permanent' });
    });
    expect(refused).toBeNull();
    expect(pond.saveMemory).toHaveBeenCalledWith({ content: 'Likes tea', segment: 'routine', tier: 'permanent' });
    expect(pond.listMemories).toHaveBeenCalledTimes(2);
    expect(m.vm.data.memories).toEqual([saved]);
  });

  it('rewords in place by id, then reads the list back', async () => {
    const before = fragment('a');
    pond.listMemories.mockResolvedValue([before]);
    const m = await mount<UseMemories>(useMemories);
    pond.listMemories.mockResolvedValue([{ ...before, content: 'new words' }]);

    await act(async () => {
      await m.vm.actions.reword(before, 'new words');
    });
    expect(pond.updateMemory).toHaveBeenCalledWith('a', { content: 'new words' });
    expect(pond.listMemories).toHaveBeenCalledTimes(2);
    expect(m.vm.data.memories[0].content).toBe('new words');
  });

  it('keeps by sending the permanent tier alone, and unkeeps to the segment default', async () => {
    const memory = fragment('a', { segment: 'context', tier: 'permanent' });
    pond.listMemories.mockResolvedValue([memory]);
    const m = await mount<UseMemories>(useMemories);

    await act(async () => {
      await m.vm.actions.setKept(memory, false);
    });
    expect(pond.updateMemory).toHaveBeenLastCalledWith('a', { tier: 'short' });
    await act(async () => {
      await m.vm.actions.setKept(fragment('a', { tier: 'long' }), true);
    });
    expect(pond.updateMemory).toHaveBeenLastCalledWith('a', { tier: 'permanent' });
  });

  it('forgets through the Pond, then reads the list back', async () => {
    const memory = fragment('a');
    pond.listMemories.mockResolvedValue([memory, fragment('b')]);
    const m = await mount<UseMemories>(useMemories);
    pond.listMemories.mockResolvedValue([fragment('b')]);

    await act(async () => {
      await m.vm.actions.remove(memory);
    });
    expect(pond.deleteMemory).toHaveBeenCalledWith('a');
    expect(pond.listMemories).toHaveBeenCalledTimes(2);
    expect(m.vm.data.memories.map((x) => x.id)).toEqual(['b']);
  });

  it('puts a memory back, and says so, when the Pond refuses to forget it', async () => {
    const memory = fragment('a');
    pond.listMemories.mockResolvedValue([memory]);
    pond.deleteMemory.mockRejectedValue(new ApiError('DELETE → 404', 404, null));
    const m = await mount<UseMemories>(useMemories);

    await act(async () => {
      await m.vm.actions.remove(memory);
    });
    expect(m.vm.data.memories).toEqual([memory]);
    expect(m.vm.error).toBe(i18n.t('errors.generic'));
  });

  it('says plainly when the Pond refuses this phone the memory routes', async () => {
    pond.listMemories.mockRejectedValue(new ApiError('GET → 403', 403, null, 'forbidden'));
    const m = await mount<UseMemories>(useMemories);
    expect(m.vm.failed).toBe(true);
    expect(m.vm.error).toBe(i18n.t('memories.errors.forbidden'));
  });
});

describe('describeMemoryError', () => {
  it('leaves the onboarding guard to the screen that handles it', () => {
    expect(describeMemoryError(new ApiError('x', 403, null, ONBOARDING_REQUIRED))).toBeNull();
  });

  it("passes on the Pond's reason for a 400", () => {
    expect(describeMemoryError(new ApiError('x', 400, null, 'a memory cannot be blank'))).toBe('a memory cannot be blank');
  });
});

describe('useMemories, on mock', () => {
  it('shows the samples and never asks the Pond', async () => {
    server.real = false;
    const m = await mount<UseMemories>(useMemories);
    expect(m.vm.data.memories).toEqual(SAMPLE_MEMORIES);
    await act(async () => {
      await m.vm.actions.remove(SAMPLE_MEMORIES[0]);
    });
    expect(pond.listMemories).not.toHaveBeenCalled();
    expect(pond.deleteMemory).not.toHaveBeenCalled();
  });
});

describe('useConsolidation', () => {
  it('is available against the real Pond and not on mock', async () => {
    const real = await mount<UseConsolidation>(() => useConsolidation(() => {}));
    expect(real.vm.available).toBe(true);
    await real.unmount();
    server.real = false;
    const mock = await mount<UseConsolidation>(() => useConsolidation(() => {}));
    expect(mock.vm.available).toBe(false);
  });

  it('reports each stage, then the tally, then reloads the list', async () => {
    let emit!: (event: ConsolidationEvent) => void;
    let end!: () => void;
    pond.streamConsolidation.mockImplementation((onEvent) => {
      emit = onEvent;
      return new Promise<void>((resolve) => {
        end = resolve;
      });
    });
    const onFinished = jest.fn();
    const m = await mount<UseConsolidation>(() => useConsolidation(onFinished));

    await act(async () => m.vm.actions.start());
    expect(m.vm.progress).toMatchObject({ status: 'running', stage: 'proposing' });
    await act(async () => emit({ type: 'started', memory_count: 12 }));
    expect(m.vm.progress).toMatchObject({ status: 'running', memoryCount: 12 });
    await act(async () => emit({ type: 'proposer_done', proposals: [{}, {}] }));
    expect(m.vm.progress).toMatchObject({ stage: 'challenging', proposals: 2 });
    await act(async () => emit({ type: 'completed', result: { accepted_count: 1, rejected_count: 1, duration_ms: 9 } }));
    await act(async () => end());
    expect(m.vm.progress).toEqual({ status: 'done', accepted: 1, rejected: 1 });
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('shows why a run could not start', async () => {
    pond.streamConsolidation.mockRejectedValue(new ApiError('POST → 501', 501, null, 'Memory consolidation is not enabled'));
    const m = await mount<UseConsolidation>(() => useConsolidation(() => {}));
    await act(async () => m.vm.actions.start());
    await flush();
    expect(m.vm.progress).toEqual({ status: 'failed', message: i18n.t('memories.consolidate.notEnabled') });
  });

  it('tells a build without consolidation apart from the setting being off', () => {
    expect(describeConsolidationError(new ApiError('x', 501, null, CONSOLIDATION_NOT_BUILT))).toBe(
      i18n.t('memories.consolidate.notBuilt'),
    );
    expect(describeConsolidationError(new ApiError('x', 403, null, 'forbidden'))).toBe(i18n.t('memories.errors.forbidden'));
  });

  it('asks the Pond to stop, and says so when that does not reach it', async () => {
    pond.streamConsolidation.mockReturnValue(new Promise<void>(() => {}));
    const m = await mount<UseConsolidation>(() => useConsolidation(() => {}));
    await act(async () => m.vm.actions.start());

    await act(async () => m.vm.actions.stop());
    expect(pond.stopConsolidation).toHaveBeenCalledTimes(1);
    expect(m.vm.stopError).toBeNull();

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    pond.stopConsolidation.mockRejectedValue(new TypeError('Network request failed'));
    await act(async () => m.vm.actions.stop());
    await flush();
    expect(m.vm.stopError).toBe(i18n.t('memories.consolidate.stopFailed'));
    warn.mockRestore();
    await m.unmount();
  });
});
