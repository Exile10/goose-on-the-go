/**
 * The pure parts of the list view-models.
 *
 * These are the decisions a reader sees first — what is at the top of a grid,
 * which bubbles join into a run, what is dropped from a transcript — and all of
 * them are functions with no network in them, so they are worth pinning.
 */

import { byReachability, groupByRoom, UNASSIGNED_ROOM } from '@/view-models/use-devices';
import { groupByCategory } from '@/view-models/use-models';
import { positionsFor, toMessage } from '@/view-models/use-chat';
import type { Device, ModelEntry, SessionMessage } from '@/services/types';

function device(name: string, online: boolean, roomId?: string): Device {
  return { id: name, name, is_online: online, room_id: roomId, capabilities: [] } as Device;
}

const ROOMS = [
  { id: 'kitchen', name: 'Kitchen' },
  { id: 'study', name: 'Study' },
];

function model(category: ModelEntry['category'], name: string): ModelEntry {
  return { id: `${category}:${name}`, category, name, active: false };
}

describe('byReachability', () => {
  it('puts what the Pond can reach above what it cannot', () => {
    const sorted = [device('b', false), device('a', true)].sort(byReachability);
    expect(sorted.map((d) => d.name)).toEqual(['a', 'b']);
  });

  it('falls back to the name, so the order does not shuffle between loads', () => {
    const sorted = [device('c', true), device('a', true), device('b', true)].sort(byReachability);
    expect(sorted.map((d) => d.name)).toEqual(['a', 'b', 'c']);
  });
});

describe('groupByRoom', () => {
  it('sorts inside each room as well as between them', () => {
    const rooms = groupByRoom(
      [device('lamp', false, 'kitchen'), device('kettle', true, 'kitchen')],
      ROOMS,
    );
    expect(rooms[0].devices.map((d) => d.name)).toEqual(['kettle', 'lamp']);
  });

  /** Unassigned is a fallback, not a room anyone named, so it sits last. */
  it('keeps the unassigned bucket at the end', () => {
    const rooms = groupByRoom([device('x', true), device('y', true, 'study')], ROOMS);
    expect(rooms.map((r) => r.id)).toEqual(['kitchen', 'study', UNASSIGNED_ROOM]);
  });
});

describe('groupByCategory', () => {
  it('drops categories the Pond has nothing in', () => {
    const groups = groupByCategory([model('gguf', 'a'), model('whisper', 'b')]);
    expect(groups.map((g) => g.category)).toEqual(['gguf', 'whisper']);
  });

  it('holds the declared category order rather than the order rows arrived in', () => {
    const groups = groupByCategory([model('embedding', 'e'), model('gguf', 'g')]);
    expect(groups.map((g) => g.category)).toEqual(['gguf', 'embedding']);
  });
});

describe('toMessage', () => {
  function stored(role: SessionMessage['role'], content: string): SessionMessage {
    return { id: '1', session_id: 's', role, content, created_at: '2026-01-01T00:00:00Z' };
  }

  /**
   * A tool row is Goose talking to itself. Rendering it turns a conversation
   * into a log, which is a different screen.
   */
  it('drops tool rows', () => {
    expect(toMessage(stored('tool', 'get_device_state'))).toBeNull();
  });

  it('keeps what a person actually said, and when', () => {
    const m = toMessage(stored('user', 'hello'));
    expect(m).toMatchObject({ role: 'user', content: 'hello' });
    expect(m?.timestamp).toBe(Date.parse('2026-01-01T00:00:00Z'));
  });
});

describe('positionsFor', () => {
  const say = (role: 'user' | 'assistant') => ({ id: role, role, content: '', timestamp: 0 });

  it('marks a lone turn as its own run', () => {
    expect(positionsFor([say('user')])).toEqual(['only']);
  });

  /** The tail belongs to the run, which is what stops four bubbles in a row. */
  it('opens, continues and closes a run of one speaker', () => {
    const run = [say('assistant'), say('assistant'), say('assistant'), say('user')];
    expect(positionsFor(run)).toEqual(['first', 'middle', 'last', 'only']);
  });
});
