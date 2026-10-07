/**
 * Booking a ride the Pond offered: get a fare from where the phone is, then confirm or decline
 * it, follow it, cancel it. Pure steps with their dependencies passed in, so they are testable
 * without a phone; `view-models/use-ride.ts` holds the state.
 *
 * Nothing is booked until `confirm`. The Pond knows whose ride it is from this phone's pairing.
 */

import { ApiError } from '@/services/api-client';
import type { BookedRide, RidePoint, RideQuote, RideStatus } from '@/services/types';

export interface RideApi {
  quoteRide(pickup: { latitude: number; longitude: number }, dropoff: RidePoint): Promise<RideQuote>;
  getRide(id: string): Promise<RideQuote>;
  confirmRide(id: string): Promise<RideQuote>;
  declineRide(id: string): Promise<void>;
  cancelRide(id: string): Promise<void>;
}

/** Where the phone is, or null when the person said no to sharing it. */
export type Locate = () => Promise<{ latitude: number; longitude: number } | null>;

/** Why a step failed, as a key the screen turns into words. */
export type RideProblem =
  | 'locationDenied'
  | 'notLinked'
  | 'notSetUp'
  | 'expired'
  | 'alreadyDecided'
  | 'notFound'
  | 'refused'
  | 'failed';

export type RideView =
  | { phase: 'offer' }
  | { phase: 'quoted'; quote: RideQuote }
  | { phase: 'booked'; quote: RideQuote; ride: BookedRide }
  | { phase: 'closed'; quote: RideQuote; outcome: 'declined' | 'cancelled' | 'failed' }
  | { phase: 'problem'; problem: RideProblem; quote?: RideQuote };

export function describeRideError(cause: unknown): RideProblem {
  if (!(cause instanceof ApiError)) return 'failed';
  switch (cause.status) {
    case 403: return 'notLinked';
    case 404: return 'notFound';
    case 409: return 'alreadyDecided';
    case 410: return 'expired';
    case 502: return 'refused';
    case 503: return 'notSetUp';
    default: return 'failed';
  }
}

/** The screen for a quote as the Pond holds it. */
export function viewOf(quote: RideQuote): RideView {
  switch (quote.state.state) {
    case 'awaiting_confirmation': return { phase: 'quoted', quote };
    case 'requesting': return { phase: 'quoted', quote };
    case 'requested': return { phase: 'booked', quote, ride: quote.state.ride };
    case 'declined': return { phase: 'closed', quote, outcome: 'declined' };
    case 'failed': return { phase: 'closed', quote, outcome: 'failed' };
  }
}

export async function getFare(api: RideApi, locate: Locate, dropoff: RidePoint): Promise<RideView> {
  const here = await locate();
  if (!here) return { phase: 'problem', problem: 'locationDenied' };
  try {
    return viewOf(await api.quoteRide(here, dropoff));
  } catch (e) {
    return { phase: 'problem', problem: describeRideError(e) };
  }
}

export async function confirm(api: RideApi, quote: RideQuote): Promise<RideView> {
  try {
    return viewOf(await api.confirmRide(quote.id));
  } catch (e) {
    return { phase: 'problem', problem: describeRideError(e), quote };
  }
}

export async function decline(api: RideApi, quote: RideQuote): Promise<RideView> {
  try {
    await api.declineRide(quote.id);
    return { phase: 'closed', quote, outcome: 'declined' };
  } catch (e) {
    return { phase: 'problem', problem: describeRideError(e), quote };
  }
}

export async function cancel(api: RideApi, quote: RideQuote): Promise<RideView> {
  try {
    await api.cancelRide(quote.id);
    return { phase: 'closed', quote, outcome: 'cancelled' };
  } catch (e) {
    return { phase: 'problem', problem: describeRideError(e), quote };
  }
}

/** Re-read a booked ride. A failed read keeps what was last known; the next one may work. */
export async function refresh(api: RideApi, view: RideView): Promise<RideView> {
  if (view.phase !== 'booked') return view;
  try {
    return viewOf(await api.getRide(view.quote.id));
  } catch {
    return view;
  }
}

/** The ride will not change again, so following it can stop. */
export function isFinished(status: RideStatus): boolean {
  return (
    status === 'completed' ||
    status === 'rider_canceled' ||
    status === 'driver_canceled' ||
    status === 'no_drivers_available'
  );
}
