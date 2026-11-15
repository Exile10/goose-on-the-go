// "Find my location": this phone's own fix at home, saved by the Pond; a guess away from home,
// with a word that home is where the phone can do better.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError } from '@/services/api-client';
import i18n from '@/services/i18n';
import { useFindLocation } from '@/view-models/use-settings-extras';

const mockServer = { connectionState: 'local', isScreenReal: () => true };
jest.mock('@/providers/server-provider', () => ({ useServer: () => mockServer }));
jest.mock('@/providers/theme-provider', () => ({ useTheme: () => ({ isDark: false }) }));
const mockFix = jest.fn();
const mockSend = jest.fn();
jest.mock('@/services/home-location', () => ({
  readPhoneFix: (ask: boolean) => mockFix(ask),
  sendHomeLocation: (fix: unknown, replace: boolean) => mockSend(fix, replace),
}));
const mockDetect = jest.fn();
jest.mock('@/services/api-client', () => ({
  ...jest.requireActual('@/services/api-client'),
  api: { detectLocation: (req: unknown) => mockDetect(req) },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fix = { kind: 'fix', latitude: -1.19, longitude: 36.74, accuracy_m: 14, name: 'Ndenderu' };
const trees: ReactTestRenderer[] = [];

async function mount() {
  let latest!: ReturnType<typeof useFindLocation>;
  const Probe = () => {
    latest = useFindLocation();
    return null;
  };
  await act(async () => {
    trees.push(create(<Probe />));
  });
  return { get vm() { return latest; } };
}

afterEach(() => {
  act(() => trees.splice(0).forEach((t) => t.unmount()));
  jest.clearAllMocks();
  mockServer.connectionState = 'local';
});

it('at home, asks for the phone location and the Pond saves it in place of anything', async () => {
  mockFix.mockResolvedValue(fix);
  mockSend.mockResolvedValue({ applied: true, name: 'Ndenderu', latitude: -1.19, longitude: 36.74 });
  const view = await mount();
  let found: unknown;
  await act(async () => { found = await view.vm.run(''); });
  expect(mockFix).toHaveBeenCalledWith(true);
  expect(mockSend).toHaveBeenCalledWith(fix, true);
  expect(found).toEqual({ kind: 'saved', name: 'Ndenderu' });
  expect(view.vm.message).toBe(i18n.t('settings.location.fromPhone', { name: 'Ndenderu' }));
  expect(mockDetect).not.toHaveBeenCalled();
});

it('says where to allow location when it is refused', async () => {
  mockFix.mockResolvedValue({ kind: 'denied', canAskAgain: false });
  const view = await mount();
  await act(async () => { await view.vm.run(''); });
  expect(view.vm.message).toBe(i18n.t('settings.location.allowInSettings'));
  expect(mockSend).not.toHaveBeenCalled();
});

it('reads a refusal from the Pond as not being at home', async () => {
  mockFix.mockResolvedValue(fix);
  mockSend.mockRejectedValue(new ApiError('PUT /api/v1/location/device → 403', 403, null, 'not_on_home_network', { error: 'not_on_home_network' }));
  const view = await mount();
  await act(async () => { await view.vm.run(''); });
  expect(view.vm.message).toBe(i18n.t('settings.location.atHome'));
});

it('away from home, never reads the phone location: the Pond guesses, and home is mentioned', async () => {
  mockServer.connectionState = 'remote';
  mockDetect.mockResolvedValue({ name: 'Nairobi', timezone: 'Africa/Nairobi', source: 'timezone' });
  const view = await mount();
  let found: unknown;
  await act(async () => { found = await view.vm.run(''); });
  expect(mockFix).not.toHaveBeenCalled();
  expect(found).toEqual({ kind: 'guess', name: 'Nairobi', timezone: 'Africa/Nairobi' });
  expect(view.vm.message).toContain(i18n.t('settings.location.atHome'));
});
