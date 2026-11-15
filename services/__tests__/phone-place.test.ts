/**
 * "Tell Goose where this phone is": nothing while off, a place name (never coordinates) while on,
 * found again at most every five minutes, and a refused permission leaves it off.
 */

import { phonePlaceForTurn, phonePlaceEnabled, savePhonePlacePreference, wider } from '@/services/phone-place';

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
jest.mock('@/services/storage', () => ({ Storage: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('@/services/api-client', () => ({ api: { setTurnPlace: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  mockLocation.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: -1.26, longitude: 36.8, accuracy: 30 } });
  mockLocation.reverseGeocodeAsync.mockResolvedValue([{ district: 'Westlands', subregion: 'Nairobi' }]);
});

it('names the place by locality and town, or the one there is', () => {
  expect(wider({ city: 'Westlands', subregion: 'Nairobi' } as never)).toBe('Westlands, Nairobi');
  expect(wider({ city: 'Nairobi', subregion: 'Nairobi' } as never)).toBe('Nairobi');
  expect(wider({ region: 'Kiambu' } as never)).toBe('Kiambu');
  expect(wider(undefined)).toBeNull();
});

it('sends nothing while off', async () => {
  await savePhonePlacePreference(false);
  await expect(phonePlaceForTurn()).resolves.toBeUndefined();
  expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
});

it('sends the place name while on, and finds it again only after five minutes', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  await expect(savePhonePlacePreference(true)).resolves.toBe(true);
  await expect(phonePlaceForTurn()).resolves.toBe('Westlands, Nairobi');
  await phonePlaceForTurn();
  expect(mockLocation.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
  now.mockReturnValue(1_000_000 + 5 * 60_000 + 1);
  await phonePlaceForTurn();
  expect(mockLocation.getCurrentPositionAsync).toHaveBeenCalledTimes(2);
});

it('stays off when location is refused', async () => {
  await savePhonePlacePreference(false);
  mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
  mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
  await expect(savePhonePlacePreference(true)).resolves.toBe(false);
  expect(phonePlaceEnabled()).toBe(false);
});
