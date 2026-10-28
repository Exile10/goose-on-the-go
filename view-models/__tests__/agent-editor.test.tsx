// A save must keep what the dashboard set, and a new agent must never be saved over a taken name,
// because the Pond replaces that recipe without asking.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { parseYaml, type YamlMap } from '@/models/agent-yaml';
import { ApiError, api } from '@/services/api-client';
import type { AgentPrefills, AgentRecipe, RecipeValidation } from '@/services/types';
import { useAgentEditor, type UseAgentEditor } from '@/view-models/use-agent-editor';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect: run } = jest.requireActual('react');
    run(effect, [effect]);
  },
}));
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true, online: true, isScreenReal: () => true }) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      listRecipes: jest.fn(),
      validateRecipe: jest.fn(),
      createRecipe: jest.fn(),
      updateRecipe: jest.fn(),
      deleteRecipe: jest.fn(),
      agentPrefills: jest.fn(),
      rebuildAgentPrefill: jest.fn(),
    },
  };
});

const pond = jest.mocked(api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BRIEF_YAML = `title: Morning brief
giap_role:
  tool_groups: [giap-weather]
  personal_data: inherit
  instructions: |
    Brief the house.
  activations:
    - delegated
    - schedule: { cron: "0 0 7 * * MON-FRI", brief: "Go." }
  hooks:
    after: [notify_owner]
`;
const BRIEF: AgentRecipe = { id: 'r1', name: 'morning-brief', description: 'A plan for the day.', yaml: BRIEF_YAML };
const OK: RecipeValidation = { ok: true, role: { name: 'x', tool_groups: [], preamble_chars: 10 }, errors: [] };
const PREFILLS: AgentPrefills = {
  building: { active: false, current: null, done: 0, total: 0 },
  retention_days: 14,
  agents: [{ agent: 'morning-brief', kind: 'member', status: 'ready', compiled_at: '2026-10-28T07:00:00Z', last_used_at: null }],
};

async function mount(name: string | null) {
  let latest!: UseAgentEditor;
  const Probe = () => {
    latest = useAgentEditor(name);
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

async function save(m: { vm: UseAgentEditor }): Promise<AgentRecipe | null> {
  let saved: AgentRecipe | null = null;
  await act(async () => {
    saved = await m.vm.actions.save();
  });
  return saved;
}

const sentYaml = () => parseYaml(pond.updateRecipe.mock.calls[0][1].yaml as string) as YamlMap;

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  pond.listRecipes.mockResolvedValue([BRIEF]);
  pond.validateRecipe.mockResolvedValue(OK);
  pond.updateRecipe.mockImplementation(async (id, patch) => ({ ...BRIEF, id, description: patch.description ?? '', yaml: patch.yaml ?? BRIEF.yaml }));
  pond.createRecipe.mockImplementation(async (req) => ({ id: 'new-1', ...req }));
  pond.deleteRecipe.mockResolvedValue(undefined);
  pond.agentPrefills.mockResolvedValue(PREFILLS);
  pond.rebuildAgentPrefill.mockResolvedValue(undefined);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => warn.mockRestore());

describe('opening an agent', () => {
  it('fills the form, says how it runs, and is not a change until something is', async () => {
    const m = await mount('morning-brief');
    expect(m.vm.load).toBe('ready');
    expect(m.vm.data.form).toMatchObject({ title: 'Morning brief', instructions: 'Brief the house.', toolGroups: ['giap-weather'] });
    expect(m.vm.data.reading?.activations.map((a) => a.kind)).toEqual(['delegated', 'schedule']);
    expect(m.vm.data.nameLocked).toBe(true);
    expect(m.vm.data.dirty).toBe(false);
    expect(m.vm.data.prefill?.status).toBe('ready');
    expect(pond.listRecipes).toHaveBeenCalledTimes(1);
    await m.unmount();
  });

  it('says an agent that is no longer there is gone', async () => {
    const m = await mount('nobody');
    expect(m.vm.load).toBe('gone');
    await m.unmount();
  });

  it('offers only delete and rebuild for an agent it cannot read', async () => {
    pond.listRecipes.mockResolvedValue([{ ...BRIEF, yaml: 'giap_role:\n  instructions: "never closed\n' }]);
    const m = await mount('morning-brief');
    expect(m.vm.data.unreadable).toEqual({ line: 2 });
    expect(await save(m)).toBeNull();
    expect(pond.validateRecipe).not.toHaveBeenCalled();
    await m.unmount();
  });
});

describe('saving a change', () => {
  it('checks once, saves once, and keeps the schedule and hooks it does not show', async () => {
    const m = await mount('morning-brief');
    await act(async () => m.vm.actions.setField('instructions', 'Brief the house, briefly.'));
    await act(async () => m.vm.actions.toggleTool('giap-knowledge'));
    expect(m.vm.data.dirty).toBe(true);

    const saved = await save(m);
    expect(saved).not.toBeNull();
    expect(pond.validateRecipe).toHaveBeenCalledTimes(1);
    expect(pond.updateRecipe).toHaveBeenCalledTimes(1);
    expect(pond.updateRecipe.mock.calls[0][0]).toBe('r1');
    const role = sentYaml().giap_role as YamlMap;
    expect(role.instructions).toBe('Brief the house, briefly.\n');
    expect(role.tool_groups).toEqual(['giap-weather', 'giap-knowledge']);
    expect(role.activations).toEqual(['delegated', { schedule: { cron: '0 0 7 * * MON-FRI', brief: 'Go.' } }]);
    expect(role.hooks).toEqual({ after: ['notify_owner'] });
    expect(m.vm.data.dirty).toBe(false);
    expect(m.vm.notice).toBe('Saved. Your Pond compiles it again at its next quiet moment.');
    await m.unmount();
  });

  it('puts the Pond problems under their fields, lists the others with their paths, and saves nothing', async () => {
    pond.validateRecipe.mockResolvedValue({
      ok: false,
      role: null,
      errors: [
        { path: 'giap_role.instructions', message: 'is too long for an agent' },
        { path: 'giap_role.activations[1].schedule.cron', message: 'is not a cron the scheduler reads' },
      ],
    });
    const m = await mount('morning-brief');
    await act(async () => m.vm.actions.setField('instructions', 'x'.repeat(50)));
    expect(await save(m)).toBeNull();
    expect(pond.updateRecipe).not.toHaveBeenCalled();
    expect(m.vm.data.fieldErrors.instructions).toBe('This is too long for an agent.');
    expect(m.vm.data.otherErrors).toEqual([{ path: 'giap_role.activations[1].schedule.cron', message: 'This is not a cron the scheduler reads.' }]);

    // Editing the field clears its own problem, and only that one.
    await act(async () => m.vm.actions.setField('instructions', 'Shorter.'));
    expect(m.vm.data.fieldErrors.instructions).toBeUndefined();
    expect(m.vm.data.otherErrors).toHaveLength(1);
    await m.unmount();
  });

  it('refuses empty instructions on the phone, without asking the Pond', async () => {
    const m = await mount('morning-brief');
    await act(async () => m.vm.actions.setField('instructions', '  '));
    expect(await save(m)).toBeNull();
    expect(pond.validateRecipe).not.toHaveBeenCalled();
    expect(m.vm.data.fieldErrors.instructions).toBe('Say what the agent is for.');
    await m.unmount();
  });

  it('saves unchecked on a Pond without the validate route, as the dashboard does', async () => {
    pond.validateRecipe.mockRejectedValue(new ApiError('POST → 404', 404, null));
    const m = await mount('morning-brief');
    await act(async () => m.vm.actions.setField('description', 'Read at breakfast.'));
    expect(await save(m)).not.toBeNull();
    expect(pond.updateRecipe).toHaveBeenCalledTimes(1);
    expect(pond.updateRecipe.mock.calls[0][1].description).toBe('Read at breakfast.');
    await m.unmount();
  });

  it('keeps the edit and says why when a check fails for another reason', async () => {
    pond.validateRecipe.mockRejectedValue(new ApiError('POST → 503', 503, null));
    const m = await mount('morning-brief');
    await act(async () => m.vm.actions.setField('instructions', 'New words.'));
    expect(await save(m)).toBeNull();
    expect(pond.updateRecipe).not.toHaveBeenCalled();
    expect(m.vm.error).toBe('Your Pond is busy. Try again in a moment.');
    expect(m.vm.data.form.instructions).toBe('New words.');
    await m.unmount();
  });

  it("says in words when a shipped agent's copy would gain tools", async () => {
    pond.updateRecipe.mockRejectedValue(new ApiError('PUT → 422', 422, null));
    const m = await mount('morning-brief');
    await act(async () => m.vm.actions.toggleTool('giap-memory'));
    expect(await save(m)).toBeNull();
    expect(m.vm.error).toBe('This agent is a copy of one your Pond ships, so it can have fewer tools than that one, never more.');
    await m.unmount();
  });
});

describe('a new agent', () => {
  it('takes its name from the title and is created under it', async () => {
    const m = await mount(null);
    expect(m.vm.load).toBe('ready');
    await act(async () => m.vm.actions.setField('title', 'Plant minder'));
    await act(async () => m.vm.actions.setField('instructions', 'Say which plants need water.'));
    expect(m.vm.data.name).toBe('plant-minder');

    const saved = await save(m);
    expect(saved?.name).toBe('plant-minder');
    expect(pond.validateRecipe).toHaveBeenCalledWith(expect.any(String), 'plant-minder');
    expect(pond.createRecipe).toHaveBeenCalledTimes(1);
    const role = (parseYaml(pond.createRecipe.mock.calls[0][0].yaml) as YamlMap).giap_role as YamlMap;
    // Nothing about a new agent starts on its own.
    expect(role.activations).toEqual(['delegated', 'task_step']);
    expect(m.vm.data.nameLocked).toBe(true);
    expect(m.vm.data.dirty).toBe(false);
    expect(m.vm.notice).toBe('Plant minder is added. Your Pond compiles it at its next quiet moment.');
    await m.unmount();
  });

  it('will not save over a name already taken, and asks the Pond nothing', async () => {
    const m = await mount(null);
    await act(async () => m.vm.actions.setField('title', 'Morning brief'));
    await act(async () => m.vm.actions.setField('instructions', 'Again.'));
    expect(await save(m)).toBeNull();
    expect(pond.validateRecipe).not.toHaveBeenCalled();
    expect(pond.createRecipe).not.toHaveBeenCalled();
    expect(m.vm.data.nameProblem).toBe('A recipe named morning-brief already exists. Choose another name, or saving would replace it.');
    await m.unmount();
  });

  it('will not save when the names taken could not be read', async () => {
    pond.listRecipes.mockRejectedValue(new TypeError('Network request failed'));
    const m = await mount(null);
    await act(async () => m.vm.actions.setField('title', 'Plant minder'));
    await act(async () => m.vm.actions.setField('instructions', 'Water.'));
    expect(await save(m)).toBeNull();
    expect(pond.createRecipe).not.toHaveBeenCalled();
    expect(pond.listRecipes).toHaveBeenCalledTimes(2);
    expect(m.vm.error).toMatch(/did not list the names already taken/);
    await m.unmount();
  });

  it('asks for a name only once there is something to name', async () => {
    const m = await mount(null);
    expect(m.vm.data.nameProblem).toBeNull();
    await act(async () => m.vm.actions.setField('instructions', 'Water.'));
    await save(m);
    expect(m.vm.data.nameProblem).toBe('Give the agent a name.');
    await m.unmount();
  });
});

describe('deleting and rebuilding', () => {
  it('deletes by id, once', async () => {
    const m = await mount('morning-brief');
    let gone = false;
    await act(async () => {
      gone = await m.vm.actions.remove();
    });
    expect(gone).toBe(true);
    expect(pond.deleteRecipe).toHaveBeenCalledTimes(1);
    expect(pond.deleteRecipe).toHaveBeenCalledWith('r1');
    await m.unmount();
  });

  it('rebuilds its own prefill, by name, once', async () => {
    const m = await mount('morning-brief');
    await act(async () => {
      await m.vm.actions.rebuild();
    });
    expect(pond.rebuildAgentPrefill).toHaveBeenCalledTimes(1);
    expect(pond.rebuildAgentPrefill).toHaveBeenCalledWith('morning-brief');
    expect(m.vm.notice).toBe("Morning brief will be compiled again at your Pond's next quiet moment.");
    await m.unmount();
  });
});
