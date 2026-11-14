import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import type { PromptTemplate } from '@/services/types';
import { usePromptTemplates, type UsePromptTemplates } from '@/view-models/use-prompt-templates';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      listPromptTemplates: jest.fn(),
      getPromptTemplate: jest.fn(),
      updatePromptTemplate: jest.fn(),
      resetPromptTemplate: jest.fn(),
    },
  };
});

const server = { hydrated: true, real: true };
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: server.hydrated, isScreenReal: () => server.real }),
}));

const pond = jest.mocked(api);

const tpl = (name: string, content = `${name} content`, customized = false): PromptTemplate => ({
  name,
  content,
  is_system: true,
  is_customized: customized,
  updated_at: '2026-11-12T00:00:00Z',
});

interface Mounted {
  readonly vm: UsePromptTemplates;
  unmount: () => Promise<void>;
}

async function mount(): Promise<Mounted> {
  let latest!: UsePromptTemplates;
  function Probe() {
    latest = usePromptTemplates();
    return null;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Probe />);
  });
  return {
    get vm() {
      return latest;
    },
    unmount: async () => {
      await act(async () => {
        renderer.unmount();
      });
    },
  };
}

describe('usePromptTemplates', () => {
  beforeEach(() => {
    server.hydrated = true;
    server.real = true;
    pond.listPromptTemplates.mockReset();
    pond.updatePromptTemplate.mockReset();
    pond.resetPromptTemplate.mockReset();
  });

  it('loads templates and defaults to soul', async () => {
    pond.listPromptTemplates.mockResolvedValue([
      tpl('heartbeat'),
      tpl('soul', 'I hear, talk, see, and organize.'),
      tpl('scratchpad'),
    ]);

    const m = await mount();

    expect(m.vm.data.templates).toHaveLength(3);
    expect(m.vm.data.activeName).toBe('soul');
    expect(m.vm.data.content).toBe('I hear, talk, see, and organize.');
    expect(m.vm.data.isDirty).toBe(false);
    expect(m.vm.data.isCustomized).toBe(false);
  });

  it('tracks dirty state when user edits content', async () => {
    pond.listPromptTemplates.mockResolvedValue([tpl('soul', 'Initial soul')]);

    const m = await mount();
    expect(m.vm.data.isDirty).toBe(false);

    act(() => {
      m.vm.actions.setContent('Customized soul words');
    });

    expect(m.vm.data.content).toBe('Customized soul words');
    expect(m.vm.data.isDirty).toBe(true);
  });

  it('saves template and updates customized status', async () => {
    pond.listPromptTemplates.mockResolvedValue([tpl('soul', 'Initial soul')]);
    pond.updatePromptTemplate.mockResolvedValue(tpl('soul', 'Customized soul', true));

    const m = await mount();

    act(() => {
      m.vm.actions.setContent('Customized soul');
    });

    let ok = false;
    await act(async () => {
      ok = await m.vm.actions.save();
    });

    expect(ok).toBe(true);
    expect(pond.updatePromptTemplate).toHaveBeenCalledWith('soul', 'Customized soul');
    expect(m.vm.data.isDirty).toBe(false);
    expect(m.vm.data.isCustomized).toBe(true);
  });

  it('resets template back to factory default', async () => {
    pond.listPromptTemplates.mockResolvedValue([tpl('soul', 'Customized soul', true)]);
    pond.resetPromptTemplate.mockResolvedValue(tpl('soul', 'Factory soul', false));

    const m = await mount();
    expect(m.vm.data.isCustomized).toBe(true);

    let ok = false;
    await act(async () => {
      ok = await m.vm.actions.reset();
    });

    expect(ok).toBe(true);
    expect(pond.resetPromptTemplate).toHaveBeenCalledWith('soul');
    expect(m.vm.data.content).toBe('Factory soul');
    expect(m.vm.data.isCustomized).toBe(false);
  });
});
