/**
 * This phone's location for the Pond: never a prompt unasked, a name from the phone's geocoder,
 * and at most one unasked offer per run of the app.
 */

import { homeLocationIsPinned, offerHomeLocationOnce, placeName, readPhoneFix } from '@/services/home-location';

const mockLocation = {
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
};
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: () => mockLocation.getForegroundPermissionsAsync(),
  requestForegroundPermissionsAsync: () => mockLocation.requestForegroundPermissionsAsync(),
  getCurrentPositionAsync: (options: unknown) => mockLocation.getCurrentPositionAsync(options),
  reverseGeocodeAsync: (coords: unknown) => mockLocation.reverseGeocodeAsync(coords),
  Accuracy: { Balanced: 3 },
}));
const mockSet = jest.fn();
jest.mock('@/services/api-client', () => ({ api: { setLocationFromPhone: (fix: unknown) => mockSet(fix) } }));

const granted = { granted: true, canAskAgain: true };
const position = { coords: { latitude: -1.193421, longitude: 36.744088, accuracy: 14 } };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  mockLocation.getCurrentPositionAsync.mockResolvedValue(position);
  mockLocation.reverseGeocodeAsync.mockResolvedValue([{ city: 'Ndenderu', subregion: 'Kiambu', region: 'Kiambu County' }]);
});

it('names the place by its locality, then the wider area', () => {
  expect(placeName({ city: 'Ndenderu', district: null, subregion: 'Kiambu', region: 'Kiambu' } as never)).toBe('Ndenderu');
  expect(placeName({ city: null, district: null, subregion: 'Kiambu', region: 'Kiambu County' } as never)).toBe('Kiambu');
  expect(placeName(undefined)).toBeNull();
});

it('asks for permission only when told to', async () => {
  mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
  await expect(readPhoneFix(false)).resolves.toEqual({ kind: 'denied', canAskAgain: true });
  expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();

  mockLocation.requestForegroundPermissionsAsync.mockResolvedValue(granted);
  await expect(readPhoneFix(true)).resolves.toEqual({ kind: 'fix', latitude: -1.193421, longitude: 36.744088, accuracy_m: 14, name: 'Ndenderu' });
  expect(mockLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
});

it('keeps the fix when the phone cannot name the place', async () => {
  mockLocation.getForegroundPermissionsAsync.mockResolvedValue(granted);
  mockLocation.reverseGeocodeAsync.mockRejectedValue(new Error('no geocoder'));
  await expect(readPhoneFix(false)).resolves.toMatchObject({ kind: 'fix', name: null });
});

it('offers unasked once per run, with a grant already given, never replacing a set place', async () => {
  mockLocation.getForegroundPermissionsAsync.mockResolvedValue(granted);
  mockSet.mockResolvedValue({ applied: true, name: 'Ndenderu', latitude: -1.193, longitude: 36.744 });
  await expect(offerHomeLocationOnce()).resolves.toBe(true);
  expect(mockSet).toHaveBeenCalledWith({ latitude: -1.193421, longitude: 36.744088, accuracy_m: 14, name: 'Ndenderu', replace: false });
  await expect(offerHomeLocationOnce()).resolves.toBe(false);
  expect(mockSet).toHaveBeenCalledTimes(1);
  expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

describe('a pinned home', () => {
  it('is a phone\'s fix or coordinates someone entered, and nothing a lookup made', () => {
    expect(homeLocationIsPinned({ weather_location_source: 'device' })).toBe(true);
    expect(homeLocationIsPinned({ weather_location_source: 'manual' })).toBe(true);
    expect(homeLocationIsPinned({ weather_location_source: 'geocoded' })).toBe(false);
    // A Pond from before the field: its location is a guess.
    expect(homeLocationIsPinned({})).toBe(false);
  });
});
