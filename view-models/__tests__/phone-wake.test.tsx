// The "Listen for Hey Goose" switch: it asks for the assistant role and the microphone before
// turning on, says which is missing, and explains a service that stopped on its own.

import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import i18n from '@/services/i18n';
import type { PhoneWakeState } from '@/services/phone-wake';
import { usePhoneWake, wakeProblem, type UsePhoneWake } from '@/view-models/use-phone-wake';

const mockWake = {
  supported: true,
  state: jest.fn<Promise<PhoneWakeState | null>, []>(),
  choose: jest.fn<Promise<boolean>, [boolean, Record<string, string>]>(),
};
const mockAssistant = jest.fn<Promise<boolean | null>, []>();
const mockMicrophone = jest.fn<Promise<{ granted: boolean; canAskAgain: boolean }>, []>();
jest.mock('@/services/phone-wake', () => ({
  phoneWakeSupported: () => mockWake.supported,
  phoneWakeState: () => mockWake.state(),
  choosePhoneWake: (on: boolean, words: Record<string, string>) => mockWake.choose(on, words),
}));
jest.mock('@/services/phone-assistant', () => ({ isPhoneAssistant: () => mockAssistant() }));
jest.mock('@/services/voice-io', () => ({ requestMicrophone: () => mockMicrophone() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let onAppState: ((state: AppStateStatus) => void) | null = null;
const trees: ReactTestRenderer[] = [];
const off: PhoneWakeState = { chosen: false, active: false, refusal: null };
const on: PhoneWakeState = { chosen: true, active: true, refusal: null };

beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    onAppState = listener as (state: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
  mockAssistant.mockResolvedValue(true);
  mockMicrophone.mockResolvedValue({ granted: true, canAskAgain: true });
});

afterEach(() => {
  act(() => trees.splice(0).forEach((t) => t.unmount()));
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockWake.supported = true;
  onAppState = null;
});

async function mount() {
  let latest!: UsePhoneWake;
  const Probe = () => {
    latest = usePhoneWake();
    return null;
  };
  await act(async () => {
    trees.push(create(<Probe />));
  });
  return { get vm() { return latest; } };
}

it('turns on with the notification in the app language, once the role and microphone are there', async () => {
  mockWake.state.mockResolvedValueOnce(off).mockResolvedValue(on);
  mockWake.choose.mockResolvedValue(true);
  const view = await mount();
  expect(view.vm.data).toEqual({ supported: true, on: false, busy: false, error: null });

  await act(async () => view.vm.actions.set(true));
  expect(mockWake.choose).toHaveBeenCalledWith(true, {
    title: i18n.t('settings.phoneWake.notification.title'),
    body: i18n.t('settings.phoneWake.notification.body'),
    stop: i18n.t('settings.phoneWake.notification.stop'),
    channel: i18n.t('settings.phoneWake.notification.channel'),
  });
  expect(view.vm.data).toEqual({ supported: true, on: true, busy: false, error: null });
});

it('asks for Goose to be the assistant first, and starts nothing', async () => {
  mockWake.state.mockResolvedValue(off);
  mockAssistant.mockResolvedValue(false);
  const view = await mount();
  await act(async () => view.vm.actions.set(true));
  expect(mockWake.choose).not.toHaveBeenCalled();
  expect(mockMicrophone).not.toHaveBeenCalled();
  expect(view.vm.data.error).toBe(i18n.t('settings.phoneWake.needsAssistant'));
});

it('says where to allow the microphone once the phone has stopped asking', async () => {
  mockWake.state.mockResolvedValue(off);
  mockMicrophone.mockResolvedValueOnce({ granted: false, canAskAgain: true }).mockResolvedValueOnce({ granted: false, canAskAgain: false });
  const view = await mount();
  await act(async () => view.vm.actions.set(true));
  expect(view.vm.data.error).toBe(i18n.t('settings.phoneWake.microphone'));
  await act(async () => view.vm.actions.set(true));
  expect(view.vm.data.error).toBe(i18n.t('settings.phoneWake.microphoneSettings'));
  expect(mockWake.choose).not.toHaveBeenCalled();
});

it('turns off without asking for anything', async () => {
  mockWake.state.mockResolvedValueOnce(on).mockResolvedValue(off);
  mockWake.choose.mockResolvedValue(true);
  const view = await mount();
  await act(async () => view.vm.actions.set(false));
  expect(mockAssistant).not.toHaveBeenCalled();
  expect(mockMicrophone).not.toHaveBeenCalled();
  expect(mockWake.choose).toHaveBeenCalledWith(false, expect.any(Object));
  expect(view.vm.data.on).toBe(false);
});

it('says so when Android refused the start', async () => {
  mockWake.state.mockResolvedValueOnce(off).mockResolvedValue({ chosen: true, active: false, refusal: 'start_refused' });
  mockWake.choose.mockResolvedValue(false);
  const view = await mount();
  await act(async () => view.vm.actions.set(true));
  expect(view.vm.data.error).toBe(i18n.t('settings.phoneWake.refused.start'));
});

it('explains a service that stopped while the app was away, on return', async () => {
  mockWake.state.mockResolvedValueOnce(on).mockResolvedValue({ chosen: false, active: false, refusal: 'not_assistant' });
  const view = await mount();
  expect(view.vm.data.error).toBeNull();
  await act(async () => onAppState?.('active'));
  expect(view.vm.data).toEqual({ supported: true, on: false, busy: false, error: i18n.t('settings.phoneWake.refused.notAssistant') });
});

it('has words for every refusal the service reports', () => {
  for (const refusal of ['start_refused', 'no_microphone', 'model_failed', 'not_assistant'] as const) {
    const key = wakeProblem({ chosen: true, active: false, refusal });
    expect(key && i18n.t(key)).toBeTruthy();
    expect(i18n.t(key!)).not.toBe(key);
  }
  expect(wakeProblem({ chosen: true, active: true, refusal: null })).toBeNull();
});
