// A save from the phone must not drop what the dashboard set, so these read the written YAML back
// and compare everything the form does not own.

import { parseYaml, type YamlMap } from '@/models/agent-yaml';
import {
  agentNameProblem,
  agentRows,
  builtInPrefills,
  canRebuild,
  fieldOf,
  fieldSentence,
  isAgentYaml,
  isReadable,
  newAgentForm,
  readAgent,
  readPrefills,
  slugifyAgentName,
  startsByItself,
  writeAgent,
  type AgentReading,
} from '@/models/agents';
import type { AgentPrefill, AgentRecipe } from '@/services/types';

const BRIEF = `title: Morning brief
description: A short plan for the day.
giap_role:
  tool_groups: [giap-weather, giap-knowledge]
  personal_data: inherit
  max_turns: 8
  instructions: |
    Brief the household on the day ahead.
    Keep it short.
  context:
    examples:
      - brief: "Brief me"
        answer: "It is sunny."
  activations:
    - delegated
    - schedule: { cron: "0 0 7 * * MON-FRI", brief: "Brief the house." }
    - event: { on: presence.arrive, member: owner, brief: "Greet them.", cooldown: 30m }
  hooks:
    before: [today, weather]
    after: [notify_owner, { hand_to: trip-planner }]
  a2a:
    expose: true
prompt: Try me
`;

function read(yaml: string): AgentReading {
  const r = readAgent(yaml);
  if (!isReadable(r)) throw new Error('expected a readable agent');
  return r;
}

const role = (yaml: string) => (parseYaml(yaml) as YamlMap).giap_role as YamlMap;

describe('reading an agent', () => {
  it('fills the form from the recipe', () => {
    expect(read(BRIEF).form).toEqual({
      title: 'Morning brief',
      description: 'A short plan for the day.',
      instructions: 'Brief the household on the day ahead.\nKeep it short.',
      toolGroups: ['giap-weather', 'giap-knowledge'],
      personalData: 'inherit',
      maxTurns: '8',
    });
  });

  it('reads how it runs, its hooks and its sharing for the words', () => {
    const r = read(BRIEF);
    expect(r.activations).toEqual([
      { kind: 'delegated' },
      { kind: 'schedule', cron: '0 0 7 * * MON-FRI' },
      { kind: 'event', on: 'presence.arrive', member: 'owner', camera: '', device: '', above: '', below: '', at: '' },
    ]);
    expect(r.before).toEqual(['today', 'weather']);
    expect(r.after).toEqual([
      { hook: 'notify_owner', agent: '' },
      { hook: 'hand_to', agent: 'trip-planner' },
    ]);
    expect(r.shared).toBe(true);
    expect(startsByItself(r.activations)).toBe(true);
  });

  it('gives an agent with no activations the two the Pond defaults to', () => {
    const r = read('giap_role:\n  instructions: Do it.\n');
    expect(r.activations).toEqual([{ kind: 'delegated' }, { kind: 'task_step' }]);
    expect(startsByItself(r.activations)).toBe(false);
  });

  it('falls back to the recipe row description when the YAML has none', () => {
    expect(read('giap_role:\n  instructions: x\n').form.description).toBe('');
    const r = readAgent('giap_role:\n  instructions: x\n', 'From the row');
    expect(isReadable(r) && r.form.description).toBe('From the row');
  });

  it('says which line it cannot read, rather than guessing at a form', () => {
    expect(readAgent('giap_role:\n  instructions: "never closed\n')).toEqual({ line: 2 });
    expect(readAgent('- a list\n- not a recipe\n')).toEqual({ line: null });
    expect(readAgent('giap_role:\n  tool_groups: {a: 1}\n')).toEqual({ line: null });
  });

  it('tells an agent from a plain recipe by its giap_role key', () => {
    expect(isAgentYaml(BRIEF)).toBe(true);
    expect(isAgentYaml('title: Lock up\nprompt: Lock the doors\n')).toBe(false);
  });
});

describe('writing an agent back', () => {
  it('keeps everything the form does not show, exactly', () => {
    const r = read(BRIEF);
    const written = writeAgent(r.doc, { ...r.form, instructions: 'Something else entirely.' });

    const before = role(BRIEF);
    const after = role(written);
    expect(after.instructions).toBe('Something else entirely.\n');
    for (const key of ['context', 'activations', 'hooks', 'a2a']) expect(after[key]).toEqual(before[key]);
    expect((parseYaml(written) as YamlMap).prompt).toBe('Try me');
  });

  it('writes an untouched agent the same way twice, so opening one is not a change', () => {
    const r = read(BRIEF);
    const once = writeAgent(r.doc, r.form);
    const again = read(once);
    expect(writeAgent(again.doc, again.form)).toBe(once);
  });

  it('does not change the document it was given', () => {
    const r = read(BRIEF);
    const copy = JSON.stringify(r.doc);
    writeAgent(r.doc, { ...r.form, toolGroups: [] });
    expect(JSON.stringify(r.doc)).toBe(copy);
  });

  it('drops a cleared title, description and step limit rather than writing them empty', () => {
    const r = read(BRIEF);
    const written = parseYaml(writeAgent(r.doc, { ...r.form, title: ' ', description: '', maxTurns: '' })) as YamlMap;
    expect('title' in written).toBe(false);
    expect('description' in written).toBe(false);
    expect('max_turns' in (written.giap_role as YamlMap)).toBe(false);
  });

  it('writes a new agent in the order the desktop does, asked for only by name', () => {
    const yaml = writeAgent(null, {
      ...newAgentForm(),
      title: 'Plant minder',
      instructions: 'Say which plants need water.',
      toolGroups: ['giap-sensors'],
    });
    expect(yaml).toBe(
      [
        'title: "Plant minder"',
        'giap_role:',
        '  tool_groups:',
        '    - giap-sensors',
        '  personal_data: inherit',
        '  instructions: |',
        '    Say which plants need water.',
        '  activations:',
        '    - delegated',
        '    - task_step',
        '  a2a:',
        '    expose: false',
        '',
      ].join('\n'),
    );
    expect(startsByItself(read(yaml).activations)).toBe(false);
  });
});

describe('names', () => {
  it('makes a name from the title', () => {
    expect(slugifyAgentName('  Morning Brief!  ')).toBe('morning-brief');
  });

  it('refuses an empty, long, oddly shaped or taken name', () => {
    expect(agentNameProblem('', [])).toBe('empty');
    expect(agentNameProblem('a'.repeat(65), [])).toBe('tooLong');
    expect(agentNameProblem('-brief', [])).toBe('shape');
    expect(agentNameProblem('Brief', [])).toBe('shape');
    expect(agentNameProblem('brief', ['brief'])).toBe('taken');
    expect(agentNameProblem('morning_brief-2', ['brief'])).toBeNull();
  });
});

describe('where the Pond says a problem is', () => {
  it('puts each path under the field that owns it', () => {
    expect(fieldOf('giap_role.instructions')).toBe('instructions');
    expect(fieldOf('giap_role.tool_groups[2]')).toBe('toolGroups');
    expect(fieldOf('giap_role.personal_data')).toBe('personalData');
    expect(fieldOf('giap_role.max_turns')).toBe('maxTurns');
    expect(fieldOf('giap_role.activations[1].event.on')).toBeNull();
  });

  it('gives a message written to follow a field name its subject back', () => {
    expect(fieldSentence('is empty; say what the agent is for')).toBe('This is empty; say what the agent is for.');
    expect(fieldSentence('unknown hook `later`')).toBe('Unknown hook `later`.');
  });
});

describe('the prefill listing', () => {
  it('reads the contract, and an unknown status as not built', () => {
    const read = readPrefills({
      building: { active: true, current: 'planner', done: 1, total: 4 },
      retention_days: 21,
      agents: [
        { agent: 'planner', kind: 'default', status: 'building', compiled_at: null, last_used_at: '2026-10-01T00:00:00Z' },
        { agent: 'brief', kind: 'member', status: 'melting', compiled_at: '', last_used_at: null },
        { kind: 'member', status: 'ready' },
      ],
    });
    expect(read).toEqual({
      building: { active: true, current: 'planner', done: 1, total: 4 },
      retention_days: 21,
      agents: [
        { agent: 'planner', kind: 'default', status: 'building', compiled_at: null, last_used_at: '2026-10-01T00:00:00Z' },
        { agent: 'brief', kind: 'member', status: 'not_built', compiled_at: null, last_used_at: null },
      ],
    });
  });

  it('is null for a body that is not the listing, rather than an empty one', () => {
    expect(readPrefills(null)).toBeNull();
    expect(readPrefills({ agents: 'none' })).toBeNull();
    expect(readPrefills([])).toBeNull();
  });

  it('assumes the Pond default when the retention is left out', () => {
    expect(readPrefills({ agents: [] })?.retention_days).toBe(14);
    expect(readPrefills({ agents: [] })?.building).toEqual({ active: false, current: null, done: 0, total: 0 });
  });
});

describe('the rows', () => {
  const recipe = (name: string, yaml: string, extra: Partial<AgentRecipe> = {}): AgentRecipe => ({ id: `id-${name}`, name, yaml, ...extra });
  const prefill = (agent: string, status: AgentPrefill['status'], kind: AgentPrefill['kind'] = 'member'): AgentPrefill => ({
    agent,
    kind,
    status,
    compiled_at: null,
    last_used_at: null,
  });

  it('lists agents only, titled and sorted, with each one prefill joined by name', () => {
    const rows = agentRows(
      [
        recipe('brief', BRIEF),
        recipe('lock-up', 'title: Lock up\nprompt: Lock the doors\n'),
        recipe('a-helper', 'giap_role:\n  instructions: Help out.\n', { active: false }),
      ],
      [prefill('brief', 'ready'), prefill('planner', 'ready', 'default')],
    );
    expect(rows.map((r) => [r.name, r.title, r.purpose, r.paused, r.startsByItself, r.prefill?.status ?? null])).toEqual([
      ['a-helper', 'a-helper', 'Help out.', true, false, null],
      ['brief', 'Morning brief', 'A short plan for the day.', false, true, 'ready'],
    ]);
  });

  it('still lists an agent the phone cannot read, so it can be deleted', () => {
    const [row] = agentRows([recipe('odd', 'giap_role:\n  instructions: "open\n', { description: 'From the row' })], null);
    expect(row).toMatchObject({ name: 'odd', title: 'odd', readable: false, purpose: 'From the row', prefill: null });
  });

  it('keeps the shipped agents apart, and offers no rebuild for one already on its way', () => {
    expect(builtInPrefills([prefill('planner', 'ready', 'default'), prefill('brief', 'ready')]).map((p) => p.agent)).toEqual(['planner']);
    expect(canRebuild(prefill('brief', 'queued'))).toBe(false);
    expect(canRebuild(prefill('brief', 'building'))).toBe(false);
    expect(canRebuild(prefill('brief', 'idle'))).toBe(true);
    expect(canRebuild(null)).toBe(false);
  });
});
