// My Pond with this phone's own key: kept after the card opens it, read behind the phone's biometrics,
// forgotten when it no longer opens or the member asks, and never asked for in a loop.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { MOCK_ADMIN_PASSWORD } from '@/models/pond-admin-mock';
import { ApiError, api } from '@/services/api-client';
import {
  canKeepAdminKey,
  forgetKeptAdminKey,
  isAdminKeyKeptFor,
  keepAdminKey,
  KeptAdminKeyLost,
  readKeptAdminKey,
} from '@/services/kept-admin-key';
import type { AdminStatus } from '@/services/types';
import { MOCK_POND_PIN, resetMockPondAdmin } from '@/view-models/pond-admin-source';
import { resetAdminGates, useAdminUnlock } from '@/view-models/use-admin-gate';
import { ADMIN_STATUS_MS, useMyPond } from '@/view-models/use-my-pond';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
// The real hook also re-runs, cleanup first, when the navigation object changes, as a header change does.
const mockNavigation = { generation: 0 };
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect: run } = jest.requireActual('react');
    run(effect, [effect, mockNavigation.generation]);
  },
}));
const PIN = `sha256/${'P'.repeat(43)}=`;
const server = { hydrated: true, online: true, real: true, pairedPin: PIN as string | null, isScreenReal: () => server.real };
jest.mock('@/providers/server-provider', () => ({ useServer: () => server }));
const mockAsk = jest.fn<Promise<boolean>, [{ title: string; message: string; confirmLabel: string; cancelLabel?: string; destructive?: boolean }]>();
jest.mock('@/providers/confirm-provider', () => ({ useConfirm: () => mockAsk }));
// The phone's keychain, as the marker and the key it guards: one Pond's key at a time.
const mockKeychain = { pin: null as string | null, key: null as string | null };
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
  return {
    ...actual,
    api: {
      adminStatus: jest.fn(),
      adminUnlock: jest.fn(),
      adminUnlockWithKey: jest.fn(),
      adminEnroll: jest.fn(),
      adminForgetKey: jest.fn(),
      adminLock: jest.fn(),
      adminOverview: jest.fn(),
      adminHealth: jest.fn(),
    },
  };
});

const pond = jest.mocked(api);
const keychain = {
  canKeep: jest.mocked(canKeepAdminKey),
  isKept: jest.mocked(isAdminKeyKeptFor),
  keep: jest.mocked(keepAdminKey),
  read: jest.mocked(readKeptAdminKey),
  forget: jest.mocked(forgetKeptAdminKey),
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPENED = { unlocked: true as const, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() };
// What the real Pond would say, so a status read after an unlock does not contradict it.
const live = { unlocked: false, key: null as string | null, card: 'present' as AdminStatus['card'], retry: null as number | null };
const statusNow = (): AdminStatus => ({
  card: live.card,
  unlocked: live.unlocked,
  expires_at: live.unlocked ? OPENED.expires_at : null,
  idle_minutes: 15,
  retry_after: live.retry,
  key: live.key !== null,
});

function refused(status: number, error: string, extra: Record<string, unknown> = {}, retryAfter: number | null = null) {
  return new ApiError(`admin → ${status}`, status, retryAfter, error, { error, ...extra });
}

const flush = () => act(async () => jest.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(async () => jest.advanceTimersByTimeAsync(ms));

async function mount<T>(hook: () => T) {
  let latest!: T;
  const Probe = () => {
    latest = hook();
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  await flush();
  return {
    get vm() {
      return latest;
    },
    unmount: () => act(() => tree.unmount()),
  };
}

const both = () => ({ tab: useMyPond(), form: useAdminUnlock() });

/** A key this phone kept earlier, which the Pond still holds unless told otherwise. */
function keepKey(key = 'key-1', pin = PIN) {
  mockKeychain.pin = pin;
  mockKeychain.key = key;
  live.key = key;
}

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  // A reset, not a clear: an implementation one test sets must not answer in the next.
  for (const fn of [...Object.values(pond), ...Object.values(keychain), mockAsk]) (fn as jest.Mock).mockReset();
  resetAdminGates();
  resetMockPondAdmin();
  server.real = true;
  server.pairedPin = PIN;
  Object.assign(live, { unlocked: false, key: null, card: 'present', retry: null });
  mockKeychain.pin = null;
  mockKeychain.key = null;

  keychain.canKeep.mockReturnValue(true);
  keychain.isKept.mockImplementation(async (pin) => pin !== null && mockKeychain.pin === pin);
  keychain.keep.mockImplementation(async (pin, key) => {
    mockKeychain.pin = pin;
    mockKeychain.key = key;
  });
  keychain.read.mockImplementation(async (pin) => (mockKeychain.pin === pin ? mockKeychain.key : null));
  keychain.forget.mockImplementation(async () => {
    mockKeychain.pin = null;
    mockKeychain.key = null;
  });

  pond.adminStatus.mockImplementation(async () => statusNow());
  pond.adminUnlock.mockImplementation(async () => {
    live.unlocked = true;
    return OPENED;
  });
  pond.adminUnlockWithKey.mockImplementation(async (key) => {
    if (live.key === null || key !== live.key) throw refused(403, 'admin_key_rejected');
    live.unlocked = true;
    return OPENED;
  });
  pond.adminEnroll.mockImplementation(async () => {
    live.key = 'key-1';
    return 'key-1';
  });
  pond.adminForgetKey.mockImplementation(async () => {
    live.key = null;
    live.unlocked = false;
  });
  pond.adminLock.mockImplementation(async () => {
    live.unlocked = false;
  });
  pond.adminOverview.mockRejectedValue(new Error('not under test'));
  pond.adminHealth.mockRejectedValue(new Error('not under test'));
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  warn.mockRestore();
});

async function typeCardAndUnlock(form: () => ReturnType<typeof useAdminUnlock>) {
  await act(async () => form().setPassword(MOCK_ADMIN_PASSWORD));
  let ok = false;
  await act(async () => {
    ok = await form().unlock();
  });
  await flush();
  return ok;
}

describe('keeping a key after the card', () => {
  it('enrolls and keeps one for this Pond by default', async () => {
    const m = await mount(both);
    expect(m.vm.form.canKeep).toBe(true);
    expect(m.vm.form.remember).toBe(true);
    expect(m.vm.form.kept).toBe(false);

    expect(await typeCardAndUnlock(() => m.vm.form)).toBe(true);
    expect(pond.adminEnroll).toHaveBeenCalledTimes(1);
    expect(keychain.keep).toHaveBeenCalledWith(PIN, 'key-1', 'Keep a key to My Pond on this phone');
    expect(m.vm.tab.gate.phase).toBe('unlocked');
    expect(m.vm.form.kept).toBe(true);
    expect(m.vm.tab.kept).toBe(true);
    await m.unmount();
  });

  it('keeps nothing when the member turns it off', async () => {
    const m = await mount(both);
    await act(async () => m.vm.form.setRemember(false));
    expect(await typeCardAndUnlock(() => m.vm.form)).toBe(true);
    expect(pond.adminEnroll).not.toHaveBeenCalled();
    expect(keychain.keep).not.toHaveBeenCalled();
    expect(m.vm.form.kept).toBe(false);
    await m.unmount();
  });

  it('never offers it on a phone that cannot keep one', async () => {
    keychain.canKeep.mockReturnValue(false);
    const m = await mount(both);
    expect(m.vm.form.canKeep).toBe(false);
    await typeCardAndUnlock(() => m.vm.form);
    expect(pond.adminEnroll).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('never offers it with nothing paired', async () => {
    server.pairedPin = null;
    const m = await mount(both);
    expect(m.vm.form.canKeep).toBe(false);
    await m.unmount();
  });

  it('stays open and keeps nothing when the save is refused', async () => {
    keychain.keep.mockRejectedValueOnce(new Error('User canceled the authentication'));
    const m = await mount(both);
    expect(await typeCardAndUnlock(() => m.vm.form)).toBe(true);
    expect(m.vm.tab.gate.phase).toBe('unlocked');
    expect(m.vm.form.kept).toBe(false);
    expect(m.vm.form.error).toBeNull();
    await m.unmount();
  });

  it('stays open and keeps nothing when the Pond will not enroll', async () => {
    pond.adminEnroll.mockRejectedValue(new ApiError('POST → 500', 500, null));
    const m = await mount(both);
    expect(await typeCardAndUnlock(() => m.vm.form)).toBe(true);
    expect(keychain.keep).not.toHaveBeenCalled();
    expect(m.vm.tab.gate.phase).toBe('unlocked');
    expect(m.vm.form.error).toBeNull();
    await m.unmount();
  });
});

describe('opening with the kept key', () => {
  it('asks for the phone’s biometrics by itself on arrival, then opens with the key', async () => {
    keepKey();
    const m = await mount(both);
    expect(keychain.read).toHaveBeenCalledTimes(1);
    expect(keychain.read).toHaveBeenCalledWith(PIN, 'Unlock My Pond');
    expect(pond.adminUnlockWithKey).toHaveBeenCalledWith('key-1');
    expect(pond.adminUnlock).not.toHaveBeenCalled();
    expect(m.vm.tab.gate.phase).toBe('unlocked');
    await m.unmount();
  });

  it('stays locked with nothing said when the person cancels, and does not ask again by itself', async () => {
    keepKey();
    keychain.read.mockRejectedValueOnce(new Error('User canceled the operation.'));
    const m = await mount(both);
    expect(m.vm.tab.gate.phase).toBe('locked');
    expect(m.vm.form.error).toBeNull();
    expect(m.vm.form.kept).toBe(true);
    expect(keychain.forget).not.toHaveBeenCalled();

    await advance(ADMIN_STATUS_MS * 3);
    expect(keychain.read).toHaveBeenCalledTimes(1);

    // The button still asks when tapped.
    await act(async () => {
      expect(await m.vm.form.unlockWithKept()).toBe(true);
    });
    expect(keychain.read).toHaveBeenCalledTimes(2);
    expect(m.vm.tab.gate.phase).toBe('unlocked');
    await m.unmount();
  });

  it('does not ask after this phone’s own Lock, only on the next arrival', async () => {
    keepKey();
    const tab = await mount(useMyPond);
    const opening = await mount(useAdminUnlock);
    expect(tab.vm.gate.phase).toBe('unlocked');
    await opening.unmount();
    await act(async () => {
      await tab.vm.actions.lock();
    });
    // The lock mounts fresh once My Pond is locked, as the screen draws it, and the header loses Lock.
    const lock = await mount(useAdminUnlock);
    mockNavigation.generation++;
    await act(async () => {
      await tab.vm.actions.refresh();
    });
    expect(tab.vm.gate.phase).toBe('locked');
    expect(keychain.read).toHaveBeenCalledTimes(1);
    await lock.unmount();

    const later = await mount(useAdminUnlock);
    expect(keychain.read).toHaveBeenCalledTimes(2);
    expect(tab.vm.gate.phase).toBe('unlocked');
    await later.unmount();
    await tab.unmount();
  });

  it('asks again on a later arrival, once', async () => {
    keepKey();
    keychain.read.mockRejectedValue(new Error('User canceled the operation.'));
    const first = await mount(both);
    await first.unmount();
    const second = await mount(both);
    expect(keychain.read).toHaveBeenCalledTimes(2);
    await second.unmount();
  });

  it('forgets a key the phone can no longer read, and says to type the card once more', async () => {
    keepKey();
    keychain.read.mockRejectedValueOnce(new KeptAdminKeyLost());
    const m = await mount(both);
    expect(keychain.forget).toHaveBeenCalledTimes(1);
    expect(m.vm.form.kept).toBe(false);
    expect(m.vm.form.error).toMatch(/can no longer read its key/);
    expect(m.vm.form.error).toMatch(/new fingerprint or face/);
    expect(m.vm.tab.gate.phase).toBe('locked');
    await m.unmount();
  });

  it('says so when the biometrics fail for another reason, and keeps the key', async () => {
    keepKey();
    keychain.read.mockRejectedValueOnce(new Error('Could not Authenticate the user: Lockout.'));
    const m = await mount(both);
    expect(keychain.forget).not.toHaveBeenCalled();
    expect(m.vm.form.kept).toBe(true);
    expect(m.vm.form.error).toMatch(/didn't open the key/);
    await m.unmount();
  });

  it('forgets a key the Pond rejects, says to type the card, and reads whether the Pond is now slowing guesses', async () => {
    keepKey();
    // Replaced on the Pond since, though it still holds a key for this phone.
    live.key = 'key-2';
    const statusReads = () => pond.adminStatus.mock.calls.length;
    const m = await mount(both);
    expect(keychain.forget).toHaveBeenCalled();
    expect(m.vm.form.kept).toBe(false);
    expect(m.vm.form.error).toBe("This phone's key no longer opens My Pond. Type the admin card to open it.");
    expect(statusReads()).toBeGreaterThanOrEqual(2);
    expect(m.vm.tab.gate.phase).toBe('locked');
    await m.unmount();
  });

  it('counts down a cooling Pond and keeps the key', async () => {
    keepKey();
    pond.adminUnlockWithKey.mockImplementationOnce(async () => {
      live.retry = 20;
      throw refused(429, 'admin_cooling', { retry_after: 20 }, 20);
    });
    const m = await mount(both);
    expect(m.vm.form.coolingSecs).toBe(20);
    expect(m.vm.form.kept).toBe(true);
    await act(async () => {
      expect(await m.vm.form.unlockWithKept()).toBe(false);
    });
    expect(keychain.read).toHaveBeenCalledTimes(1);
    await m.unmount();
  });

  it('opens a Pond whose card was never made', async () => {
    keepKey();
    live.card = 'missing';
    const m = await mount(both);
    expect(pond.adminUnlockWithKey).toHaveBeenCalledWith('key-1');
    expect(m.vm.tab.gate.phase).toBe('unlocked');
    await m.unmount();
  });

  it('reads the key once however many screens show the lock', async () => {
    keepKey();
    let release!: (key: string) => void;
    keychain.read.mockImplementationOnce(() => new Promise<string>((resolve) => (release = resolve)));
    const m = await mount(() => ({ tab: useMyPond(), a: useAdminUnlock(), b: useAdminUnlock() }));
    expect(keychain.read).toHaveBeenCalledTimes(1);
    await act(async () => release('key-1'));
    await flush();
    expect(pond.adminUnlockWithKey).toHaveBeenCalledTimes(1);
    expect(m.vm.tab.gate.phase).toBe('unlocked');
    await m.unmount();
  });
});

describe('the status', () => {
  it('forgets the kept key quietly once the Pond no longer holds one', async () => {
    keepKey();
    live.key = null;
    const m = await mount(useMyPond);
    expect(keychain.forget).toHaveBeenCalledTimes(1);
    expect(m.vm.gate.kept).toBe(false);
    expect(m.vm.error).toBeNull();
    await m.unmount();
  });

  it('keeps it while the Pond holds one', async () => {
    keepKey();
    const m = await mount(useMyPond);
    expect(keychain.forget).not.toHaveBeenCalled();
    expect(m.vm.gate.kept).toBe(true);
    await m.unmount();
  });

  it('never takes another Pond’s key for this one', async () => {
    keepKey('key-9', 'sha256/another-pond');
    const m = await mount(both);
    expect(m.vm.form.kept).toBe(false);
    expect(keychain.read).not.toHaveBeenCalled();
    await m.unmount();
  });
});

describe('forgetting it on this phone', () => {
  it('asks first, with Keep it as the safe answer, and does nothing on Keep it', async () => {
    keepKey();
    live.unlocked = true;
    const m = await mount(useMyPond);
    expect(m.vm.kept).toBe(true);
    mockAsk.mockResolvedValue(false);
    await act(async () => {
      expect(await m.vm.actions.forgetKey()).toBe(false);
    });
    expect(mockAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Forget My Pond on this phone?',
        confirmLabel: 'Forget it',
        cancelLabel: 'Keep it',
        message: expect.stringContaining('asks for the admin card'),
      }),
    );
    expect(pond.adminForgetKey).not.toHaveBeenCalled();
    expect(keychain.forget).not.toHaveBeenCalled();
    expect(m.vm.gate.phase).toBe('unlocked');
    await m.unmount();
  });

  it('revokes it on the Pond, forgets it here and locks, on Forget it', async () => {
    keepKey();
    live.unlocked = true;
    const m = await mount(useMyPond);
    mockAsk.mockResolvedValue(true);
    await act(async () => {
      expect(await m.vm.actions.forgetKey()).toBe(true);
    });
    expect(pond.adminForgetKey).toHaveBeenCalledTimes(1);
    expect(keychain.forget).toHaveBeenCalledWith(PIN);
    expect(m.vm.kept).toBe(false);
    expect(m.vm.gate.phase).toBe('locked');
    await m.unmount();
  });

  it('still forgets it here and asks the Pond to lock when the Pond cannot revoke it', async () => {
    keepKey();
    live.unlocked = true;
    pond.adminForgetKey.mockRejectedValue(new Error('Network request failed'));
    const m = await mount(useMyPond);
    mockAsk.mockResolvedValue(true);
    await act(async () => {
      await m.vm.actions.forgetKey();
    });
    expect(pond.adminLock).toHaveBeenCalledTimes(1);
    expect(keychain.forget).toHaveBeenCalledTimes(1);
    expect(m.vm.gate.phase).toBe('locked');
    await m.unmount();
  });
});

describe('on the mock Pond', () => {
  it('keeps a key after the card under the mock’s own pin, and opens with it on the next arrival', async () => {
    server.real = false;
    const first = await mount(both);
    await typeCardAndUnlock(() => first.vm.form);
    expect(keychain.keep).toHaveBeenCalledWith(MOCK_POND_PIN, expect.any(String), expect.any(String));
    await act(async () => {
      await first.vm.tab.actions.lock();
    });
    await first.unmount();

    const second = await mount(both);
    expect(keychain.read).toHaveBeenCalledWith(MOCK_POND_PIN, 'Unlock My Pond');
    expect(second.vm.tab.gate.phase).toBe('unlocked');
    expect(pond.adminUnlockWithKey).not.toHaveBeenCalled();
    await second.unmount();
  });
});
