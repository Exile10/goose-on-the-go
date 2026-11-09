/**
 * The phone's half of a to-do that waits on a place: it watches the member's saved places with the
 * OS's own geofencing and tells the Pond `arrive` or `leave` (`POST /me/places/{id}/event`). The
 * location itself never leaves the phone; only which place and which way.
 *
 * The task is defined while the bundle loads (imported from `index.ts`), because the OS starts the
 * app headless to run it, with no screen mounted. Both native modules are loaded lazily: a dev
 * client built before background location was enabled has an older native side, and a geofence
 * that cannot run must cost the place hooks, never the launch.
 */

import { Platform } from 'react-native';

import type { Place } from '@/models/todos';

import { api } from './api-client';
import { ensurePondSession } from './pond-session';

export const PLACE_TASK = 'goose-place-geofence';

type LocationModule = typeof import('expo-location');
type TaskManagerModule = typeof import('expo-task-manager');

function load<T>(name: 'expo-location' | 'expo-task-manager'): T | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return name === 'expo-location' ? (require('expo-location') as T) : (require('expo-task-manager') as T);
  } catch {
    return null;
  }
}

const Location = load<LocationModule>('expo-location');
const Tasks = load<TaskManagerModule>('expo-task-manager');

/**
 * Where the phone stands on telling the Pond about places:
 * - `granted`: watching (or ready to), with the always-on permission.
 * - `needs_permission`: not asked yet, or only allowed while the app is open; the app can ask.
 * - `denied`: refused; only the phone's settings can change it now.
 * - `unavailable`: this build or this platform cannot geofence.
 */
export type LocationAccess = 'granted' | 'needs_permission' | 'denied' | 'unavailable';

function supported(): boolean {
  return !!Location && !!Tasks && (Platform.OS === 'ios' || Platform.OS === 'android') && typeof Location.startGeofencingAsync === 'function';
}

export async function locationAccess(): Promise<LocationAccess> {
  if (!supported() || !Location) return 'unavailable';
  try {
    const background = await Location.getBackgroundPermissionsAsync();
    if (background.granted) return 'granted';
    return background.canAskAgain ? 'needs_permission' : 'denied';
  } catch (e) {
    // An older native side without background location answers with an error, not a refusal.
    console.warn('[geofence] could not read the permission', e instanceof Error ? e.message : e);
    return 'unavailable';
  }
}

/**
 * Ask for the location permission the places need: while in use first (the OS will not offer
 * "always" before it), then always. Called only from the member's own tap, after the app has said
 * why.
 */
export async function askForLocation(): Promise<LocationAccess> {
  if (!supported() || !Location) return 'unavailable';
  try {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (!foreground.granted) return foreground.canAskAgain ? 'needs_permission' : 'denied';
    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.granted) return 'granted';
    return background.canAskAgain ? 'needs_permission' : 'denied';
  } catch (e) {
    console.warn('[geofence] could not ask for the permission', e instanceof Error ? e.message : e);
    return 'unavailable';
  }
}

/** Where the phone is now, to save as a place. Asks for while-in-use location only. */
export async function currentPosition(): Promise<{ lat: number; lng: number } | 'denied' | 'unavailable'> {
  if (!Location) return 'unavailable';
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return 'denied';
    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: fix.coords.latitude, lng: fix.coords.longitude };
  } catch (e) {
    console.warn('[geofence] could not read the position', e instanceof Error ? e.message : e);
    return 'unavailable';
  }
}

/** iOS watches at most twenty regions per app. */
export const MAX_REGIONS = 20;

/**
 * Watch exactly these places, or stop watching when there are none. Never asks for a permission:
 * without one it reports what is missing, and the place hooks say so.
 */
export async function watchPlaces(places: readonly Place[]): Promise<LocationAccess> {
  if (!supported() || !Location) return 'unavailable';
  try {
    const started = await Location.hasStartedGeofencingAsync(PLACE_TASK).catch(() => false);
    if (places.length === 0) {
      if (started) await Location.stopGeofencingAsync(PLACE_TASK);
      return locationAccess();
    }
    const access = await locationAccess();
    if (access !== 'granted') {
      if (started) await Location.stopGeofencingAsync(PLACE_TASK);
      return access;
    }
    await Location.startGeofencingAsync(
      PLACE_TASK,
      places.slice(0, MAX_REGIONS).map((p) => ({
        identifier: p.id,
        latitude: p.lat,
        longitude: p.lng,
        radius: p.radiusM,
        notifyOnEnter: true,
        notifyOnExit: true,
      })),
    );
    return 'granted';
  } catch (e) {
    console.warn('[geofence] could not start watching places', e instanceof Error ? e.message : e);
    return 'unavailable';
  }
}

/** What the task is handed, read without trusting its shape. */
export function placeEventFrom(data: unknown, enter: number, exit: number): { placeId: string; transition: 'arrive' | 'leave' } | null {
  const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  const region = d?.region && typeof d.region === 'object' ? (d.region as Record<string, unknown>) : null;
  const placeId = typeof region?.identifier === 'string' ? region.identifier : '';
  if (!placeId) return null;
  if (d?.eventType === enter) return { placeId, transition: 'arrive' };
  if (d?.eventType === exit) return { placeId, transition: 'leave' };
  return null;
}

export function defineGeofenceTask(): void {
  if (!supported() || !Location || !Tasks) return;
  const { Enter, Exit } = Location.GeofencingEventType;
  Tasks.defineTask(PLACE_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[geofence] task error', { kind: 'geofence', error: error.message });
      return;
    }
    const event = placeEventFrom(data, Enter, Exit);
    if (!event) return;
    try {
      if (!(await ensurePondSession())) {
        console.warn('[geofence] no Pond session; the place event is lost', { kind: 'geofence' });
        return;
      }
      await api.placeEvent(event.placeId, event.transition);
      console.info('[geofence] told the Pond', { kind: 'geofence', transition: event.transition });
    } catch (e) {
      console.warn('[geofence] could not tell the Pond', { kind: 'geofence', error: String(e) });
    }
  });
}

defineGeofenceTask();
