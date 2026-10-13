/**
 * The ride steps: a fare comes from where the phone is, nothing books before confirm, and every
 * failure becomes a reason the screen can say.
 */
import {
  cancel, confirm, decline, describeRideError, getFare, isFinished, refresh, viewOf,
  type RideApi,
} from '@/models/ride-flow';
import { ApiError } from '@/services/api-client';
import type { RideQuote } from '@/services/types';

const JKIA = { name: 'JKIA', latitude: -1.319167, longitude: 36.9275 };

function quote(state: RideQuote['state'] = { state: 'awaiting_confirmation' }): RideQuote {
  return {
    id: 'r-1',
    provider: 'uber',
    pickup: { name: 'Pickup', latitude: -1.2676, longitude: 36.8108 },
    dropoff: JKIA,
    fare: { display: 'KES 1,250', currency_code: 'KES', expires_at: '2026-10-07T08:02:00Z' },
    pickup_eta_mins: 4,
    state,
  };
}

const booked = quote({
  state: 'requested',
  ride: {
    request_id: 'u-1',
    status: 'accepted',
    driver: { name: 'Amina', phone_number: null, rating: 4.9 },
    vehicle: { make: 'Toyota', model: 'Axio', license_plate: 'KDA 123A' },
    pickup_eta_mins: 4,
  },
});

function api(overrides: Partial<RideApi> = {}): RideApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    quoteRide: async (pickup, dropoff) => { calls.push(`quote ${pickup.latitude} ${dropoff.name}`); return quote(); },
    getRide: async () => { calls.push('get'); return booked; },
    confirmRide: async () => { calls.push('confirm'); return booked; },
    declineRide: async () => { calls.push('decline'); },
    cancelRide: async () => { calls.push('cancel'); },
    ...overrides,
  };
}

const here = async () => ({ latitude: -1.2676, longitude: 36.8108 });

describe('getFare', () => {
  it('quotes from where the phone is and books nothing', async () => {
    const a = api();
    const view = await getFare(a, here, JKIA);
    expect(view).toEqual({ phase: 'quoted', quote: quote() });
    expect(a.calls).toEqual(['quote -1.2676 JKIA']);
  });

  it('asks the Pond nothing when location is refused', async () => {
    const a = api();
    expect(await getFare(a, async () => null, JKIA)).toEqual({ phase: 'problem', problem: 'locationDenied' });
    expect(a.calls).toEqual([]);
  });

  it('says booking is not set up when the Pond answers 503', async () => {
    const a = api({ quoteRide: async () => { throw new ApiError('x', 503, null); } });
    expect(await getFare(a, here, JKIA)).toEqual({ phase: 'problem', problem: 'notSetUp' });
  });
});

describe('confirm, decline, cancel', () => {
  it('confirm books it and shows the driver', async () => {
    const view = await confirm(api(), quote());
    expect(view.phase).toBe('booked');
  });

  it('an expired fare or a second confirm keeps the quote and says why', async () => {
    const expired = await confirm(api({ confirmRide: async () => { throw new ApiError('x', 410, null); } }), quote());
    expect(expired).toEqual({ phase: 'problem', problem: 'expired', quote: quote() });
    const twice = await confirm(api({ confirmRide: async () => { throw new ApiError('x', 409, null); } }), quote());
    expect(twice).toMatchObject({ problem: 'alreadyDecided' });
  });

  it('decline and cancel close the ride', async () => {
    expect(await decline(api(), quote())).toMatchObject({ phase: 'closed', outcome: 'declined' });
    expect(await cancel(api(), booked)).toMatchObject({ phase: 'closed', outcome: 'cancelled' });
  });
});

describe('following a ride', () => {
  it('refresh re-reads a booked ride and keeps the last view when a read fails', async () => {
    const view = viewOf(booked);
    expect(await refresh(api(), view)).toEqual(view);
    const failing = api({ getRide: async () => { throw new Error('offline'); } });
    expect(await refresh(failing, view)).toBe(view);
  });

  it('only finished rides stop being followed', () => {
    expect(isFinished('completed')).toBe(true);
    expect(isFinished('driver_canceled')).toBe(true);
    expect(isFinished('arriving')).toBe(false);
    expect(isFinished({ other: 'redispatched' })).toBe(false);
  });

  it('maps every error status to a reason', () => {
    expect(describeRideError(new ApiError('x', 403, null))).toBe('notLinked');
    expect(describeRideError(new ApiError('x', 404, null))).toBe('notFound');
    expect(describeRideError(new ApiError('x', 502, null))).toBe('refused');
    expect(describeRideError(new Error('network'))).toBe('failed');
  });
});
