/**
 * Web search -- the Pond's Brave Search key, set, checked and removed from the phone.
 *
 * The household brings its own key. The Pond holds it, uses it for `search_web`, and never sends
 * it back, so this screen has a status to show and a field to write and nothing to read. The key
 * exists on the phone only as what has been typed, and only until the Pond has it.
 *
 * The status is the Pond's to report. `rejected` and `quota` are learned when Brave refuses a
 * search made in a conversation, so they can turn up on a key that was fine when it was saved,
 * and a screen left open should say so: hence the poll. The Nearby places switch lives here too:
 * the Pond reports it beside the status, and it decides whether a search sends the town. Behind
 * the Developer toggle for `webSearch`: on mock, the same screen runs against an in-memory Pond
 * (see `createMockWebSearch`).
 */

import * as WebBrowser from 'expo-web-browser';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BRAVE_DASHBOARD_URL } from '@/models/web-search';
import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import type {
  PondSettings,
  WebSearchKeyResult,
  WebSearchLocalResults,
  WebSearchState,
  WebSearchStatus,
} from '@/services/types';
import { describeApiError } from './describe-error';
import { useLive } from './use-live';

/**
 * How often the status is re-read while the screen is in front.
 *
 * It changes when something happens in a conversation, or on the desktop, not on a clock, so a
 * minute is plenty and costs the Pond's per-IP budget next to nothing.
 */
export const WEB_SEARCH_MS = 60_000;

/** The routes, so the real Pond and the mock are driven by exactly the same code. */
export interface WebSearchSource {
  read: () => Promise<WebSearchState>;
  save: (key: string) => Promise<WebSearchKeyResult>;
  remove: () => Promise<void>;
  /** Resolves to what the Pond stored, or null when its answer does not say. */
  setNearby: (enabled: boolean) => Promise<boolean | null>;
}

const POND: WebSearchSource = {
  read: () => api.webSearchState(),
  save: (key) => api.setWebSearchKey(key),
  remove: () => api.removeWebSearchKey(),
  setNearby: async (enabled) => {
    // `request` casts an empty body too, so the answer is read, not trusted.
    const saved: Partial<PondSettings> | undefined = await api.updateSettings({ web_search_local_results: enabled });
    const stored = saved?.web_search_local_results;
    return typeof stored === 'boolean' ? stored : null;
  },
};

const OFF: WebSearchState = { provider: 'brave', configured: false, status: 'not_configured' };

/**
 * An in-memory Pond, for working on the screen without one that serves the routes.
 *
 * It answers as the contract says a Pond does, and the key decides which way, so every state the
 * screen can show can be reached by typing: `invalid` is a key Brave refuses (a 422, nothing
 * stored), `quota` a valid key that is spent, `offline` one stored while Brave could not be
 * reached, and anything else a key that works. A fresh one starts with no key, and it is gone
 * with the screen, as the other mocks' changes are.
 */
export function createMockWebSearch(): WebSearchSource {
  let state: WebSearchState = OFF;
  let local: WebSearchLocalResults = { enabled: false, town: 'Nairobi' };
  return {
    read: async () => ({ ...state, local_results: local }),
    save: async (key) => {
      const word = key.trim().toLowerCase();
      if (word === 'invalid') {
        throw new ApiError('PUT /api/v1/web-search/key → 422', 422, null, i18n.t('webSearch.keyRejected'));
      }
      const status: WebSearchStatus = word === 'quota' ? 'quota' : word === 'offline' ? 'unverified' : 'ok';
      state = { provider: 'brave', configured: true, status };
      return { configured: true, status };
    },
    remove: async () => {
      state = OFF;
    },
    setNearby: async (enabled) => {
      local = { ...local, enabled };
      return enabled;
    },
  };
}

/**
 * The sentence for a status, one literal key per case so the key-completeness test can see every
 * one. The switch is exhaustive, so a status the Pond grows fails the typecheck here rather than
 * rendering as a key.
 */
export function statusLabel(status: WebSearchStatus, t: TFunction): string {
  switch (status) {
    case 'ok':
      return t('webSearch.status.ok');
    case 'not_configured':
      return t('webSearch.status.notConfigured');
    case 'rejected':
      return t('webSearch.status.rejected');
    case 'quota':
      return t('webSearch.status.quota');
    case 'unverified':
      return t('webSearch.status.unverified');
  }
}

/**
 * What the Nearby places switch would send, said before it is turned: the town and no more. Null
 * is a Pond that does not report nearby places.
 */
export function nearbyNote(nearby: WebSearchLocalResults | null, t: TFunction): string {
  if (!nearby) return t('webSearch.nearby.oldPond');
  if (nearby.town) return t('webSearch.nearby.sends', { town: nearby.town });
  return nearby.enabled ? t('webSearch.nearby.noTown') : t('webSearch.nearby.needsLocation');
}

export interface UseWebSearch {
  data: {
    /** What the Pond reports, or null until it has answered. */
    status: WebSearchStatus | null;
    /** Whether the Pond holds a key, which is what Remove is offered on. */
    configured: boolean;
    /** What has been typed into the key field. The only copy of a key this app ever holds. */
    draft: string;
    /** There is something to save and nothing already in flight. */
    canSave: boolean;
    /** Nearby places as the Pond reports it, a save in flight included. Null until it has. */
    nearby: WebSearchLocalResults | null;
    /** The Pond answered without nearby places: it predates them, so the switch stays off. */
    nearbyUnsupported: boolean;
    /** The switch can move: nothing in flight, and turning it on would have a town to send. */
    canToggleNearby: boolean;
  };
  /** The first read is out and nothing is known yet. */
  loading: boolean;
  saving: boolean;
  removing: boolean;
  /**
   * A read failed, in words. Null also when the connection banner already said it. A refused
   * removal is said in the snackbar, with Try again.
   */
  error: string | null;
  /** Why the last save did not go through, for the field: Brave's refusal, or the Pond's trouble. */
  keyError: string | null;
  nearbySaving: boolean;
  /** The last Nearby places change did not save, so the switch went back. */
  nearbyError: string | null;
  /** The first read failed and nothing has loaded, so an empty screen says nothing about the Pond. */
  failed: boolean;
  /** The Pond answered 404: it predates web search, which is not the same as being unreachable. */
  unsupported: boolean;
  actions: {
    refresh: () => Promise<void>;
    setDraft: (text: string) => void;
    /** Resolves to whether the Pond kept the key. The field is cleared only when it did. */
    save: () => Promise<boolean>;
    /** Resolves to whether the key is gone. */
    remove: () => Promise<boolean>;
    /** Brave's dashboard, in the in-app browser, where a key is made. */
    openDashboard: () => void;
    /** Resolves to whether the Pond now has nearby places the way it was asked. */
    setNearby: (enabled: boolean) => Promise<boolean>;
  };
}

export function useWebSearch(): UseWebSearch {
  const { hydrated, isScreenReal } = useServer();
  const real = isScreenReal('webSearch');
  const source = useMemo(() => (real ? POND : createMockWebSearch()), [real]);

  const [state, setState] = useState<WebSearchState | null>(null);
  const [reading, setReading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [draft, setDraftText] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  // Undefined until a read lands, null from a Pond that does not report it. Apart from `state`,
  // so saving or removing the key leaves it alone.
  const [local, setLocal] = useState<WebSearchLocalResults | null | undefined>(undefined);
  const [nearbyPending, setNearbyPending] = useState<boolean | null>(null);
  const [nearbySaving, setNearbySaving] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);

  // The Developer toggle swapping the source: nothing read from the old one describes the new one.
  const [from, setFrom] = useState(real);
  if (from !== real) {
    setFrom(real);
    setState(null);
    setReading(true);
    setError(null);
    setFailed(false);
    setUnsupported(false);
    setDraftText('');
    setKeyError(null);
    setLocal(undefined);
    setNearbyError(null);
  }

  // The source the screen is on now, so an answer from one it has left is dropped, and whether a
  // read has ever succeeded: after one, a failed poll keeps what is on screen.
  const current = useRef(source);
  const known = useRef(false);
  useEffect(() => {
    current.current = source;
    known.current = false;
  }, [source]);

  // A read that started before a save or a removal must not undo it when it lands.
  const writes = useRef(0);

  /** `loud` is a read somebody asked for; a poll is quiet and keeps the last good status. */
  const load = useCallback(
    async (loud: boolean) => {
      if (loud) {
        setReading(true);
        setError(null);
      }
      const startedAt = writes.current;
      const stale = () => current.current !== source || startedAt !== writes.current;
      try {
        const next = await source.read();
        if (stale()) return;
        setState(next);
        setLocal(next.local_results ?? null);
        known.current = true;
        setError(null);
        setFailed(false);
        setUnsupported(false);
      } catch (e) {
        if (stale()) return;
        if (e instanceof ApiError && e.status === 404) {
          // The route is not there: an older Pond. Say that, rather than that it is unreachable.
          setUnsupported(true);
          setState(null);
          setLocal(undefined);
          setError(null);
          setFailed(false);
          return;
        }
        if (loud || !known.current) setError(describeApiError(e));
        else console.warn('[web-search] refresh failed; showing the last result', e instanceof ApiError ? e.status : 'network');
        if (!known.current) setFailed(true);
      } finally {
        if (current.current === source) setReading(false);
      }
    },
    [source],
  );

  const refresh = useCallback(() => load(true), [load]);

  useLive(() => load(false), WEB_SEARCH_MS, hydrated);

  const setDraft = useCallback((text: string) => {
    setDraftText(text);
    // The refusal was about the key that was typed. Typing another is answering it.
    setKeyError(null);
  }, []);

  const save = useCallback(async () => {
    const key = draft.trim();
    if (!key || saving || removing) return false;
    setSaving(true);
    setKeyError(null);
    try {
      const result = await source.save(key);
      if (current.current !== source) return false;
      writes.current += 1;
      setState({ provider: 'brave', configured: result.configured, status: result.status });
      known.current = true;
      setUnsupported(false);
      setFailed(false);
      setError(null);
      // Gone the moment the Pond has it. A refused key stays, so a typo can be fixed.
      setDraftText('');
      return true;
    } catch (e) {
      // Brave's own refusal is the Pond's 422, and has one sentence. Anything else is the Pond's
      // trouble, and an action somebody just took must not fail in silence.
      setKeyError(
        e instanceof ApiError && e.status === 422
          ? i18n.t('webSearch.keyRejected')
          : (describeApiError(e) ?? i18n.t('errors.generic')),
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft, removing, saving, source]);

  // What the snackbar's Try again calls: the current `remove`, set below once it is made.
  const retryRemove = useRef<() => Promise<boolean>>(async () => false);

  /** The key is gone once the Pond says so: a refused removal must not look done. */
  const remove = useCallback(async () => {
    if (removing || saving) return false;
    setRemoving(true);
    try {
      await source.remove();
      if (current.current !== source) return false;
      writes.current += 1;
      setState(OFF);
      known.current = true;
      setKeyError(null);
      return true;
    } catch (e) {
      console.warn('[web-search] removal refused', e instanceof ApiError ? e.status : 'network');
      showSnackbar({
        message: describeApiError(e) ?? i18n.t('errors.generic'),
        tone: 'danger',
        action: { label: i18n.t('common.retry'), onPress: () => void retryRemove.current() },
      });
      return false;
    } finally {
      setRemoving(false);
    }
  }, [removing, saving, source]);
  useEffect(() => {
    retryRemove.current = remove;
  }, [remove]);

  const setNearby = useCallback(
    async (enabled: boolean) => {
      if (!local || nearbySaving) return false;
      // On with no town would send nothing, so it is refused rather than saved as a promise.
      if (enabled && !local.town) return false;
      setNearbySaving(true);
      setNearbyPending(enabled);
      setNearbyError(null);
      // A read already out answers from before the change.
      writes.current += 1;
      try {
        const stored = (await source.setNearby(enabled)) ?? enabled;
        if (current.current !== source) return false;
        writes.current += 1;
        setLocal((now) => (now ? { ...now, enabled: stored } : now));
        return stored === enabled;
      } catch {
        if (current.current === source) setNearbyError(i18n.t('webSearch.nearby.failed'));
        return false;
      } finally {
        setNearbyPending(null);
        setNearbySaving(false);
      }
    },
    [local, nearbySaving, source],
  );

  const openDashboard = useCallback(() => {
    WebBrowser.openBrowserAsync(BRAVE_DASHBOARD_URL).catch((e: unknown) => {
      console.warn('[web-search] could not open the dashboard', e instanceof Error ? e.name : 'unknown');
    });
  }, []);

  const nearby = local ? { ...local, enabled: nearbyPending ?? local.enabled } : null;

  return {
    data: {
      status: state?.status ?? null,
      configured: state?.configured ?? false,
      draft,
      canSave: draft.trim().length > 0 && !saving && !removing,
      nearby,
      nearbyUnsupported: local === null,
      canToggleNearby: nearby !== null && !nearbySaving && (nearby.enabled || nearby.town !== null),
    },
    loading: reading && state === null,
    saving,
    removing,
    error,
    keyError,
    nearbySaving,
    nearbyError,
    failed,
    unsupported,
    actions: { refresh, setDraft, save, remove, openDashboard, setNearby },
  };
}
