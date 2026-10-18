/**
 * Asking the Pond to say a code: one request per tap, the Pond's wait counted down, and a code
 * already said kept through a later refusal. Each request is a code read aloud in the house, so
 * the count of requests is the thing pinned here.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import i18n from '@/services/i18n';
import { ApiError, type SpokenCode } from '@/services/api-client';
import { useSpokenCode, type UseSpokenCode } from '@/view-models/use-spoken-code';

const mockRequestSpokenCode = jest.fn<Promise<SpokenCode>, []>();
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ requestSpokenCode: mockRequestSpokenCode }),
}));

const SAID: SpokenCode = { spoken: true, expires_at: '2026-10-17T10:10:00Z' };
const limited = (wait: number | null) =>
  new ApiError('handshake/spoken-code failed: 429', 429, wait, 'spoken_code_limited');

interface Mounted {
  readonly vm: UseSpokenCode;
  unmount: () => void;
}

async function mount(): Promise<Mounted> {
  let latest!: UseSpokenCode;
  const Probe = () => {
    latest = useSpokenCode();
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
    unmount: () => act(() => tree.unmount()),
  };
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mockRequestSpokenCode.mockReset();
  jest.useFakeTimers();
});

afterEach(() => jest.useRealTimers());

it('reports the code as said once the Pond accepts', async () => {
  mockRequestSpokenCode.mockResolvedValue(SAID);
  const m = await mount();
  expect(m.vm.data.phase).toBe('idle');

  let said = false;
  await act(async () => { said = await m.vm.actions.ask(); });

  expect(said).toBe(true);
  expect(m.vm.data.phase).toBe('spoken');
  expect(m.vm.error).toBeNull();
  m.unmount();
});

it('sends one request however many times it is tapped while one is in flight', async () => {
  let release!: (value: SpokenCode) => void;
  mockRequestSpokenCode.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  const m = await mount();

  let first!: Promise<boolean>;
  let second!: Promise<boolean>;
  await act(async () => {
    first = m.vm.actions.ask();
    second = m.vm.actions.ask();
  });
  expect(m.vm.data.phase).toBe('asking');
  await act(async () => { release(SAID); await first; });

  await expect(second).resolves.toBe(false);
  expect(mockRequestSpokenCode).toHaveBeenCalledTimes(1);
  m.unmount();
});

it('counts down the Pond\'s limit, then clears it so asking again is the next step', async () => {
  mockRequestSpokenCode.mockRejectedValue(limited(3));
  const m = await mount();

  await act(async () => { await m.vm.actions.ask(); });
  expect(m.vm.data.waitSecs).toBe(3);
  expect(m.vm.error).toBe(i18n.t('pairingErrors.spokenLimited', { count: 3 }));

  await act(async () => { jest.advanceTimersByTime(1_000); });
  expect(m.vm.data.waitSecs).toBe(2);
  expect(m.vm.error).toBe(i18n.t('pairingErrors.spokenLimited', { count: 2 }));

  await act(async () => { jest.advanceTimersByTime(2_000); });
  expect(m.vm.data.waitSecs).toBe(0);
  expect(m.vm.error).toBeNull();
  // Nothing asked again by itself while the wait ran.
  expect(mockRequestSpokenCode).toHaveBeenCalledTimes(1);
  m.unmount();
});

it('keeps a code already said when a second request is refused', async () => {
  mockRequestSpokenCode.mockResolvedValueOnce(SAID).mockRejectedValueOnce(limited(30));
  const m = await mount();

  await act(async () => { await m.vm.actions.ask(); });
  await act(async () => { await m.vm.actions.ask(); });

  expect(m.vm.data.phase).toBe('spoken');
  expect(m.vm.data.waitSecs).toBe(30);
  expect(m.vm.error).toMatch(/in 30 seconds/);
  m.unmount();
});

it('says why a Pond that cannot or will not speak did not', async () => {
  mockRequestSpokenCode.mockRejectedValueOnce(new ApiError('x', 503, null, 'announcer_unavailable'));
  const m = await mount();
  await act(async () => { await m.vm.actions.ask(); });
  expect(m.vm.data.phase).toBe('idle');
  expect(m.vm.error).toBe(i18n.t('pairingErrors.spokenSilent'));

  mockRequestSpokenCode.mockRejectedValueOnce(new ApiError('x', 403, null, 'spoken_codes_disabled'));
  await act(async () => { await m.vm.actions.ask(); });
  expect(m.vm.error).toBe(i18n.t('pairingErrors.spokenDisabled'));
  m.unmount();
});

it('stops counting when it is unmounted', async () => {
  mockRequestSpokenCode.mockRejectedValue(limited(30));
  const interval = jest.spyOn(globalThis, 'setInterval');
  const clear = jest.spyOn(globalThis, 'clearInterval');
  const m = await mount();
  await act(async () => { await m.vm.actions.ask(); });
  expect(interval).toHaveBeenCalledTimes(1);
  const ticking = interval.mock.results[0].value;
  m.unmount();
  expect(clear).toHaveBeenCalledWith(ticking);
  interval.mockRestore();
  clear.mockRestore();
});

it('forgets a code said by one Pond once another is staged', async () => {
  mockRequestSpokenCode.mockResolvedValueOnce(SAID).mockRejectedValueOnce(limited(30));
  const m = await mount();
  await act(async () => { await m.vm.actions.ask(); });
  await act(async () => { await m.vm.actions.ask(); });
  expect(m.vm.data).toEqual({ phase: 'spoken', waitSecs: 30 });

  await act(async () => { m.vm.actions.reset(); });

  expect(m.vm.data).toEqual({ phase: 'idle', waitSecs: 0 });
  expect(m.vm.error).toBeNull();
  m.unmount();
});
