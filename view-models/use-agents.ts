// Recipes, prefills and suggestions are read apart and fail apart: a Pond without the prefill routes
// still lists its agents, and one without suggestions offers none, quietly, as the dashboard does.

import { useCallback, useMemo, useRef, useState } from 'react';

import { agentRows, builtInPrefills, DEFAULT_RETENTION_DAYS, type AgentRow } from '@/models/agents';
import { useServer } from '@/providers/server-provider';
import { ApiError } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { AgentPrefill, AgentRecipe, AgentSuggestion, PrefillBuilding } from '@/services/types';
import { builtInName } from './agent-words';
import { isMissingRoute, useAgentsSource } from './agents-source';
import { describeApiError } from './describe-error';
import { PREFILLS_SCREEN_MS, usePrefills } from './use-agent-prefills';
import { useLive } from './use-live';

/** Recipes change when somebody edits one, here or on the dashboard; a minute is plenty. */
export const AGENTS_MS = 60_000;

export interface UseAgents {
  data: {
    agents: AgentRow[];
    /** The shipped planner, worker and verifier, which have a prefill and no recipe. */
    builtIn: AgentPrefill[];
    suggestions: AgentSuggestion[];
    /** The compile pass running now, or null. */
    building: PrefillBuilding | null;
    /** The agent being compiled now, in words, or null before the pass has started one. */
    buildingName: string | null;
    retentionDays: number;
    /** False when the Pond has no prefill routes, so no status and no rebuild can be shown. */
    prefillsReported: boolean;
  };
  /** The first read is out and nothing is known yet. */
  loading: boolean;
  refreshing: boolean;
  /** The first read failed and nothing has loaded, so an empty list says nothing about the Pond. */
  failed: boolean;
  /** A read, a rebuild or a suggestion failed, in words. */
  error: string | null;
  /** What the last action did, until the next one. */
  notice: string | null;
  /** The agent a rebuild is out for, `'*'` for all of them, or null. */
  rebuilding: string | null;
  /** The template being turned on, or null. */
  enabling: string | null;
  /** A failure that belongs to one suggestion's card, by template. */
  suggestionErrors: Record<string, string>;
  actions: {
    refresh: () => Promise<void>;
    /** Resolves to whether the Pond took the request. */
    rebuild: (name: string) => Promise<boolean>;
    rebuildAll: () => Promise<boolean>;
    /** Resolves with the new agent, or null when nothing was turned on. */
    enableSuggestion: (template: string) => Promise<AgentRecipe | null>;
    dismissSuggestion: (template: string) => Promise<void>;
  };
}

function rebuildRefusal(e: unknown): string {
  if (e instanceof ApiError && e.status === 404) return i18n.t('agents.prefill.gone');
  return describeApiError(e) ?? i18n.t('agents.prefill.rebuildFailed');
}

function enableRefusal(e: unknown): string {
  if (e instanceof ApiError && e.status === 422) return i18n.t('agents.suggested.cannotRun');
  if (e instanceof ApiError && e.status === 403) return i18n.t('agents.suggested.notMember');
  return describeApiError(e) ?? i18n.t('agents.suggested.enableFailed');
}

export function useAgents(): UseAgents {
  const { hydrated } = useServer();
  const source = useAgentsSource();
  const { prefills: listing, unsupported, reload: reloadPrefills } = usePrefills(PREFILLS_SCREEN_MS);

  const [recipes, setRecipes] = useState<AgentRecipe[] | null>(null);
  const [suggestions, setSuggestions] = useState<AgentSuggestion[]>([]);
  const [reading, setReading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState<string | null>(null);
  const [enabling, setEnabling] = useState<string | null>(null);
  const [suggestionErrors, setSuggestionErrors] = useState<Record<string, string>>({});
  const loaded = useRef(false);

  const [from, setFrom] = useState(source);
  if (from !== source) {
    setFrom(source);
    setRecipes(null);
    setSuggestions([]);
    setFailed(false);
    setError(null);
    loaded.current = false;
  }

  const load = useCallback(
    async (loud: boolean) => {
      if (loud) {
        setReading(true);
        setError(null);
      }
      const [listed, offered] = await Promise.allSettled([source.listRecipes(), source.listSuggestions()]);
      if (listed.status === 'fulfilled') {
        setRecipes(listed.value);
        loaded.current = true;
        setFailed(false);
        setError(null);
      } else {
        console.warn('[agents] recipe listing failed', { loud });
        if (loud || !loaded.current) setError(describeApiError(listed.reason));
        if (!loaded.current) setFailed(true);
      }
      // Suggestions are an offer, not the screen's subject: a Pond without them shows none.
      if (offered.status === 'fulfilled') setSuggestions(offered.value);
      else if (!isMissingRoute(offered.reason)) console.warn('[agents] suggestions failed');
      setReading(false);
    },
    [source],
  );

  useLive(() => load(false), AGENTS_MS, hydrated);

  const refresh = useCallback(async () => {
    await Promise.all([load(true), reloadPrefills()]);
  }, [load, reloadPrefills]);

  const rows = useMemo(() => agentRows(recipes ?? [], listing?.agents ?? null), [recipes, listing]);
  const building = listing?.building.active ? listing.building : null;
  const current = building?.current ?? null;
  const buildingName = current === null ? null : (rows.find((r) => r.name === current)?.title ?? builtInName(current));

  const rebuild = useCallback(
    async (name: string) => {
      if (rebuilding) return false;
      setRebuilding(name);
      setError(null);
      setNotice(null);
      try {
        await source.rebuild(name);
        const title = rows.find((r) => r.name === name)?.title ?? builtInName(name);
        setNotice(i18n.t('agents.prefill.rebuildQueued', { title }));
        await reloadPrefills();
        return true;
      } catch (e) {
        setError(rebuildRefusal(e));
        return false;
      } finally {
        setRebuilding(null);
      }
    },
    [rebuilding, reloadPrefills, rows, source],
  );

  const rebuildAll = useCallback(async () => {
    if (rebuilding) return false;
    setRebuilding('*');
    setError(null);
    setNotice(null);
    try {
      await source.rebuildAll();
      setNotice(i18n.t('agents.prefill.rebuildAllQueued'));
      await reloadPrefills();
      return true;
    } catch (e) {
      setError(rebuildRefusal(e));
      return false;
    } finally {
      setRebuilding(null);
    }
  }, [rebuilding, reloadPrefills, source]);

  const clearSuggestionError = (template: string) =>
    setSuggestionErrors((all) => {
      if (!(template in all)) return all;
      const { [template]: _gone, ...rest } = all;
      return rest;
    });

  const enableSuggestion = useCallback(
    async (template: string) => {
      if (enabling) return null;
      const title = suggestions.find((s) => s.template === template)?.title ?? '';
      setEnabling(template);
      setNotice(null);
      clearSuggestionError(template);
      try {
        const recipe = await source.enableSuggestion(template);
        setSuggestions((all) => all.filter((s) => s.template !== template));
        setRecipes((all) => [...(all ?? []).filter((r) => r.name !== recipe.name), recipe]);
        setNotice(i18n.t('agents.suggested.on', { title }));
        await reloadPrefills();
        return recipe;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          setSuggestions((all) => all.filter((s) => s.template !== template));
          setNotice(i18n.t('agents.suggested.alreadyOn', { title }));
          void load(false);
        } else {
          setSuggestionErrors((all) => ({ ...all, [template]: enableRefusal(e) }));
        }
        return null;
      } finally {
        setEnabling(null);
      }
    },
    [enabling, load, reloadPrefills, source, suggestions],
  );

  const dismissSuggestion = useCallback(
    async (template: string) => {
      const at = suggestions.findIndex((s) => s.template === template);
      if (at < 0) return;
      const gone = suggestions[at];
      setNotice(null);
      clearSuggestionError(template);
      // Gone at once: a card that lingers after the tap reads as if the tap did not land.
      setSuggestions((all) => all.filter((s) => s.template !== template));
      try {
        await source.dismissSuggestion(template);
      } catch (e) {
        setSuggestions((all) => {
          const back = all.filter((s) => s.template !== template);
          back.splice(Math.min(at, back.length), 0, gone);
          return back;
        });
        setSuggestionErrors((all) => ({ ...all, [template]: describeApiError(e) ?? i18n.t('agents.suggested.dismissFailed') }));
      }
    },
    [source, suggestions],
  );

  return {
    data: {
      agents: rows,
      builtIn: builtInPrefills(listing?.agents ?? null),
      suggestions,
      building,
      buildingName,
      retentionDays: listing?.retention_days ?? DEFAULT_RETENTION_DAYS,
      prefillsReported: !unsupported,
    },
    loading: reading && recipes === null,
    refreshing: reading && recipes !== null,
    failed,
    error,
    notice,
    rebuilding,
    enabling,
    suggestionErrors,
    actions: { refresh, rebuild, rebuildAll, enableSuggestion, dismissSuggestion },
  };
}
