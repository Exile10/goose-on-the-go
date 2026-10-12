/**
 * The Memories screen's reading of the Pond's fields: which segments the chips
 * offer, what "Kept" means, and how a consolidation run's frames become
 * progress.
 */

import { isKept, segmentsIn } from '@/models/memory';
import type { MemoryFragment } from '@/services/types';
import { describeMemoryError } from '@/view-models/use-memories';
import { describeApiError } from '@/view-models/describe-error';
import { ApiError } from '@/services/api-client';

function memory(overrides: Partial<MemoryFragment>): MemoryFragment {
  return {
    id: 'id',
    profile_id: null,
    session_id: null,
    content: 'Likes tea',
    source: 'chat',
    tags: [],
    created_at: '2026-10-01T00:00:00Z',
    access_count: 0,
    ...overrides,
  };
}

describe('isKept', () => {
  it('is the permanent tier and nothing else', () => {
    expect(isKept(memory({ tier: 'permanent' }))).toBe(true);
    expect(isKept(memory({ tier: 'long', importance: 1 }))).toBe(false);
    expect(isKept(memory({ tags: ['pinned'] }))).toBe(false);
  });
});

describe('segmentsIn', () => {
  it('offers only the segments present, in chip order, skipping unsegmented memories', () => {
    const list = [
      memory({ segment: 'context' }),
      memory({ segment: 'preference' }),
      memory({}),
      memory({ segment: 'context' }),
    ];
    expect(segmentsIn(list)).toEqual(['preference', 'context']);
  });
});

describe('errors', () => {
  it('shows the sentence a 400 came with, else the shared reading', () => {
    const blank = new ApiError('x', 400, null, 'a memory cannot be blank -- delete it instead');
    expect(describeMemoryError(blank)).toBe('a memory cannot be blank -- delete it instead');
    const bare = new ApiError('x', 500, null);
    expect(describeMemoryError(bare)).toBe(describeApiError(bare));
  });
});
