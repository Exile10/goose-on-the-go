// Read once and not polled, since a re-read landing under somebody's typing would replace their words.
// A save is checked first, so each problem shows under the field its path names.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  agentNameProblem,
  fieldOf,
  fieldSentence,
  isReadable,
  newAgentForm,
  readAgent,
  slugifyAgentName,
  writeAgent,
  MAX_AGENT_NAME,
  type AgentForm,
  type AgentReading,
  type FieldId,
  type NameProblem,
} from '@/models/agents';
import { useServer } from '@/providers/server-provider';
import { ApiError } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { AgentPrefill, AgentRecipe, RecipeFieldError } from '@/services/types';
import { isMissingRoute, useAgentsSource } from './agents-source';
import { describeApiError } from './describe-error';
import { PREFILLS_SCREEN_MS, usePrefills } from './use-agent-prefills';

export type EditorLoad = 'loading' | 'ready' | 'gone' | 'failed';

export interface UseAgentEditor {
  data: {
    /** Null for a new agent until it is saved. */
    agent: AgentRecipe | null;
    form: AgentForm;
    /** What the recipe says beyond the form: when it runs, its hooks, sharing. Null for a new agent. */
    reading: AgentReading | null;
    /** The recipe's YAML could not be read, so only delete and rebuild are offered; its line if known. */
    unreadable: { line: number | null } | null;
    /** The name it is saved under. Typed, or made from the title, for a new agent. */
    name: string;
    nameProblem: string | null;
    /** A new agent's name can be changed until it is saved; after that other agents use it. */
    nameLocked: boolean;
    /** Problems under the field they are about. */
    fieldErrors: Partial<Record<FieldId, string>>;
    /** Problems the form has no field for, with their paths. */
    otherErrors: RecipeFieldError[];
    dirty: boolean;
    prefill: AgentPrefill | null;
    retentionDays: number | null;
    prefillsReported: boolean;
  };
  load: EditorLoad;
  saving: boolean;
  deleting: boolean;
  rebuilding: boolean;
  /** Why the last save, delete or rebuild did not go through. */
  error: string | null;
  notice: string | null;
  actions: {
    retry: () => Promise<void>;
    setField: <K extends Exclude<keyof AgentForm, 'toolGroups'>>(key: K, value: AgentForm[K]) => void;
    toggleTool: (group: string) => void;
    setName: (name: string) => void;
    /** Resolves with the saved agent, or null when nothing was saved. */
    save: () => Promise<AgentRecipe | null>;
    /** Resolves to whether the agent is gone. */
    remove: () => Promise<boolean>;
    rebuild: () => Promise<boolean>;
  };
}

const EMPTY_FORM = JSON.stringify(newAgentForm());

function nameSentence(problem: NameProblem, name: string): string {
  switch (problem) {
    case 'empty':
      return i18n.t('agents.name.empty');
    case 'tooLong':
      return i18n.t('agents.name.tooLong', { max: MAX_AGENT_NAME });
    case 'shape':
      return i18n.t('agents.name.shape');
    case 'taken':
      return i18n.t('agents.name.taken', { name });
  }
}

function saveRefusal(e: unknown): string {
  if (e instanceof ApiError && e.status === 422) return i18n.t('agents.editor.widened');
  if (e instanceof ApiError && e.status === 404) return i18n.t('agents.editor.gone');
  return describeApiError(e) ?? i18n.t('agents.editor.saveFailed');
}

/** `name` is the agent to open, or null for a new one. */
export function useAgentEditor(name: string | null): UseAgentEditor {
  const { hydrated } = useServer();
  const source = useAgentsSource();

  const [recipes, setRecipes] = useState<AgentRecipe[] | null>(null);
  const [load, setLoad] = useState<EditorLoad>(name ? 'loading' : 'ready');
  const [agent, setAgent] = useState<AgentRecipe | null>(null);
  const [reading, setReading] = useState<AgentReading | null>(null);
  const [unreadable, setUnreadable] = useState<{ line: number | null } | null>(null);
  const [form, setForm] = useState<AgentForm>(newAgentForm);
  // The saved agent as the phone would write it back, so an untouched form is not a change.
  const [baseline, setBaseline] = useState('');
  const [tried, setTried] = useState(false);
  const [typedName, setTypedName] = useState<string | null>(null);
  const [errors, setErrors] = useState<RecipeFieldError[]>([]);
  const [localErrors, setLocalErrors] = useState<Partial<Record<FieldId, string>>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { prefills, unsupported, reload: reloadPrefills } = usePrefills(PREFILLS_SCREEN_MS, agent !== null);

  /** Shows a recipe as saved: the form, the words around it, and what counts as unchanged. */
  const adopt = useCallback((recipe: AgentRecipe) => {
    setAgent(recipe);
    const read = readAgent(recipe.yaml, recipe.description ?? '');
    if (isReadable(read)) {
      setReading(read);
      setUnreadable(null);
      setForm(read.form);
      setBaseline(writeAgent(read.doc, read.form));
    } else {
      setReading(null);
      setUnreadable(read);
    }
  }, []);

  const readList = useCallback(async (): Promise<AgentRecipe[] | null> => {
    try {
      const listed = await source.listRecipes();
      setRecipes(listed);
      return listed;
    } catch (e) {
      console.warn('[agents] recipe listing failed', { status: e instanceof ApiError ? e.status : 'network' });
      return null;
    }
  }, [source]);

  const opened = useRef(false);
  const open = useCallback(async () => {
    if (!name) {
      // A new agent needs the names already taken, and nothing else from the Pond.
      void readList();
      return;
    }
    setLoad('loading');
    const listed = await readList();
    if (!listed) {
      setLoad('failed');
      return;
    }
    const found = listed.find((r) => r.name === name);
    if (!found) {
      setLoad('gone');
      return;
    }
    adopt(found);
    setLoad('ready');
  }, [adopt, name, readList]);

  useEffect(() => {
    if (!hydrated || opened.current) return;
    opened.current = true;
    void open();
  }, [hydrated, open]);

  const nameLocked = agent !== null;
  const savedName = agent ? agent.name : (typedName ?? slugifyAgentName(form.title));
  const taken = useMemo(() => (recipes ?? []).filter((r) => r.id !== agent?.id).map((r) => r.name), [recipes, agent]);
  const problem = nameLocked ? null : agentNameProblem(savedName, taken);

  const dirty = useMemo(() => {
    if (reading) return writeAgent(reading.doc, form) !== baseline;
    return agent === null && (JSON.stringify(form) !== EMPTY_FORM || typedName !== null);
  }, [agent, baseline, form, reading, typedName]);

  const { fieldErrors, otherErrors } = useMemo(() => {
    const fields: Partial<Record<FieldId, string>> = { ...localErrors };
    const others: RecipeFieldError[] = [];
    for (const e of errors) {
      const field = fieldOf(e.path);
      if (field === null) others.push({ path: e.path, message: fieldSentence(e.message) });
      else fields[field] = fields[field] ? `${fields[field]} ${fieldSentence(e.message)}` : fieldSentence(e.message);
    }
    return { fieldErrors: fields, otherErrors: others };
  }, [errors, localErrors]);

  const edited = useCallback((field: FieldId | null) => {
    setError(null);
    setNotice(null);
    if (field === null) return;
    setLocalErrors((all) => {
      if (!(field in all)) return all;
      const { [field]: _gone, ...rest } = all;
      return rest;
    });
    setErrors((all) => all.filter((e) => fieldOf(e.path) !== field));
  }, []);

  const setField = useCallback(
    <K extends Exclude<keyof AgentForm, 'toolGroups'>>(key: K, value: AgentForm[K]) => {
      setForm((f) => ({ ...f, [key]: value }));
      edited(key);
    },
    [edited],
  );

  const toggleTool = useCallback(
    (group: string) => {
      setForm((f) => ({
        ...f,
        toolGroups: f.toolGroups.includes(group) ? f.toolGroups.filter((g) => g !== group) : [...f.toolGroups, group],
      }));
      edited('toolGroups');
    },
    [edited],
  );

  const setName = useCallback(
    (text: string) => {
      setTypedName(text.trim().toLowerCase());
      edited(null);
    },
    [edited],
  );

  const busy = saving || deleting;

  const save = useCallback(async (): Promise<AgentRecipe | null> => {
    if (busy || unreadable) return null;
    setTried(true);
    setError(null);
    setNotice(null);
    // Saving a new agent over a name already taken would replace that recipe, so the names have to be known.
    const known = nameLocked ? recipes : (recipes ?? (await readList()));
    if (!nameLocked && known === null) {
      setError(i18n.t('agents.editor.namesUnknown'));
      return null;
    }
    const takenNow = (known ?? []).filter((r) => r.id !== agent?.id).map((r) => r.name);
    const local: Partial<Record<FieldId, string>> = {};
    if (form.instructions.trim() === '') local.instructions = i18n.t('agents.editor.instructionsRequired');
    const nameIssue = nameLocked ? null : agentNameProblem(savedName, takenNow);
    setLocalErrors(local);
    if (nameIssue || Object.keys(local).length > 0) return null;

    const yaml = writeAgent(reading?.doc ?? null, form);
    setSaving(true);
    try {
      try {
        const check = await source.validateRecipe(yaml, savedName);
        setErrors(check.errors ?? []);
        if (!check.ok) return null;
      } catch (e) {
        if (!isMissingRoute(e)) {
          setError(describeApiError(e) ?? i18n.t('agents.editor.checkFailed'));
          return null;
        }
        setErrors([]);
      }
      const description = form.description.trim();
      const saved = agent
        ? await source.updateRecipe(agent.id, { description, yaml })
        : await source.createRecipe({ name: savedName, description, yaml });
      const wasNew = agent === null;
      adopt(saved);
      setTypedName(null);
      setRecipes((all) => [...(all ?? []).filter((r) => r.id !== saved.id && r.name !== saved.name), saved]);
      const title = form.title.trim() || saved.name;
      setNotice(wasNew ? i18n.t('agents.editor.added', { title }) : i18n.t('agents.editor.saved'));
      void reloadPrefills();
      return saved;
    } catch (e) {
      console.warn('[agents] save failed', { status: e instanceof ApiError ? e.status : 'network' });
      setError(saveRefusal(e));
      return null;
    } finally {
      setSaving(false);
    }
  }, [adopt, agent, busy, form, nameLocked, readList, reading, recipes, reloadPrefills, savedName, source, unreadable]);

  const remove = useCallback(async () => {
    if (!agent || busy) return false;
    setDeleting(true);
    setError(null);
    setNotice(null);
    try {
      await source.deleteRecipe(agent.id);
      return true;
    } catch (e) {
      // Already gone is what was asked for.
      if (e instanceof ApiError && e.status === 404) return true;
      setError(describeApiError(e) ?? i18n.t('agents.editor.deleteFailed'));
      return false;
    } finally {
      setDeleting(false);
    }
  }, [agent, busy, source]);

  const rebuild = useCallback(async () => {
    if (!agent || rebuilding) return false;
    setRebuilding(true);
    setError(null);
    setNotice(null);
    try {
      await source.rebuild(agent.name);
      setNotice(i18n.t('agents.prefill.rebuildQueued', { title: form.title.trim() || agent.name }));
      await reloadPrefills();
      return true;
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? i18n.t('agents.prefill.gone') : (describeApiError(e) ?? i18n.t('agents.prefill.rebuildFailed')));
      return false;
    } finally {
      setRebuilding(false);
    }
  }, [agent, form.title, rebuilding, reloadPrefills, source]);

  const prefill = agent ? (prefills?.agents.find((p) => p.agent === agent.name) ?? null) : null;

  return {
    data: {
      agent,
      form,
      reading,
      unreadable,
      name: savedName,
      nameProblem: problem && (tried || typedName !== null || form.title.trim() !== '') ? nameSentence(problem, savedName) : null,
      nameLocked,
      fieldErrors,
      otherErrors,
      dirty,
      prefill,
      retentionDays: prefills?.retention_days ?? null,
      prefillsReported: !unsupported,
    },
    load,
    saving,
    deleting,
    rebuilding,
    error,
    notice,
    actions: { retry: open, setField, toggleTool, setName, save, remove, rebuild },
  };
}
