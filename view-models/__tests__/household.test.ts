/**
 * The profile header's numbers and name, derived from what the Pond actually answered.
 *
 * Every figure on that header used to be typed into the source: 6 devices, 3 rooms, 4 routines,
 * 2 users, and a real person's name and email. The rules here are the ones that would otherwise
 * go wrong quietly, because a wrong count still looks like a count.
 */
import { ApiError } from '@/services/api-client';
import type { Device } from '@/services/types';
import { countRooms, initialOf, isSelfUnsupported, memberOf, mergeHousehold, readHousehold, settledCount } from '../use-household';

const device = (id: string, room?: string): Device => ({ id, name: id, is_online: true, room });

const read = <T,>(value: T): PromiseSettledResult<T> => ({ status: 'fulfilled', value });
const refused = (status: number): PromiseSettledResult<never> => ({ status: 'rejected', reason: new ApiError('GET', status, null) });

describe('countRooms', () => {
  it('counts the rooms the Pond keeps, empty ones too', () => {
    expect(countRooms(read([{}, {}]), read([]))).toBe(2);
  });

  // The Devices tab's own rule: a device with no room is Unassigned, which "is a fallback, not a
  // room anyone named". A household with no rooms has zero, whatever its devices.
  it('counts no rooms when the Pond has none', () => {
    expect(countRooms(read([]), read([device('a'), device('b')]))).toBe(0);
  });

  /** A Pond from before `/rooms` names rooms on its devices: each name once, Unassigned never. */
  it('counts an older Pond’s rooms from the names its devices carry', () => {
    const devices = [device('a', 'Kitchen'), device('b', 'Kitchen'), device('c', 'Home'), device('d'), device('e', '  ')];
    expect(countRooms(refused(404), read(devices))).toBe(2);
  });

  it('is unknown when neither read can say', () => {
    expect(countRooms(refused(500), read([device('a', 'Kitchen')]))).toBeNull();
    expect(countRooms(refused(404), refused(500))).toBeNull();
  });
});

describe('settledCount', () => {
  // The rule the whole header rests on. A zero is a claim about the household -- "you have no
  // routines" -- and a read that failed has made no claim at all.
  it('reports a failed read as unknown, never as zero', () => {
    expect(settledCount({ status: 'rejected', reason: new Error('offline') })).toBeNull();
  });

  it('reports a real empty answer as zero', () => {
    expect(settledCount({ status: 'fulfilled', value: [] })).toBe(0);
  });

  it('counts what the Pond returned', () => {
    expect(settledCount({ status: 'fulfilled', value: [1, 2, 3] })).toBe(3);
  });
});

describe('memberOf', () => {
  it('names the member the Pond attributes this device to', () => {
    expect(memberOf({ device_id: 'd', profile: { id: 'p1', display_name: 'Liz' } })).toEqual({ id: 'p1', displayName: 'Liz' });
  });

  it('names nobody when nobody has claimed this device', () => {
    expect(memberOf({ device_id: 'd', profile: null })).toBeNull();
  });
});

describe('isSelfUnsupported', () => {
  // An older Pond has no `/devices/self`. The GET falls through to `/devices/{id}`, which answers
  // only DELETE and PUT, so the answer is a 405 rather than a 404.
  it('reads a 405 and a 404 as a Pond that cannot say, not as a failure', () => {
    expect(isSelfUnsupported(new ApiError('method not allowed', 405, null))).toBe(true);
    expect(isSelfUnsupported(new ApiError('not found', 404, null))).toBe(true);
  });

  it('does not excuse a Pond that tried and failed', () => {
    expect(isSelfUnsupported(new ApiError('unavailable', 503, null))).toBe(false);
    expect(isSelfUnsupported(new Error('network'))).toBe(false);
  });
});

describe('initialOf', () => {
  it('takes the first letter of the name, capitalised', () => {
    expect(initialOf('liz')).toBe('L');
    expect(initialOf('  Jerry')).toBe('J');
  });

  it('takes a whole code point, not half of one', () => {
    // U+1D49C MATHEMATICAL SCRIPT CAPITAL A, outside the BMP: `charAt(0)` would return a lone
    // surrogate and draw a replacement box.
    expect(initialOf('\u{1D49C}lex')).toBe('\u{1D49C}');
  });

  it('gives nothing for a blank name, so the avatar can fall back', () => {
    expect(initialOf('   ')).toBeNull();
  });
});

describe('readHousehold', () => {
  /** A Pond that answers everything, with the given reads swapped out. */
  function pond(overrides: Partial<Parameters<typeof readHousehold>[0]> = {}) {
    return {
      deviceSelf: async () => ({ device_id: 'phone', profile: { id: 'p1', display_name: 'Liz' } }),
      systemInfo: async () => ({ hostname: 'giap-mac' }),
      listDevices: async () => [device('lamp'), device('phone')],
      listRooms: async () => [{ id: 'kitchen', name: 'Kitchen' }],
      listSchedules: async () => [{} as never, {} as never],
      listProfiles: async () => [{} as never, {} as never, {} as never],
      ...overrides,
    };
  }

  let warn: jest.SpyInstance;
  beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => warn.mockRestore());

  it('reads the whole household from what the Pond answered', async () => {
    await expect(readHousehold(pond())).resolves.toEqual({
      member: { id: 'p1', displayName: 'Liz' },
      pondName: 'giap-mac',
      counts: { devices: 2, rooms: 1, routines: 2, users: 3 },
    });
  });

  // One read failing costs its own figure and nothing else. Were this `Promise.all`, a Pond that
  // could not list schedules would blank every number on the header.
  it('loses only the figure whose read failed', async () => {
    const h = await readHousehold(pond({ listSchedules: async () => { throw new ApiError('boom', 500, null); } }));
    expect(h.counts).toEqual({ devices: 2, rooms: 1, routines: null, users: 3 });
    expect(h.member).toEqual({ id: 'p1', displayName: 'Liz' });
  });

  it('shows no name from an older Pond, and does not call that a failure', async () => {
    const h = await readHousehold(pond({ deviceSelf: async () => { throw new ApiError('method not allowed', 405, null); } }));
    expect(h.member).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  // Unknown, not nobody. Merged into a live screen, a failed read keeps the last name it had
  // rather than wiping it until the next poll.
  it('reports a Pond that tried and failed as unknown, and says so', async () => {
    const h = await readHousehold(pond({ deviceSelf: async () => { throw new ApiError('unavailable', 503, null); } }));
    expect(h.member).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[household] could not read which member this device belongs to', 503);
  });
});

/**
 * A live screen polls, and a poll can fail. What it knew a minute ago was true a minute ago; a
 * failed read has said nothing, so it must not replace a count with a dash or a name with none.
 */
describe('mergeHousehold', () => {
  const known = {
    member: { id: 'p1', displayName: 'Liz' },
    pondName: 'pond',
    counts: { devices: 2, rooms: 1, routines: 3, users: 2 },
  };
  const failed = { member: undefined, pondName: null, counts: { devices: null, rooms: null, routines: null, users: null } };

  it('keeps what it knew through a read that failed', () => {
    expect(mergeHousehold(known, failed)).toEqual(known);
  });

  it('takes every figure a read did return', () => {
    const fresh = { member: null, pondName: 'pond', counts: { devices: 3, rooms: 1, routines: 0, users: 2 } };
    // A real null member is an answer -- nobody claims this device now -- and a real zero is a count.
    expect(mergeHousehold(known, fresh)).toEqual(fresh);
  });

  it('keeps only the figures that failed, and updates the rest', () => {
    const partial = { ...failed, counts: { ...failed.counts, devices: 5 } };
    expect(mergeHousehold(known, partial).counts).toEqual({ devices: 5, rooms: 1, routines: 3, users: 2 });
  });
});
