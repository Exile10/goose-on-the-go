/**
 * The pairing lock's page: what any member reads, what only the main member is asked for, and
 * that each change is one request followed by a fresh read.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { readPairingLock, type PairingLock, type PairingRequest } from '@/models/pairing-lock';
import { ApiError, api } from '@/services/api-client';
import { currentSnackbar, resetSnackbar } from '@/services/snackbar';
import { lockSummaryWords, usePairingLock, type UsePairingLock } from '@/view-models/use-pairing-lock';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      pairingLock: jest.fn(),
      pairingRequests: jest.fn(),
      listProfiles: jest.fn(),
      setPairingLock: jest.fn(),
      setRecoveryPin: jest.fn(),
      clearRecoveryPin: jest.fn(),
      approvePairingRequest: jest.fn(),
      declinePairingRequest: jest.fn(),
    },
  };
});
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true }) }));

// The poll is `use-live.test.ts`'s business; here it is one read on mount.
jest.mock('../use-live', () => ({
  useLive: (read: () => Promise<unknown>, _delay: unknown, enabled = true) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => {
      if (enabled) void read();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);
  },
}));

const pond = jest.mocked(api);

const lockOf = (overrides: Record<string, unknown> = {}): PairingLock =>
  readPairingLock({
    locked: true,
    enforced: true,
    owner_profile_id: 'p1',
    has_recovery_pin: false,
    owner_has_a_phone: true,
    min_pin_digits: 6,
    can_change: true,
    ...overrides,
  })!;

const waitingPhone: PairingRequest = { id: 'r1', deviceName: 'Wanjiru’s phone', clientType: 'gotg', profileId: null, createdAt: null, expiresAt: null };

async function mount(): Promise<{ readonly vm: UsePairingLock; unmount: () => Promise<void> }> {
  let latest!: UsePairingLock;
  const Probe = () => {
    latest = usePairingLock();
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  return {
    get vm() {
      return latest;
    },
    unmount: async () => {
      await act(async () => tree.unmount());
    },
  };
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.clearAllMocks();
  resetSnackbar();
  pond.pairingLock.mockResolvedValue(lockOf());
  pond.pairingRequests.mockResolvedValue([waitingPhone]);
  pond.listProfiles.mockResolvedValue([{ id: 'p1', display_name: 'Akinyi', avatar_emoji: '' }]);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('reading the lock', () => {
  it('shows the main member the lock, their name, and the phones waiting', async () => {
    const page = await mount();
    expect(page.vm.data.lock).toMatchObject({ locked: true, canChange: true });
    expect(page.vm.data.ownerName).toBe('Akinyi');
    expect(page.vm.data.requests).toEqual([waitingPhone]);
    expect(page.vm.data.gap).toBeNull();
    await page.unmount();
  });

  it('asks for no waiting phones on behalf of anyone else', async () => {
    pond.pairingLock.mockResolvedValue(lockOf({ can_change: false }));
    const page = await mount();
    expect(page.vm.data.lock?.canChange).toBe(false);
    expect(pond.pairingRequests).not.toHaveBeenCalled();
    expect(page.vm.data.requests).toEqual([]);
    await page.unmount();
  });

  it('says why a lock that is on is not holding', async () => {
    pond.pairingLock.mockResolvedValue(lockOf({ enforced: false, owner_has_a_phone: false }));
    const page = await mount();
    expect(page.vm.data.gap).toBe('no_phone_or_pin');
    await page.unmount();
  });

  it('reads a Pond with no pairing lock as unsupported, not as broken', async () => {
    pond.pairingLock.mockRejectedValue(new ApiError('GET /api/v1/pairing/lock → 404', 404, null));
    const page = await mount();
    expect(page.vm.unsupported).toBe(true);
    expect(page.vm.failed).toBe(false);
    await page.unmount();
  });
});

describe('changing the lock', () => {
  it('sends the switch once and reads the lock again', async () => {
    const page = await mount();
    pond.setPairingLock.mockResolvedValue(undefined);
    await act(async () => page.vm.actions.setLocked(false));
    expect(pond.setPairingLock.mock.calls).toEqual([[false]]);
    expect(pond.pairingLock).toHaveBeenCalledTimes(2);
    await page.unmount();
  });

  it('says so when the Pond will not take the change from this phone', async () => {
    const page = await mount();
    pond.setPairingLock.mockRejectedValue(new ApiError('PUT lock → 403', 403, null, 'pairing_main_member_only'));
    await act(async () => page.vm.actions.setLocked(false));
    expect(currentSnackbar()?.message).toBe('Only the main member can change this.');
    // The read that follows puts the switch back where the Pond has it.
    expect(page.vm.data.lock?.locked).toBe(true);
    await page.unmount();
  });
});

describe('the recovery PIN', () => {
  it('sends nothing for a PIN that is not six to twelve digits', async () => {
    const page = await mount();
    let saved = true;
    await act(async () => { saved = await page.vm.actions.savePin('12345'); });
    expect(saved).toBe(false);
    expect(pond.setRecoveryPin).not.toHaveBeenCalled();
    expect(page.vm.pinError).toBe('A PIN is 6 to 12 digits.');
    await page.unmount();
  });

  it('saves a PIN, and says so', async () => {
    const page = await mount();
    pond.setRecoveryPin.mockResolvedValue(undefined);
    let saved = false;
    await act(async () => { saved = await page.vm.actions.savePin('246810'); });
    expect(saved).toBe(true);
    expect(pond.setRecoveryPin.mock.calls).toEqual([['246810']]);
    expect(currentSnackbar()?.message).toBe('The recovery PIN is set.');
    await page.unmount();
  });

  it('reads the Pond\'s own refusal of a PIN', async () => {
    const page = await mount();
    pond.setRecoveryPin.mockRejectedValue(new ApiError('PUT pin → 400', 400, null, 'pin_not_six_to_twelve_digits'));
    await act(async () => { await page.vm.actions.savePin('246810'); });
    expect(page.vm.pinError).toBe('A PIN is 6 to 12 digits.');
    await page.unmount();
  });

  it('removes the PIN', async () => {
    const page = await mount();
    pond.clearRecoveryPin.mockResolvedValue(undefined);
    await act(async () => page.vm.actions.removePin());
    expect(pond.clearRecoveryPin).toHaveBeenCalledTimes(1);
    await page.unmount();
  });
});

describe('answering a waiting phone', () => {
  it('accepts or declines once, then reads the list again', async () => {
    const page = await mount();
    pond.approvePairingRequest.mockResolvedValue(undefined);
    pond.declinePairingRequest.mockResolvedValue(undefined);
    pond.pairingRequests.mockResolvedValue([]);

    await act(async () => page.vm.actions.accept('r1'));
    expect(pond.approvePairingRequest.mock.calls).toEqual([['r1']]);
    expect(page.vm.data.requests).toEqual([]);
    expect(currentSnackbar()?.message).toBe('The phone was let in.');

    await act(async () => page.vm.actions.decline('r2'));
    expect(pond.declinePairingRequest.mock.calls).toEqual([['r2']]);
    expect(pond.pairingRequests).toHaveBeenCalledTimes(3);
    await page.unmount();
  });
});

describe('lockSummaryWords', () => {
  it('leads with phones that are waiting, then says how the lock stands', () => {
    expect(lockSummaryWords({ locked: true, enforced: true, waiting: 2 })).toBe('2 phones are asking to pair');
    expect(lockSummaryWords({ locked: true, enforced: true, waiting: 0 })).toBe('New phones ask first');
    expect(lockSummaryWords({ locked: true, enforced: false, waiting: 0 })).toBe('On, but not holding');
    expect(lockSummaryWords({ locked: false, enforced: false, waiting: 0 })).toBe('Any phone with a code can pair');
  });
});
