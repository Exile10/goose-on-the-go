/**
 * The Voice agent: the shipped agent that answers every spoken turn, from the Pond's microphone and
 * from this phone. A household changes how it speaks (instructions and examples), narrows what it may
 * use (tool groups, never widened), and how many steps it takes, and can go back to the shipped one.
 *
 * Edits are held on the phone until saved. The agent is read again every 15 seconds while its page is
 * in front, 5 while its start-up copy is being built, and a read never overwrites an edit in progress.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { RecipeFieldError, VoiceAgent, VoiceAgentExample } from '@/services/types';
import { draftOf, patchFrom, voiceAgentField, type VoiceAgentDraft } from '@/models/voice-room';
import { isMissingRoute, useAgentsSource } from './agents-source';
import { describeApiError, logFailure } from './describe-error';
import { MIN_POLL_MS, useLive } from './use-live';
import { useVoiceSource } from './voice-source';

export const VOICE_AGENT_MS = 15_000;

export type VoiceAgentField = 'instructions' | 'examples' | 'tools' | 'maxTurns';

export interface UseVoiceAgent {
  agent: VoiceAgent | null;
  draft: VoiceAgentDraft | null;
  /** The form differs from what the Pond holds. */
  changed: boolean;
  fieldErrors: Partial<Record<VoiceAgentField, string>>;
  /** Refusals whose path names no field on the form. */
  otherErrors: RecipeFieldError[];
  loading: boolean;
  failed: boolean;
  /** The Pond has no Voice agent route: it needs an update. */
  missing: boolean;
  error: string | null;
  notice: string | null;
  saving: boolean;
  resetting: boolean;
  rebuilding: boolean;
  actions: {
    refresh: () => Promise<void>;
    setInstructions: (text: string) => void;
    setExample: (index: number, example: VoiceAgentExample) => void;
    addExample: () => void;
    removeExample: (index: number) => void;
    setGroup: (group: string, on: boolean) => void;
    setMaxTurns: (turns: number) => void;
    /** Drops the unsaved edits: the form shows what the Pond holds again. */
    revert: () => void;
    save: () => Promise<boolean>;
    reset: () => Promise<boolean>;
    rebuild: () => Promise<boolean>;
  };
}

/** Why a save was refused, when the refusal is not a list of fields. */
export function describeVoiceAgentError(e: unknown): string {
  if (e instanceof ApiError && e.status === 403) return i18n.t('voiceAgent.error.guest');
  return describeApiError(e) ?? i18n.t('voiceAgent.error.saveFailed');
}

function fieldErrorsOf(e: unknown): RecipeFieldError[] | null {
  if (!(e instanceof ApiError) || e.status !== 422) return null;
  const errors = (e.body as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) return null;
  return errors.flatMap((x) => {
    const r = x as { path?: unknown; message?: unknown } | null;
    return r && typeof r.message === 'string' ? [{ path: typeof r.path === 'string' ? r.path : '', message: r.message }] : [];
  });
}

export function useVoiceAgent(): UseVoiceAgent {
  const { hydrated } = useServer();
  const source = useVoiceSource();
  const agents = useAgentsSource();
  const [agent, setAgent] = useState<VoiceAgent | null>(null);
  const [draft, setDraft] = useState<VoiceAgentDraft | null>(null);
  const [errors, setErrors] = useState<RecipeFieldError[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const latest = useRef<VoiceAgent | null>(null);
  const editing = useRef(false);

  // The Developer toggle swapping the source: nothing read from the old one describes the new one.
  const [from, setFrom] = useState(source);
  if (from !== source) {
    setFrom(source);
    setAgent(null);
    setDraft(null);
    setMissing(false);
    setFailed(false);
  }

  const take = useCallback((next: VoiceAgent, replaceDraft: boolean) => {
    latest.current = next;
    setAgent(next);
    if (replaceDraft) editing.current = false;
    // An empty form, after the Developer toggle swapped the source, takes what was read whatever came before.
    const keep = editing.current;
    setDraft((d) => (keep && d !== null ? d : draftOf(next)));
  }, []);

  const load = useCallback(
    async (loud: boolean) => {
      if (loud) {
        setLoading(true);
        setError(null);
      }
      try {
        take(await source.agent(), false);
        setMissing(false);
        setFailed(false);
        if (loud) setError(null);
      } catch (e) {
        if (isMissingRoute(e)) {
          setMissing(true);
        } else {
          logFailure('voice-agent', 'read failed', e);
          if (loud || latest.current === null) setError(describeApiError(e) ?? i18n.t('voiceAgent.error.loadFailed'));
          if (latest.current === null) setFailed(true);
        }
      } finally {
        setLoading(false);
      }
    },
    [source, take],
  );

  const refresh = useCallback(() => load(true), [load]);

  const delay = useCallback(() => {
    const status = latest.current?.prefill.status;
    return status === 'building' || status === 'queued' ? MIN_POLL_MS : VOICE_AGENT_MS;
  }, []);
  useLive(() => load(false), delay, hydrated && !missing);

  const edit = useCallback((change: (d: VoiceAgentDraft) => VoiceAgentDraft) => {
    editing.current = true;
    setNotice(null);
    setDraft((d) => (d ? change(d) : d));
  }, []);

  const changed = useMemo(() => (agent && draft ? patchFrom(agent, draft) !== null : false), [agent, draft]);

  const { fieldErrors, otherErrors } = useMemo(() => {
    const fields: Partial<Record<VoiceAgentField, string>> = {};
    const others: RecipeFieldError[] = [];
    for (const e of errors) {
      const field = voiceAgentField(e.path);
      if (field && !fields[field]) fields[field] = e.message;
      else if (!field) others.push(e);
    }
    return { fieldErrors: fields, otherErrors: others };
  }, [errors]);

  const save = useCallback(async () => {
    const current = latest.current;
    if (!current || !draft) return false;
    const patch = patchFrom(current, draft);
    if (!patch) return true;
    setSaving(true);
    setErrors([]);
    setError(null);
    setNotice(null);
    try {
      take(await source.updateAgent(patch), true);
      setNotice(i18n.t('voiceAgent.saved'));
      return true;
    } catch (e) {
      const refused = fieldErrorsOf(e);
      if (refused && refused.length > 0) setErrors(refused);
      else {
        logFailure('voice-agent', 'save refused', e);
        setError(describeVoiceAgentError(e));
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, source, take]);

  const reset = useCallback(async () => {
    setResetting(true);
    setErrors([]);
    setError(null);
    setNotice(null);
    try {
      take(await source.resetAgent(), true);
      setNotice(i18n.t('voiceAgent.resetDone'));
      return true;
    } catch (e) {
      logFailure('voice-agent', 'reset refused', e);
      setError(describeVoiceAgentError(e));
      return false;
    } finally {
      setResetting(false);
    }
  }, [source, take]);

  const rebuild = useCallback(async () => {
    setRebuilding(true);
    setError(null);
    try {
      await agents.rebuild('voice');
      setNotice(i18n.t('voiceAgent.prefill.rebuildAsked'));
      await load(false);
      return true;
    } catch (e) {
      logFailure('voice-agent', 'rebuild refused', e);
      setError(describeApiError(e) ?? i18n.t('agents.prefill.rebuildFailed'));
      return false;
    } finally {
      setRebuilding(false);
    }
  }, [agents, load]);

  const revert = useCallback(() => {
    const current = latest.current;
    if (!current) return;
    editing.current = false;
    setErrors([]);
    setDraft(draftOf(current));
  }, []);

  return {
    agent,
    draft,
    changed,
    fieldErrors,
    otherErrors,
    loading,
    failed,
    missing,
    error,
    notice,
    saving,
    resetting,
    rebuilding,
    actions: {
      refresh,
      setInstructions: (text) => edit((d) => ({ ...d, instructions: text })),
      setExample: (index, example) => edit((d) => ({ ...d, examples: d.examples.map((e, i) => (i === index ? example : e)) })),
      addExample: () => edit((d) => ({ ...d, examples: [...d.examples, { brief: '', answer: '' }] })),
      removeExample: (index) => edit((d) => ({ ...d, examples: d.examples.filter((_, i) => i !== index) })),
      setGroup: (group, on) =>
        edit((d) => ({ ...d, off: on ? d.off.filter((g) => g !== group) : d.off.includes(group) ? d.off : [...d.off, group] })),
      setMaxTurns: (turns) => edit((d) => ({ ...d, maxTurns: turns })),
      revert,
      save,
      reset,
      rebuild,
    },
  };
}
