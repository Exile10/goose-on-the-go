/**
 * The model step gives a model on the Pond the chat job and then finishes setup, once. The Pond
 * writes chat_model on activation but ignores a failed write, so a finish that still refuses must
 * offer a retry rather than spin.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { api } from '@/services/api-client';
import type { DownloadEntry, ModelEntry } from '@/services/types';
import { resetModelLibrary } from '@/view-models/use-model-library';
import type { UseOwnerSetup } from '@/view-models/use-owner-setup';
import { useSetupModel, type UseSetupModel } from '@/view-models/use-setup-model';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    // A screen in front for the whole test: the effect runs once, as on focus.
    const { useEffect: run } = jest.requireActual('react');
    run(effect, [effect]);
  },
}));
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true }) }));
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
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const onDisk = { id: 'gemma', name: 'gemma-3-4b', category: 'llm', active: false, downloaded: true, title: 'Gemma 3 4B' } as unknown as ModelEntry;

async function mount(finish: jest.Mock<Promise<boolean>, []>) {
  let latest!: UseSetupModel;
  const setup = { actions: { finish } } as unknown as UseOwnerSetup;
  const Probe = () => {
    latest = useSetupModel(setup);
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  await act(async () => {
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
  pond.listModels.mockResolvedValue([onDisk]);
});

it('gives a model already on the Pond the chat job, then finishes, once', async () => {
  const finish = jest.fn().mockResolvedValue(true);
  const m = await mount(finish);
  expect(pond.activateModel).toHaveBeenCalledTimes(1);
  expect(pond.activateModel).toHaveBeenCalledWith('llm', 'gemma-3-4b', 'chat');
  expect(finish).toHaveBeenCalledTimes(1);
  expect(m.vm.stalled).toBe(false);
  m.unmount();
});

it('offers a retry when the Pond still will not finish, and activates again on it', async () => {
  const finish = jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  const m = await mount(finish);
  expect(m.vm.stalled).toBe(true);
  expect(finish).toHaveBeenCalledTimes(1);
  await act(async () => {
    m.vm.retry();
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(pond.activateModel).toHaveBeenCalledTimes(2);
  expect(finish).toHaveBeenCalledTimes(2);
  expect(m.vm.stalled).toBe(false);
  m.unmount();
});

it('asks once, not on every read, when the Pond never keeps the activation', async () => {
  const finish = jest.fn().mockResolvedValue(false);
  const m = await mount(finish);
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await m.vm.library.actions.refresh();
    });
  }
  expect(pond.listModels.mock.calls.length).toBeGreaterThan(2);
  expect(pond.activateModel).toHaveBeenCalledTimes(1);
  expect(finish).toHaveBeenCalledTimes(1);
  expect(m.vm.stalled).toBe(true);
  m.unmount();
});

it('finishes as soon as the chat model’s download is moving, leaving the rest to Home', async () => {
  const fetching = { ...onDisk, downloaded: false } as ModelEntry;
  pond.listModels.mockResolvedValue([fetching]);
  const moving: DownloadEntry = {
    model_id: 'llm/gemma-3-4b', filename: 'gemma.gguf', category: 'llm', status: 'downloading', downloaded_bytes: 10, total_bytes: 100, resumable: true,
  };
  pond.downloadProgress.mockResolvedValue([moving]);
  const finish = jest.fn().mockResolvedValue(true);
  const m = await mount(finish);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(m.vm.choice?.kind).toBe('downloading');
  expect(pond.activateModel).toHaveBeenCalledWith('llm', 'gemma-3-4b', 'chat');
  expect(finish).toHaveBeenCalledTimes(1);
  m.unmount();
});
