// The lock's ways in: a kept key leads with the phone's biometrics and keeps the card a tap away,
// the card's form offers to keep a key only where one can be kept, and a Pond with no card still
// opens to a key.

import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { AdminLockView } from '@/components/pond/admin-lock';
import { ThemeProvider } from '@/providers/theme-provider';
import { api } from '@/services/api-client';
import { canKeepAdminKey, isAdminKeyKeptFor, readKeptAdminKey } from '@/services/kept-admin-key';
import type { AdminStatus } from '@/services/types';
import { resetAdminGates, useAdminGate } from '@/view-models/use-admin-gate';

// lucide ships ESM that this Jest does not transform; the glyphs are not what is under test.
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/haptics', () => ({
  confirm: jest.fn().mockResolvedValue(undefined),
  reject: jest.fn().mockResolvedValue(undefined),
  tap: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect: run } = jest.requireActual('react');
    run(effect, [effect]);
  },
}));
const server = { hydrated: true, online: true, real: true, pairedPin: 'sha256/pond', isScreenReal: () => true };
jest.mock('@/providers/server-provider', () => ({ useServer: () => server }));
jest.mock('@/services/kept-admin-key', () => ({
  ...jest.requireActual('@/services/kept-admin-key'),
  canKeepAdminKey: jest.fn(),
  isAdminKeyKeptFor: jest.fn(),
  keepAdminKey: jest.fn(),
  readKeptAdminKey: jest.fn(),
  forgetKeptAdminKey: jest.fn(),
}));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { adminStatus: jest.fn(), adminUnlockWithKey: jest.fn() } };
});

const pond = jest.mocked(api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LOCKED: AdminStatus = { card: 'present', unlocked: false, expires_at: null, idle_minutes: 15, retry_after: null, key: true };

/** The view with the gate's status read once, as My Pond reads it on arrival. */
function Screen() {
  const { readStatus } = useAdminGate();
  React.useEffect(() => {
    void readStatus();
  }, [readStatus]);
  return <AdminLockView onRetry={() => undefined} />;
}

async function draw() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ThemeProvider>
        <Screen />
      </ThemeProvider>,
    );
  });
  await act(async () => undefined);
  return tree;
}

function words(tree: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: ReactTestInstance | string) => {
    if (typeof n === 'string') out.push(n);
    else n.children.forEach(walk);
  };
  walk(tree.root);
  return out.join(' ');
}

function press(tree: ReactTestRenderer, label: string) {
  const target = tree.root.find((n) => typeof n.props.onPress === 'function' && words({ root: n } as unknown as ReactTestRenderer).includes(label));
  return act(async () => target.props.onPress());
}

beforeEach(() => {
  jest.clearAllMocks();
  resetAdminGates();
  jest.mocked(canKeepAdminKey).mockReturnValue(true);
  jest.mocked(isAdminKeyKeptFor).mockResolvedValue(false);
  // The person dismisses the prompt that arriving asks by itself.
  jest.mocked(readKeptAdminKey).mockRejectedValue(new Error('User canceled the operation.'));
  pond.adminStatus.mockResolvedValue(LOCKED);
});

it('leads with the phone’s biometrics when a key is kept, and opens the card form on request', async () => {
  jest.mocked(isAdminKeyKeptFor).mockResolvedValue(true);
  const tree = await draw();
  expect(readKeptAdminKey).toHaveBeenCalledTimes(1);
  let text = words(tree);
  expect(text).toContain("Open My Pond with this phone's security");
  expect(text).toContain('Unlock with Face ID or fingerprint');
  expect(text).toContain('Use the admin card instead');
  expect(text).not.toContain('Admin card password');

  await press(tree, 'Use the admin card instead');
  text = words(tree);
  expect(text).toContain('Unlock with the admin card');
  expect(text).toContain('Open My Pond with Face ID or fingerprint next time');
  // Choosing the card is not a reason to ask for biometrics again.
  expect(readKeptAdminKey).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount());
});

it('offers to keep a key on the card form only where one can be kept', async () => {
  const tree = await draw();
  expect(words(tree)).toContain('Open My Pond with Face ID or fingerprint next time');
  await act(async () => tree.unmount());

  resetAdminGates();
  jest.mocked(canKeepAdminKey).mockReturnValue(false);
  const without = await draw();
  expect(words(without)).toContain('Unlock with the admin card');
  expect(words(without)).not.toContain('next time');
  await act(async () => without.unmount());
});

it('opens a Pond with no card by its key, with no card to fall back on', async () => {
  jest.mocked(isAdminKeyKeptFor).mockResolvedValue(true);
  pond.adminStatus.mockResolvedValue({ ...LOCKED, card: 'missing' });
  const tree = await draw();
  const text = words(tree);
  expect(text).toContain('Unlock with Face ID or fingerprint');
  expect(text).not.toContain('Use the admin card instead');
  expect(text).not.toContain('This Pond has no administrator card yet.');
  await act(async () => tree.unmount());
});

it('says how to make a card on a Pond with neither a card nor a key', async () => {
  pond.adminStatus.mockResolvedValue({ ...LOCKED, card: 'missing', key: false });
  const tree = await draw();
  expect(words(tree)).toContain('This Pond has no administrator card yet.');
  expect(words(tree)).not.toContain('Face ID');
  await act(async () => tree.unmount());
});
