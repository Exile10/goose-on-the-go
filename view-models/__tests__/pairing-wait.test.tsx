/**
 * The waiting screen's view-model: it asks until answered, goes on once when the phone is let
 * in, and takes the recovery PIN from the main member's own new phone.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { HeldPairing } from '@/models/pairing-lock';
import { ApiError, type HandshakeResponse, type PairingClaim, type PairingRecovery } from '@/services/api-client';
import '@/services/i18n';
import { usePairingWait, type UsePairingWait } from '@/view-models/use-pairing-wait';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const held: HeldPairing = { requestId: 'req-1', claimSecret: 'secret', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
const tokens = { accepted: true, session_token: 's', refresh_token: 'r' } as HandshakeResponse;

function mount(claim: jest.Mock, recover: jest.Mock, onPaired = jest.fn()) {
  let latest!: UsePairingWait;
  const Probe = () => {
    latest = usePairingWait(held, { claim, recover, onPaired });
    return null;
  };
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<Probe />);
  });
  return {
    get vm() {
      return latest;
    },
    onPaired,
    unmount: () => act(() => tree.unmount()),
  };
}

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const waiting = () => jest.fn(async (): Promise<PairingClaim> => ({ status: 'waiting' }));

describe('waiting to be let in', () => {
  it('asks at once, then every three seconds, and goes on once when the phone is let in', async () => {
    const claim = jest
      .fn<Promise<PairingClaim>, [HeldPairing]>()
      .mockResolvedValueOnce({ status: 'waiting' })
      .mockResolvedValueOnce({ status: 'paired', response: tokens });
    const wait = mount(claim, jest.fn());
    await settle();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(wait.vm.data.phase).toBe('waiting');

    await act(async () => { jest.advanceTimersByTime(2_999); });
    expect(claim).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(1); });
    await settle();

    expect(claim).toHaveBeenCalledTimes(2);
    expect(wait.onPaired).toHaveBeenCalledTimes(1);
    wait.unmount();
  });

  it.each([
    ['declined', { status: 'declined' }],
    ['gone', { status: 'gone' }],
  ] as const)('shows that the request was %s, and asks no more', async (phase, answer) => {
    const claim = jest.fn(async (): Promise<PairingClaim> => answer);
    const wait = mount(claim, jest.fn());
    await settle();
    expect(wait.vm.data.phase).toBe(phase);
    await act(async () => { jest.advanceTimersByTime(30_000); });
    expect(claim).toHaveBeenCalledTimes(1);
    expect(wait.onPaired).not.toHaveBeenCalled();
    wait.unmount();
  });

  it('says why when the Pond will not answer about the request at all', async () => {
    const claim = jest.fn(async (): Promise<PairingClaim> => { throw new ApiError('claim → 403', 403, null); });
    const wait = mount(claim, jest.fn());
    await settle();
    expect(wait.vm.data.phase).toBe('refused');
    expect(wait.vm.data.refusal).toBeTruthy();
    wait.unmount();
  });

  it('stops asking when the screen goes away', async () => {
    const claim = waiting();
    const wait = mount(claim, jest.fn());
    await settle();
    wait.unmount();
    await act(async () => { jest.advanceTimersByTime(30_000); });
    expect(claim).toHaveBeenCalledTimes(1);
  });
});

describe('the recovery PIN', () => {
  async function typing(recover: jest.Mock, pin: string) {
    const wait = mount(waiting(), recover);
    await settle();
    act(() => wait.vm.actions.openRecovery());
    act(() => wait.vm.actions.setPin(pin));
    return wait;
  }

  it('takes digits only, and is ready at six', async () => {
    const wait = await typing(jest.fn(), '12a3 45');
    expect(wait.vm.data.recovery).toMatchObject({ open: true, pin: '12345', ready: false });
    act(() => wait.vm.actions.setPin('123456'));
    expect(wait.vm.data.recovery.ready).toBe(true);
    wait.unmount();
  });

  it('sends nothing for a PIN too short to be one', async () => {
    const recover = jest.fn();
    const wait = await typing(recover, '12345');
    act(() => wait.vm.actions.submitPin());
    await settle();
    expect(recover).not.toHaveBeenCalled();
    wait.unmount();
  });

  it('goes on when the PIN is right', async () => {
    const recover = jest.fn(async (): Promise<PairingRecovery> => ({ status: 'paired', response: tokens }));
    const wait = await typing(recover, '246810');
    act(() => wait.vm.actions.submitPin());
    await settle();
    expect(recover).toHaveBeenCalledWith(held, '246810');
    expect(wait.onPaired).toHaveBeenCalledTimes(1);
    wait.unmount();
  });

  it('says how many tries a wrong PIN leaves, and clears the field', async () => {
    const recover = jest.fn(async (): Promise<PairingRecovery> => ({ status: 'wrong_pin', triesLeft: 2 }));
    const wait = await typing(recover, '000000');
    act(() => wait.vm.actions.submitPin());
    await settle();
    expect(wait.vm.data.recovery).toMatchObject({ pin: '', error: 'That PIN did not match. 2 tries left.' });
    expect(wait.onPaired).not.toHaveBeenCalled();
    wait.unmount();
  });

  it('counts down a wait the Pond asks for, and takes no PIN meanwhile', async () => {
    const recover = jest.fn(async (): Promise<PairingRecovery> => ({ status: 'cooling', retryAfterSecs: 30 }));
    const wait = await typing(recover, '000000');
    act(() => wait.vm.actions.submitPin());
    await settle();
    expect(wait.vm.data.recovery.coolingSecs).toBe(30);

    act(() => wait.vm.actions.setPin('246810'));
    expect(wait.vm.data.recovery.ready).toBe(false);
    act(() => wait.vm.actions.submitPin());
    await settle();
    expect(recover).toHaveBeenCalledTimes(1);
    wait.unmount();
  });

  it('says when the Pond has no recovery PIN', async () => {
    const recover = jest.fn(async (): Promise<PairingRecovery> => ({ status: 'no_pin' }));
    const wait = await typing(recover, '246810');
    act(() => wait.vm.actions.submitPin());
    await settle();
    expect(wait.vm.data.recovery.error).toBe('No recovery PIN was set on this Pond.');
    wait.unmount();
  });
});
