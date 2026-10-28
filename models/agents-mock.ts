// An in-memory Pond that answers as the contract says the real one will. Time is read from the clock
// at each call rather than kept by timers, so nothing runs unasked and a test can move the clock.

import { ApiError } from '@/services/api-client';
import type {
  AgentPrefill,
  AgentPrefills,
  AgentRecipe,
  AgentSuggestion,
  PrefillBuilding,
  RecipeFieldError,
  RecipeValidation,
} from '@/services/types';

import { DEFAULT_RETENTION_DAYS, isReadable, readAgent } from './agents';

/** The routes the agents screens use, so the real Pond and this one are driven by the same code. */
export interface AgentsSource {
  listRecipes(): Promise<AgentRecipe[]>;
  createRecipe(req: { name: string; description: string; yaml: string }): Promise<AgentRecipe>;
  updateRecipe(id: string, patch: { description?: string; yaml?: string; active?: boolean }): Promise<AgentRecipe>;
  deleteRecipe(id: string): Promise<void>;
  validateRecipe(yaml: string, name?: string): Promise<RecipeValidation>;
  listSuggestions(): Promise<AgentSuggestion[]>;
  enableSuggestion(template: string): Promise<AgentRecipe>;
  dismissSuggestion(template: string): Promise<void>;
  prefills(): Promise<AgentPrefills>;
  rebuild(name: string): Promise<void>;
  rebuildAll(): Promise<void>;
}

/** How long the mock waits for a "quiet moment" before a pass starts. */
export const MOCK_QUIET_MS = 3_000;
/** How long the mock takes to compile one agent. */
export const MOCK_COMPILE_MS = 4_000;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The tool groups the Pond never gives an agent, as its validator refuses them. */
const WITHHELD = ['giap-toolkit', 'giap-device-control', 'giap-system', 'giap-schedule', 'giap-orchestrator', 'giap-travel', 'giap-vision', 'giap-tasks'];

const MORNING_BRIEF = `title: Morning brief
description: A short plan for the day, read out at breakfast.
giap_role:
  tool_groups: [giap-weather, giap-knowledge]
  personal_data: inherit
  instructions: |
    Brief the household on the day ahead: the weather, what is on the calendar,
    and anything worth knowing before leaving the house. Keep it under a minute.
  activations:
    - delegated
    - task_step
    - schedule: { cron: "0 0 7 * * MON-FRI", brief: "Brief the house for the day." }
  hooks:
    before: [today, weather]
    after: [notify_owner]
  a2a:
    expose: false
`;

const TRIP_PLANNER = `title: Trip planner
description: Plans a trip from a date and a place.
giap_role:
  tool_groups: [giap-knowledge, giap-task-work]
  personal_data: deny
  max_turns: 8
  instructions: |
    Plan a trip from the dates and the place you are given: how to get there,
    where to stay and what to see. Say what each choice costs.
  activations:
    - delegated
    - task_step
  a2a:
    expose: false
`;

const WELCOME_BACK = `title: Welcome back
description: Says hello when its owner gets home.
giap_role:
  tool_groups: [giap-memory]
  personal_data: inherit
  instructions: |
    Greet the person who just came home, and mention anything they asked
    to be reminded of when they got back.
  activations:
    - delegated
    - event: { on: presence.arrive, member: owner, brief: "Greet them.", cooldown: 30m }
  a2a:
    expose: false
`;

const GATE_ALERT = `title: Late-night gate alert
description: Tells its owner when a camera sees someone at night.
giap_role:
  tool_groups: [giap-memory]
  personal_data: inherit
  instructions: |
    Someone was seen by a camera late at night. Say where and when, in one sentence.
  activations:
    - event: { on: camera.person, camera: any, between: "22:00-06:00", brief: "Tell the owner.", cooldown: 30m }
  hooks:
    after: [notify_owner]
  a2a:
    expose: false
`;

const DOCUMENT_READER = `title: Document reader
description: Reads a document you hand it and answers questions about it.
giap_role:
  tool_groups: [giap-knowledge]
  personal_data: deny
  instructions: |
    Read the document you are given and answer questions about it. Quote the
    passage an answer comes from.
  activations:
    - delegated
    - task_step
  a2a:
    expose: false
`;

interface Template {
  suggestion: AgentSuggestion;
  name: string;
  yaml: string;
}

const TEMPLATES: Template[] = [
  {
    name: 'late-night-gate-alert',
    yaml: GATE_ALERT,
    suggestion: {
      template: 'late_night_gate_alert',
      title: 'Late-night gate alert',
      description: 'Tells you when a camera sees someone between 22:00 and 06:00.',
      why: 'Your Pond has a camera that can see people.',
      needs: ['a camera'],
      activations_summary: 'When a camera sees a person, between 22:00 and 06:00',
    },
  },
  {
    name: 'document-reader',
    yaml: DOCUMENT_READER,
    suggestion: {
      template: 'document_reader',
      title: 'Document reader',
      description: 'Reads a document you hand it and answers questions about it.',
      why: 'Goose can hand it a long document instead of reading it in the conversation.',
      needs: [],
      activations_summary: 'When the assistant hands it a job',
    },
  },
];

interface Pass {
  names: string[];
  startsAt: number;
}

/** A fresh mock Pond, reading `now` as its clock in milliseconds. */
export function createMockAgents(now: () => number = Date.now): AgentsSource {
  const born = now();
  const iso = (ms: number) => new Date(ms).toISOString();
  let nextId = 1;
  const recipe = (name: string, yaml: string, owner: string | null): AgentRecipe => {
    const reading = readAgent(yaml);
    return {
      id: `mock-${nextId++}`,
      name,
      description: isReadable(reading) ? reading.form.description : '',
      yaml,
      active: true,
      created_at: iso(now()),
      title: isReadable(reading) ? reading.form.title : '',
      owner_profile_id: owner,
    };
  };

  const recipes: AgentRecipe[] = [
    recipe('morning-brief', MORNING_BRIEF, 'mock-member'),
    recipe('trip-planner', TRIP_PLANNER, 'mock-member'),
    recipe('welcome-back', WELCOME_BACK, 'mock-member'),
  ];
  const prefills = new Map<string, AgentPrefill>();
  const seed = (agent: string, kind: AgentPrefill['kind'], status: AgentPrefill['status'], compiledAgo: number | null, usedAgo: number | null) =>
    prefills.set(agent, {
      agent,
      kind,
      status,
      compiled_at: compiledAgo === null ? null : iso(born - compiledAgo),
      last_used_at: usedAgo === null ? null : iso(born - usedAgo),
    });
  seed('planner', 'default', 'ready', 2 * HOUR, DAY);
  seed('worker', 'default', 'ready', 2 * HOUR, DAY);
  seed('verifier', 'default', 'ready', 2 * HOUR, DAY);
  seed('morning-brief', 'member', 'ready', 2 * HOUR, 3 * HOUR);
  seed('trip-planner', 'member', 'idle', null, 20 * DAY);
  seed('welcome-back', 'member', 'failed', null, null);

  let suggestions = TEMPLATES.map((t) => t.suggestion);
  let pass: Pass | null = null;

  /** Moves every queued agent along to where the clock says it is. */
  const settle = () => {
    const current = pass;
    if (!current) return;
    const t = now();
    current.names.forEach((name, i) => {
      const p = prefills.get(name);
      if (!p) return;
      const start = current.startsAt + i * MOCK_COMPILE_MS;
      const end = start + MOCK_COMPILE_MS;
      if (t < start) p.status = 'queued';
      else if (t < end) p.status = 'building';
      else {
        p.status = 'ready';
        p.compiled_at = iso(end);
      }
    });
    if (t >= current.startsAt + current.names.length * MOCK_COMPILE_MS) pass = null;
  };

  const building = (): PrefillBuilding => {
    if (!pass) return { active: false, current: null, done: 0, total: 0 };
    const t = now();
    const index = Math.floor((t - pass.startsAt) / MOCK_COMPILE_MS);
    return {
      active: true,
      current: t >= pass.startsAt ? (pass.names[index] ?? null) : null,
      done: Math.max(0, Math.min(index, pass.names.length)),
      total: pass.names.length,
    };
  };

  const enqueue = (names: string[]) => {
    settle();
    for (const name of names) {
      const p = prefills.get(name);
      if (!p) continue;
      p.status = 'queued';
      p.compiled_at = null;
      if (!pass) {
        pass = { names: [name], startsAt: now() + MOCK_QUIET_MS };
        continue;
      }
      const at = pass.names.lastIndexOf(name);
      const finished = at === -1 || now() >= pass.startsAt + (at + 1) * MOCK_COMPILE_MS;
      if (finished) pass.names.push(name);
    }
    settle();
  };

  const find = (id: string) => {
    const found = recipes.find((r) => r.id === id);
    if (!found) throw new ApiError(`mock /api/v1/recipes/${id} → 404`, 404, null, 'Recipe not found');
    return found;
  };

  const validate = (yaml: string, name?: string): RecipeValidation => {
    const reading = readAgent(yaml);
    if (!isReadable(reading)) {
      return { ok: false, role: null, errors: [{ path: 'giap_role', message: 'could not be read as YAML' }] };
    }
    const errors: RecipeFieldError[] = [];
    if (reading.form.instructions.trim() === '') {
      errors.push({ path: 'giap_role.instructions', message: 'is empty; say what the agent is for' });
    }
    reading.form.toolGroups.forEach((group, i) => {
      if (WITHHELD.includes(group)) errors.push({ path: `giap_role.tool_groups[${i}]`, message: `names ${group}, which the pond never gives an agent` });
    });
    const turns = reading.form.maxTurns.trim();
    if (turns !== '' && !(/^\d+$/.test(turns) && Number(turns) >= 1 && Number(turns) <= 12)) {
      errors.push({ path: 'giap_role.max_turns', message: 'must be a whole number from 1 to 12' });
    }
    return {
      ok: errors.length === 0,
      role: errors.length === 0 ? { name: name ?? '', tool_groups: reading.form.toolGroups, preamble_chars: reading.form.instructions.length } : null,
      errors,
    };
  };

  return {
    listRecipes: async () => recipes.map((r) => ({ ...r })),
    createRecipe: async ({ name, description, yaml }) => {
      const made = { ...recipe(name, yaml, 'mock-member'), description };
      const at = recipes.findIndex((r) => r.name === name);
      if (at === -1) recipes.push(made);
      else recipes[at] = made;
      prefills.set(name, { agent: name, kind: 'member', status: 'queued', compiled_at: null, last_used_at: null });
      enqueue([name]);
      return { ...made };
    },
    updateRecipe: async (id, patch) => {
      const r = find(id);
      const changed = patch.yaml !== undefined && patch.yaml !== r.yaml;
      if (patch.yaml !== undefined) {
        r.yaml = patch.yaml;
        const reading = readAgent(patch.yaml);
        r.title = isReadable(reading) ? reading.form.title : r.title;
      }
      if (patch.description !== undefined) r.description = patch.description;
      if (patch.active !== undefined) r.active = patch.active;
      if (changed) enqueue([r.name]);
      return { ...r };
    },
    deleteRecipe: async (id) => {
      const r = find(id);
      recipes.splice(recipes.indexOf(r), 1);
      prefills.delete(r.name);
    },
    validateRecipe: async (yaml, name) => validate(yaml, name),
    listSuggestions: async () => suggestions.map((s) => ({ ...s, needs: [...s.needs] })),
    enableSuggestion: async (template) => {
      const t = TEMPLATES.find((x) => x.suggestion.template === template);
      if (!t) throw new ApiError(`mock enable ${template} → 404`, 404, null, 'there is no shipped agent by that name');
      if (recipes.some((r) => r.name === t.name)) throw new ApiError(`mock enable ${template} → 409`, 409, null, 'you already have this agent');
      const made = recipe(t.name, t.yaml, 'mock-member');
      recipes.push(made);
      suggestions = suggestions.filter((s) => s.template !== template);
      prefills.set(t.name, { agent: t.name, kind: 'member', status: 'queued', compiled_at: null, last_used_at: null });
      enqueue([t.name]);
      return { ...made };
    },
    dismissSuggestion: async (template) => {
      suggestions = suggestions.filter((s) => s.template !== template);
    },
    prefills: async () => {
      settle();
      return {
        building: building(),
        retention_days: DEFAULT_RETENTION_DAYS,
        agents: [...prefills.values()].map((p) => ({ ...p })),
      };
    },
    rebuild: async (name) => {
      if (!prefills.has(name)) throw new ApiError(`mock rebuild ${name} → 404`, 404, null, 'no such agent');
      enqueue([name]);
    },
    rebuildAll: async () => enqueue([...prefills.keys()]),
  };
}
