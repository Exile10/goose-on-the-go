/**
 * The settings store every Settings page shares: a change shows at once, is sent alone, and is
 * taken back if the Pond refuses it; the Pond's answer, not the patch, is what stays.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { SAMPLE_SETTINGS } from '@/models/pond-settings';
import { ApiError, api } from '@/services/api-client';
import type { PondSettings } from '@/services/types';
import { resetPondSettingsStore, usePondSettings, type UsePondSettings } from '@/view-models/use-pond-settings';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { getSettings: jest.fn(), updateSettings: jest.fn(), applyTts: jest.fn() } };
});

const server = { hydrated: true, real: true };
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: server.hydrated, isScreenReal: () => server.real }),
}));

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
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function mount() {
  let latest!: UsePondSettings;
  const Probe = () => {
    latest = usePondSettings();
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
    unmount: () => act(async () => tree.unmount()),
  };
}

const record = (patch: Partial<PondSettings> = {}): PondSettings => ({ ...SAMPLE_SETTINGS, ...patch });

beforeEach(() => {
  jest.clearAllMocks();
  resetPondSettingsStore();
  server.hydrated = true;
  server.real = true;
  pond.getSettings.mockResolvedValue(record());
  pond.applyTts.mockResolvedValue({} as never);
});

it('waits for the saved pairing before reading', async () => {
  server.hydrated = false;
  const m = await mount();
  expect(pond.getSettings).not.toHaveBeenCalled();
  expect(m.vm.loading).toBe(true);
  await m.unmount();
});

it('shows a change at once and sends only that field', async () => {
  const m = await mount();
  const answer = deferred<PondSettings>();
  pond.updateSettings.mockReturnValueOnce(answer.promise);

  let saved!: Promise<boolean>;
  act(() => {
    saved = m.vm.actions.update('mic_enabled', false);
  });
  expect(m.vm.settings?.mic_enabled).toBe(false);
  expect(m.vm.saving.mic_enabled).toBe(true);
  expect(pond.updateSettings).toHaveBeenCalledWith({ mic_enabled: false });

  await act(async () => {
    answer.resolve(record({ mic_enabled: false }));
    await saved;
  });
  expect(m.vm.saving.mic_enabled).toBeUndefined();
  await m.unmount();
});

it('keeps what the Pond answered rather than what was sent', async () => {
  const m = await mount();
  pond.updateSettings.mockResolvedValueOnce(record({ quiet_hours_start: '09:05' }));
  await act(async () => {
    await m.vm.actions.update('quiet_hours_start', '9:05');
  });
  expect(m.vm.settings?.quiet_hours_start).toBe('09:05');
  await m.unmount();
});

it('puts the old value back and says why when the Pond refuses', async () => {
  const m = await mount();
  pond.updateSettings.mockRejectedValueOnce(
    new ApiError('PUT /api/v1/settings → 422', 422, null, 'network_mode must be one of open, allowlist, offline'),
  );
  let kept!: boolean;
  await act(async () => {
    kept = await m.vm.actions.update('network_mode', 'closed');
  });
  expect(kept).toBe(false);
  expect(m.vm.settings?.network_mode).toBe('open');
  expect(m.vm.fieldErrors.network_mode).toMatch(/network_mode/);
  await m.unmount();
});

it('never lets an older answer undo a newer change', async () => {
  const m = await mount();
  const first = deferred<PondSettings>();
  const second = deferred<PondSettings>();
  pond.updateSettings.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

  let a!: Promise<boolean>;
  let b!: Promise<boolean>;
  act(() => {
    a = m.vm.actions.update('agent_memory_limit', 6);
  });
  act(() => {
    b = m.vm.actions.update('agent_memory_limit', 7);
  });
  await act(async () => {
    second.resolve(record({ agent_memory_limit: 7 }));
    await b;
    first.resolve(record({ agent_memory_limit: 6 }));
    await a;
  });
  expect(m.vm.settings?.agent_memory_limit).toBe(7);
  await m.unmount();
});

it('keeps a field still being saved when another answer lands', async () => {
  const m = await mount();
  const slow = deferred<PondSettings>();
  pond.updateSettings.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(record({ show_thinking: true }));
  let pending!: Promise<boolean>;
  act(() => {
    pending = m.vm.actions.update('assistant_name', 'Kuku');
  });
  await act(async () => {
    await m.vm.actions.update('show_thinking', true);
  });
  expect(m.vm.settings?.assistant_name).toBe('Kuku');
  expect(m.vm.settings?.show_thinking).toBe(true);
  await act(async () => {
    slow.resolve(record({ assistant_name: 'Kuku', show_thinking: true }));
    await pending;
  });
  await m.unmount();
});

it('makes the speaking engine use a new voice now, not on its next restart', async () => {
  const m = await mount();
  pond.updateSettings.mockResolvedValueOnce(record({ voice_tts_voice: 'bf_emma' }));
  await act(async () => {
    await m.vm.actions.update('voice_tts_voice', 'bf_emma');
  });
  expect(pond.applyTts).toHaveBeenCalledWith({ voice: 'bf_emma' });
  await m.unmount();
});

it('settles a voice change only once the engine has it, so a preview hears the new voice', async () => {
  const m = await mount();
  pond.updateSettings.mockResolvedValueOnce(record({ voice_tts_voice: 'bf_emma' }));
  let applied: () => void = () => {};
  pond.applyTts.mockReturnValueOnce(new Promise((resolve) => (applied = () => resolve({} as never))) as never);
  let settled = false;
  await act(async () => {
    void m.vm.actions.update('voice_tts_voice', 'bf_emma').then(() => (settled = true));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(settled).toBe(false);
  await act(async () => {
    applied();
    await Promise.resolve();
  });
  expect(settled).toBe(true);
  await m.unmount();
});

it('does not touch the engine for a setting that is not about the voice', async () => {
  const m = await mount();
  pond.updateSettings.mockResolvedValueOnce(record({ show_thinking: true }));
  await act(async () => {
    await m.vm.actions.update('show_thinking', true);
  });
  expect(pond.applyTts).not.toHaveBeenCalled();
  await m.unmount();
});

it('reports a record it could not read as unknown, not empty', async () => {
  pond.getSettings.mockRejectedValueOnce(new ApiError('GET /api/v1/settings → 503', 503, null));
  const m = await mount();
  expect(m.vm.settings).toBeNull();
  expect(m.vm.failed).toBe(true);
  await m.unmount();
});

it('works on the Pond’s defaults on mock, and asks the Pond nothing', async () => {
  server.real = false;
  const m = await mount();
  expect(m.vm.settings).toEqual(SAMPLE_SETTINGS);
  await act(async () => {
    await m.vm.actions.update('mic_enabled', false);
  });
  expect(m.vm.settings?.mic_enabled).toBe(false);
  expect(pond.getSettings).not.toHaveBeenCalled();
  expect(pond.updateSettings).not.toHaveBeenCalled();
  await m.unmount();
});
