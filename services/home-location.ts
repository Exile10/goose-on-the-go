/**
 * Telling the Pond where home is, from this phone, at home.
 *
 * A Pond has no GPS: without a typed place it takes its time zone's city, and a typed place is
 * that town's centre, so a household in Ndenderu got Nairobi's weather. This phone has a real fix.
 * It sends one (`PUT /location/device`) only while it reaches the Pond on the household network:
 * the caller checks the connection is `local`, and the Pond refuses a fix from anywhere else
 * (`not_on_home_network`), so a phone away from home never moves the household.
 *
 * The place's name comes from the phone's own geocoder (Google's on Android, Apple's on iOS), the
 * same provider that already serves the phone its location; the Pond can only look names up.
 */

import * as Location from 'expo-location';

import { api } from '@/services/api-client';
import type { HomeLocationResult } from '@/services/types';

/** What reading the phone's location came to. */
export type PhoneFix =
  | { kind: 'fix'; latitude: number; longitude: number; accuracy_m: number; name: string | null }
  | { kind: 'denied'; canAskAgain: boolean }
  | { kind: 'unavailable' };

/** The place's name as a household says it: the locality first, then the wider area. */
export function placeName(address: Location.LocationGeocodedAddress | undefined): string | null {
  if (!address) return null;
  const name = address.city || address.district || address.subregion || address.region;
  return name?.trim() || null;
}

/**
 * The phone's position now. With `ask`, the person is asked for location permission if they have
 * not answered; without it, only an existing grant is used, so nothing prompts unasked.
 */
export async function readPhoneFix(ask: boolean): Promise<PhoneFix> {
  try {
    const held = await Location.getForegroundPermissionsAsync();
    const permission = held.granted || !ask ? held : await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return { kind: 'denied', canAskAgain: permission.canAskAgain };
    // Balanced: a street's accuracy is all the Pond keeps (it rounds to about 110 m).
    const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    let name: string | null = null;
    try {
      name = placeName((await Location.reverseGeocodeAsync(coords))[0]);
    } catch (e) {
      // The Pond keeps the name it had; the coordinates are what the weather needs.
      console.warn('[home-location] the phone could not name the place', { kind: 'home_location', error: String(e) });
    }
    return { kind: 'fix', latitude: coords.latitude, longitude: coords.longitude, accuracy_m: coords.accuracy ?? 0, name };
  } catch (e) {
    console.warn('[home-location] the phone could not read its location', { kind: 'home_location', error: String(e) });
    return { kind: 'unavailable' };
  }
}

/** Send a fix to the Pond; `replace` when the person asked for this phone's location. */
export async function sendHomeLocation(fix: Extract<PhoneFix, { kind: 'fix' }>, replace: boolean): Promise<HomeLocationResult> {
  const result = await api.setLocationFromPhone({
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracy_m: fix.accuracy_m,
    name: fix.name ?? undefined,
    replace,
  });
  console.info('[home-location] sent the phone location', { kind: 'home_location', applied: result.applied, reason: result.reason ?? null, replace });
  return result;
}

/**
 * Whether the Pond's home location is a place someone pinned: a household phone's fix
 * ('device') or coordinates entered as such ('manual'). A guess from away never replaces it,
 * not even by renaming it: the Pond looks a new name up again and would move home to the
 * town's centre. A Pond that predates the field reports nothing, which counts as a guess.
 */
export function homeLocationIsPinned(settings: { weather_location_source?: string }): boolean {
  return settings.weather_location_source === 'device' || settings.weather_location_source === 'manual';
}

/** Whether this run of the app has already offered its fix unasked. */
let offered = false;

/**
 * Unasked, once per run of the app: send this phone's fix when the caller has found it at home and
 * the Pond's location still a guess. Uses a location grant the person already gave and never asks
 * for one; the Pond keeps a place someone set. Resolves whether the Pond took the fix.
 */
export async function offerHomeLocationOnce(): Promise<boolean> {
  if (offered) return false;
  offered = true;
  const fix = await readPhoneFix(false);
  if (fix.kind !== 'fix') return false;
  try {
    return (await sendHomeLocation(fix, false)).applied;
  } catch (e) {
    console.warn('[home-location] the Pond did not take the phone location', { kind: 'home_location', error: String(e) });
    return false;
  }
}
