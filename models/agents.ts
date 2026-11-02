// An agent is a recipe with a `giap_role` block (PAI-6 section 9). The phone edits only what a person
// writes, and keeps the rest of the parsed document so a save never drops what the dashboard set.

import type { TranslationKey } from '@/services/i18n';
import type { AgentPrefill, AgentPrefills, AgentRecipe, PrefillBuilding, PrefillKind, PrefillStatus } from '@/services/types';

import { emitYaml, isYamlMap, parseYaml, YamlError, type YamlMap, type YamlValue } from './agent-yaml';

export const ROLE_KEY = 'giap_role';

/** A giap_role key at the start of a line: cheap, and the same test the desktop uses. */
export function isAgentYaml(yaml: string): boolean {
  return /^giap_role\s*:/m.test(yaml);
}

export type PersonalData = 'inherit' | 'deny';

/** The fields the phone's form edits. */
export interface AgentForm {
  title: string;
  description: string;
  instructions: string;
  toolGroups: string[];
  /** A value other than the two the form offers is kept as written. */
  personalData: string;
  /** Empty leaves the Pond's own default. */
  maxTurns: string;
}

export function newAgentForm(): AgentForm {
  return { title: '', description: '', instructions: '', toolGroups: [], personalData: 'inherit', maxTurns: '' };
}

export type Activation =
  | { kind: 'delegated' }
  | { kind: 'task_step' }
  | { kind: 'schedule'; cron: string }
  | { kind: 'event'; on: string; member: string; camera: string; device: string; above: string; below: string; at: string }
  | { kind: 'agent'; from: string[] }
  /** Something the phone has no words for; kept untouched in the document. */
  | { kind: 'other' };

export interface AfterHook {
  hook: string;
  /** Only for `hand_to`: the agent that runs next. */
  agent: string;
}

export const HAND_TO = 'hand_to';

/** What a recipe's YAML says, read once for the form and for the words that describe it. */
export interface AgentReading {
  form: AgentForm;
  /** The whole document, so a save writes back what the form does not show. */
  doc: YamlMap;
  activations: Activation[];
  before: string[];
  after: AfterHook[];
  /** `a2a.expose`: offered to paired devices and mesh peers. */
  shared: boolean;
}

/** Why a recipe could not be read; the screen then offers what needs no reading (status, delete). */
export interface Unreadable {
  line: number | null;
}

export const DEFAULT_ACTIVATIONS: readonly Activation[] = [{ kind: 'delegated' }, { kind: 'task_step' }];

function text(value: YamlValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new Unread();
}

function textList(value: YamlValue | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Unread();
  return value.map((item) => text(item));
}

class Unread extends Error {}

function readActivation(item: YamlValue): Activation {
  if (item === 'delegated') return { kind: 'delegated' };
  if (item === 'task_step') return { kind: 'task_step' };
  if (isYamlMap(item) && Object.keys(item).length === 1) {
    const [key] = Object.keys(item);
    const value = item[key];
    if (key === 'schedule' && isYamlMap(value) && typeof value.cron === 'string') {
      return { kind: 'schedule', cron: value.cron };
    }
    if (key === 'event' && isYamlMap(value) && typeof value.on === 'string') {
      const field = (name: string) => {
        const v = value[name];
        return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
      };
      return {
        kind: 'event',
        on: value.on,
        member: field('member'),
        camera: field('camera'),
        device: field('device'),
        above: field('above'),
        below: field('below'),
        at: field('at'),
      };
    }
    if (key === 'agent') {
      if (typeof value === 'string') return { kind: 'agent', from: [value] };
      if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return { kind: 'agent', from: value as string[] };
    }
  }
  return { kind: 'other' };
}

function readAfter(item: YamlValue): AfterHook {
  if (typeof item === 'string') return { hook: item, agent: '' };
  if (isYamlMap(item) && Object.keys(item).length === 1) {
    const [hook] = Object.keys(item);
    const agent = item[hook];
    return { hook, agent: typeof agent === 'string' ? agent : '' };
  }
  return { hook: '', agent: '' };
}

/** The form a recipe's YAML fills, or why it cannot. `fallbackDescription` is the recipe row's own. */
export function readAgent(yaml: string, fallbackDescription = ''): AgentReading | Unreadable {
  let parsed: YamlValue;
  try {
    parsed = parseYaml(yaml);
  } catch (e) {
    if (e instanceof YamlError) return { line: e.line };
    throw e;
  }
  const doc = parsed ?? {};
  if (!isYamlMap(doc)) return { line: null };
  const role = doc[ROLE_KEY] ?? {};
  if (!isYamlMap(role)) return { line: null };
  try {
    const activations = Array.isArray(role.activations) ? role.activations.map(readActivation) : [...DEFAULT_ACTIVATIONS];
    const hooks = isYamlMap(role.hooks) ? role.hooks : {};
    const after = Array.isArray(hooks.after) ? hooks.after.map(readAfter) : [];
    return {
      form: {
        title: text(doc.title),
        description: text(doc.description) || fallbackDescription,
        instructions: text(role.instructions).replace(/\s+$/, ''),
        toolGroups: textList(role.tool_groups),
        personalData: text(role.personal_data) || 'inherit',
        maxTurns: text(role.max_turns),
      },
      doc,
      activations,
      before: textList(hooks.before),
      after,
      shared: isYamlMap(role.a2a) && role.a2a.expose === true,
    };
  } catch (e) {
    if (e instanceof Unread) return { line: null };
    throw e;
  }
}

export function isReadable(reading: AgentReading | Unreadable): reading is AgentReading {
  return 'form' in reading;
}

/** A new agent's document, in the order the desktop writes one, so the two read alike. */
function skeleton(): YamlMap {
  return {
    title: '',
    description: '',
    [ROLE_KEY]: {
      tool_groups: [],
      personal_data: 'inherit',
      instructions: '',
      activations: ['delegated', 'task_step'],
      a2a: { expose: false },
    },
  };
}

function clone(value: YamlValue): YamlValue {
  if (Array.isArray(value)) return value.map(clone);
  if (isYamlMap(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
}

/** Sets `key`, or drops it when `value` is undefined, keeping its place when it was already there. */
function put(map: YamlMap, key: string, value: YamlValue | undefined): void {
  if (value === undefined) delete map[key];
  else map[key] = value;
}

/** The YAML to save: `doc` (null for a new agent) with the form's fields written into it. */
export function writeAgent(doc: YamlMap | null, form: AgentForm): string {
  const next = clone(doc ?? skeleton()) as YamlMap;
  const role: YamlMap = isYamlMap(next[ROLE_KEY]) ? (next[ROLE_KEY] as YamlMap) : {};
  next[ROLE_KEY] = role;

  const turns = form.maxTurns.trim();
  const instructions = form.instructions.replace(/\s+$/, '');
  put(next, 'title', form.title.trim() || undefined);
  put(next, 'description', form.description.trim() || undefined);
  put(role, 'tool_groups', [...form.toolGroups]);
  put(role, 'personal_data', form.personalData);
  put(role, 'max_turns', turns === '' ? undefined : /^\d+$/.test(turns) ? Number(turns) : turns);
  put(role, 'instructions', instructions === '' ? undefined : `${instructions}\n`);
  return emitYaml(next, { block: ['instructions'] });
}

/** Activations that start the agent with nobody asking: the ones a household should be told about. */
export function startsByItself(activations: readonly Activation[]): boolean {
  return activations.some((a) => a.kind === 'schedule' || a.kind === 'event');
}

/** The card's line under the title: what it is for, in the author's words. The desktop's rule. */
export function purposeLine(form: Pick<AgentForm, 'description' | 'instructions'>, recipeDescription?: string): string {
  const described = (recipeDescription ?? '').trim() || form.description.trim();
  if (described !== '') return described;
  const first = form.instructions.split('\n').find((l) => l.trim() !== '');
  return first ? first.trim() : '';
}

export const MAX_AGENT_NAME = 64;

export function slugifyAgentName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type NameProblem = 'empty' | 'tooLong' | 'shape' | 'taken';

/** Saving over an existing name replaces that recipe, so a clash is refused before the request. */
/**
 * Names a shipped agent keeps: the Pond stores a household's edit of the Voice agent as a recipe
 * under its name, so it is listed with the built-ins and no new agent may take it.
 */
export const SHIPPED_AGENT_NAMES: readonly string[] = ['voice'];

export function agentNameProblem(name: string, taken: readonly string[]): NameProblem | null {
  if (name === '') return 'empty';
  if (name.length > MAX_AGENT_NAME) return 'tooLong';
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) return 'shape';
  if (taken.includes(name) || SHIPPED_AGENT_NAMES.includes(name)) return 'taken';
  return null;
}

/** The desktop's choices when the Pond lists no extensions; the validator, not this, is the authority. */
export const AGENT_TOOL_GROUPS: readonly { name: string; labelKey: TranslationKey }[] = [
  { name: 'giap-memory', labelKey: 'agents.tools.memory' },
  { name: 'giap-weather', labelKey: 'agents.tools.weather' },
  { name: 'giap-knowledge', labelKey: 'agents.tools.knowledge' },
  { name: 'giap-device', labelKey: 'agents.tools.device' },
  { name: 'giap-sensors', labelKey: 'agents.tools.sensors' },
  { name: 'giap-context', labelKey: 'agents.tools.context' },
  { name: 'giap-task-work', labelKey: 'agents.tools.taskWork' },
];

/** The friendly name of a tool group, when the phone has one. */
export function toolGroupLabelKey(name: string): TranslationKey | null {
  return AGENT_TOOL_GROUPS.find((g) => g.name === name)?.labelKey ?? null;
}

/** Paths the form draws a field for; an error at any other path is listed with the path itself. */
export type FieldId = 'title' | 'description' | 'instructions' | 'toolGroups' | 'personalData' | 'maxTurns';

export function fieldOf(path: string): FieldId | null {
  if (path === 'title') return 'title';
  if (path === 'description') return 'description';
  if (path === `${ROLE_KEY}.instructions`) return 'instructions';
  if (/^giap_role\.tool_groups(\[\d+\])?$/.test(path)) return 'toolGroups';
  if (path === `${ROLE_KEY}.personal_data`) return 'personalData';
  if (path === `${ROLE_KEY}.max_turns`) return 'maxTurns';
  return null;
}

/** The Pond words a message to follow its field's name, so one shown alone gets a subject back. */
export function fieldSentence(message: string): string {
  const m = message.trim();
  if (m === '') return m;
  const said = /^(is|must|has|needs|names|applies|takes|cannot|should)\b/.test(m) ? `This ${m}` : m[0].toUpperCase() + m.slice(1);
  return /[.?!]$/.test(said) ? said : `${said}.`;
}

const STATUSES: readonly PrefillStatus[] = ['ready', 'building', 'queued', 'idle', 'not_built', 'failed'];

function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/** Null for a body that is not the listing: an empty one would say every agent's prefill had gone. */
export function readPrefills(raw: unknown): AgentPrefills | null {
  const body = raw as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || !Array.isArray(body.agents)) return null;
  const b = (body.building ?? {}) as Record<string, unknown>;
  const building: PrefillBuilding = {
    active: b.active === true,
    current: typeof b.current === 'string' && b.current !== '' ? b.current : null,
    done: count(b.done),
    total: count(b.total),
  };
  const agents: AgentPrefill[] = [];
  for (const item of body.agents) {
    const a = item as Record<string, unknown> | null;
    if (!a || typeof a.agent !== 'string' || a.agent === '') continue;
    const status = STATUSES.includes(a.status as PrefillStatus) ? (a.status as PrefillStatus) : 'not_built';
    const kind: PrefillKind = a.kind === 'default' ? 'default' : 'member';
    agents.push({ agent: a.agent, kind, status, compiled_at: isoOrNull(a.compiled_at), last_used_at: isoOrNull(a.last_used_at) });
  }
  const days = typeof body.retention_days === 'number' && body.retention_days > 0 ? body.retention_days : DEFAULT_RETENTION_DAYS;
  return { building, retention_days: days, agents };
}

/** `agent_prefill_retention_days`' default, for a listing that leaves it out. */
export const DEFAULT_RETENTION_DAYS = 14;

/** One of the household's agents, as the list draws it. */
export interface AgentRow {
  id: string;
  name: string;
  title: string;
  purpose: string;
  /** `active: false` on the recipe. */
  paused: boolean;
  startsByItself: boolean;
  /** Whether the phone could read its YAML; one it cannot is still listed, deleted and rebuilt. */
  readable: boolean;
  /** Null when the Pond has not listed one, or does not report prefills at all. */
  prefill: AgentPrefill | null;
}

/** The household's agents, from every recipe, with each one's prefill joined on by name. */
export function agentRows(recipes: readonly AgentRecipe[], prefills: readonly AgentPrefill[] | null): AgentRow[] {
  const byName = new Map((prefills ?? []).map((p) => [p.agent, p]));
  return recipes
    .filter((r) => isAgentYaml(r.yaml) && !SHIPPED_AGENT_NAMES.includes(r.name))
    .map((r) => {
      const reading = readAgent(r.yaml, r.description ?? '');
      const readable = isReadable(reading);
      const title = (readable ? reading.form.title.trim() : '') || r.title?.trim() || r.name;
      return {
        id: r.id,
        name: r.name,
        title,
        purpose: readable ? purposeLine(reading.form, r.description) : (r.description ?? '').trim(),
        paused: r.active === false,
        startsByItself: readable && startsByItself(reading.activations),
        readable,
        prefill: byName.get(r.name) ?? null,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** The shipped planner, worker and verifier: compiled on every start, never edited from here. */
export function builtInPrefills(prefills: readonly AgentPrefill[] | null): AgentPrefill[] {
  return (prefills ?? []).filter((p) => p.kind === 'default');
}

/** Whether a rebuild of this agent is worth offering: one already queued or compiling is on its way. */
export function canRebuild(prefill: AgentPrefill | null): boolean {
  return prefill !== null && prefill.status !== 'queued' && prefill.status !== 'building';
}
