// The setting row's view-model: it reads Android's answer on arrival and on each return to the
// app, and says when no settings screen could be opened.

import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import i18n from '@/services/i18n';
import { usePhoneAssistant, type UsePhoneAssistant } from '@/view-models/use-phone-assistant';

const mockAssistant = {
  supported: true,
  held: jest.fn<Promise<boolean | null>, []>(),
  choose: jest.fn<Promise<boolean>, []>(),
};
jest.mock('@/services/phone-assistant', () => ({
  assistantSupported: () => mockAssistant.supported,
  isPhoneAssistant: () => mockAssistant.held(),
  choosePhoneAssistant: () => mockAssistant.choose(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let onAppState: ((state: AppStateStatus) => void) | null = null;
const trees: ReactTestRenderer[] = [];

beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    onAppState = listener as (state: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
});

afterEach(() => {
  act(() => trees.splice(0).forEach((t) => t.unmount()));
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockAssistant.supported = true;
  onAppState = null;
});

async function mount() {
  let latest!: UsePhoneAssistant;
  const Probe = () => {
    latest = usePhoneAssistant();
    return null;
  };
  await act(async () => {
    trees.push(create(<Probe />));
  });
  return { get vm() { return latest; } };
}

it('reads the role on arrival and again when the app comes back from Settings', async () => {
  mockAssistant.held.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const view = await mount();
  expect(view.vm.data).toEqual({ supported: true, held: false, error: null });
  await act(async () => onAppState?.('active'));
  expect(view.vm.data.held).toBe(true);
});

it('says so when the phone opens no settings screen', async () => {
  mockAssistant.held.mockResolvedValue(false);
  mockAssistant.choose.mockResolvedValue(false);
  const view = await mount();
  await act(async () => view.vm.actions.choose());
  expect(view.vm.data.error).toBe(i18n.t('settings.phoneAssistant.openFailed'));
  expect(view.vm.data.error).toMatch(/Digital assistant app/);
});

it('asks nothing where the phone cannot have Goose as its assistant', async () => {
  mockAssistant.supported = false;
  const view = await mount();
  expect(view.vm.data).toEqual({ supported: false, held: null, error: null });
  expect(mockAssistant.held).not.toHaveBeenCalled();
});
