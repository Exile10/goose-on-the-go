/**
 * Switching a job to another model remembers the one it replaced, so a model that turns out not to
 * work is one tap away from the one that did. A switch the Pond refuses changes nothing.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { api } from '@/services/api-client';
import { Storage } from '@/services/storage';
import type { ModelEntry } from '@/services/types';
import { resetModelLibrary, useModelLibrary, type UseModelLibrary } from '@/view-models/use-model-library';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect: run } = jest.requireActual('react');
    run(effect, [effect]);
  },
}));
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true }) }));
jest.mock('@/services/storage', () => ({
  Storage: { getJSON: jest.fn().mockResolvedValue(null), setJSON: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      listModels: jest.fn(),
      modelMemoryStatus: jest.fn().mockResolvedValue(null),
      diskUsage: jest.fn().mockResolvedValue(null),
      downloadProgress: jest.fn().mockResolvedValue([]),
      activateModel: jest.fn().mockResolvedValue(undefined),
    },
  };
});

const pond = jest.mocked(api);
const storage = jest.mocked(Storage);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const gguf = (name: string, active: boolean): ModelEntry =>
  ({ id: `gguf:${name}`, name, category: 'gguf', active, downloaded: true }) as ModelEntry;

async function mount() {
  let latest!: UseModelLibrary;
  const Probe = () => {
    latest = useModelLibrary();
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
    await new Promise((r) => setTimeout(r, 0));
  });
  return {
    get vm() {
      return latest;
    },
    unmount: () => act(() => tree.unmount()),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetModelLibrary();
  pond.listModels.mockResolvedValue([gguf('old', true), gguf('new', false)]);
});

it('remembers the model a job had, and saves it on the phone', async () => {
  const m = await mount();
  await act(async () => {
    await m.vm.actions.activate(gguf('new', false));
  });
  expect(m.vm.lastWorking.chat).toBe('gguf:old');
  expect(storage.setJSON).toHaveBeenCalledWith('lastWorkingModels', { chat: 'gguf:old' });
  m.unmount();
});

it('switches back to the remembered model in one call', async () => {
  storage.getJSON.mockResolvedValueOnce({ chat: 'gguf:old' });
  pond.listModels.mockResolvedValue([gguf('old', false), gguf('new', true)]);
  const m = await mount();
  let done = false;
  await act(async () => {
    done = await m.vm.actions.rollBack('chat');
  });
  expect(done).toBe(true);
  expect(pond.activateModel).toHaveBeenCalledWith('gguf', 'old', 'chat');
  // The model switched away from is now the one to go back to.
  expect(m.vm.lastWorking.chat).toBe('gguf:new');
  m.unmount();
});

it('remembers nothing when the Pond refuses the switch', async () => {
  pond.activateModel.mockRejectedValueOnce(new Error('refused'));
  const m = await mount();
  await act(async () => {
    await m.vm.actions.activate(gguf('new', false));
  });
  expect(m.vm.lastWorking.chat).toBeUndefined();
  expect(storage.setJSON).not.toHaveBeenCalled();
  m.unmount();
});

it('does nothing when there is no model to go back to', async () => {
  const m = await mount();
  let done = true;
  await act(async () => {
    done = await m.vm.actions.rollBack('chat');
  });
  expect(done).toBe(false);
  expect(pond.activateModel).not.toHaveBeenCalled();
  m.unmount();
});
