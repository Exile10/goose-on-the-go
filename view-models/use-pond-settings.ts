/**
 * The Pond's settings, held once so a change on a page shows on the menu behind it. A change is
 * sent alone the moment a control moves, and the Pond's answer replaces the record.
 */

import { useCallback, useSyncExternalStore } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import { reject } from '@/services/haptics';
import i18n from '@/services/i18n';
import type { PondSettingKey, PondSettings } from '@/services/types';
import { SAMPLE_SETTINGS, readSettings } from '@/models/pond-settings';
import { describeApiError } from './describe-error';
import { useLive } from './use-live';

/** Settings change from other screens too, but rarely; a minute keeps the menu honest. */
export const SETTINGS_MS = 60_000;

type Source = 'real' | 'mock';
type KeyFlags = Partial<Record<PondSettingKey, true>>;
type KeyMessages = Partial<Record<PondSettingKey, string>>;

interface Store {
  source: Source | null;
  settings: PondSettings | null;
  loading: boolean;
  error: string | null;
  saving: KeyFlags;
  fieldErrors: KeyMessages;
  voice: { applying: boolean; error: string | null };
}

const EMPTY: Store = {
  source: null,
  settings: null,
  loading: false,
  error: null,
  saving: {},
  fieldErrors: {},
  voice: { applying: false, error: null },
};

let store: Store = EMPTY;
const listeners = new Set<() => void>();
// A reply to an older write of a key must never overwrite a newer one.
const writes = new Map<PondSettingKey, number>();
let reads = 0;
let voiceApplies = 0;

function setStore(patch: Partial<Store>) {
  store = { ...store, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function without<T extends object>(map: T, key: PondSettingKey): T {
  const next = { ...map };
  delete (next as Record<string, unknown>)[key];
  return next;
}

/** The Pond's record, with any value still being saved kept as the household set it. */
function adopt(answer: PondSettings, except?: PondSettingKey): PondSettings {
  const merged = { ...answer } as Record<string, unknown>;
  const current = store.settings as Record<string, unknown> | null;
  for (const key of Object.keys(store.saving) as PondSettingKey[]) {
    if (key !== except && current) merged[key] = current[key];
  }
  return merged as unknown as PondSettings;
}

async function load(source: Source, loud: boolean): Promise<void> {
  if (source === 'mock') {
    if (store.source !== 'mock') setStore({ ...EMPTY, source: 'mock', settings: { ...SAMPLE_SETTINGS } });
    return;
  }
  if (store.source !== 'real') setStore({ ...EMPTY, source: 'real', loading: true });
  else if (loud) setStore({ loading: true, error: null });
  const mine = ++reads;
  try {
    const answer = readSettings(await api.getSettings());
    if (mine !== reads || store.source !== 'real') return;
    setStore({ settings: adopt(answer), loading: false, error: null });
  } catch (e) {
    if (mine !== reads || store.source !== 'real') return;
    // A quiet poll that fails keeps the last record; a read somebody asked for says why.
    const error = loud || !store.settings ? describeApiError(e) ?? i18n.t('settings.loadFailed') : store.error;
    setStore({ loading: false, error });
  }
}

function saveMessage(e: unknown): string {
  if (e instanceof ApiError && e.status === 422 && e.detail) return e.detail;
  return describeApiError(e) ?? i18n.t('settings.saveFailed');
}

const VOICE_KEYS: readonly PondSettingKey[] = ['voice_tts_voice', 'voice_tts_speed', 'voice_tts_quality'];

/** Storing a voice setting waits for the engine to reload; asking it to apply switches it now. */
async function applyVoice(key: PondSettingKey, s: PondSettings): Promise<void> {
  const mine = ++voiceApplies;
  setStore({ voice: { applying: true, error: null } });
  const change =
    key === 'voice_tts_voice' ? { voice: s.voice_tts_voice }
      : key === 'voice_tts_speed' ? { speed: s.voice_tts_speed }
        : { quality: s.voice_tts_quality };
  try {
    await api.applyTts(change);
    if (mine === voiceApplies) setStore({ voice: { applying: false, error: null } });
  } catch (e) {
    console.warn('[settings] the voice was saved but not applied', e instanceof ApiError ? e.status : 'network');
    if (mine === voiceApplies) setStore({ voice: { applying: false, error: i18n.t('settings.voice.applyFailed') } });
  }
}

/** Change one setting. Resolves to whether the Pond kept it; a refusal puts the old value back. */
async function update<K extends PondSettingKey>(key: K, value: PondSettings[K]): Promise<boolean> {
  const current = store.settings;
  if (!current) return false;
  const before = current[key];
  const seq = (writes.get(key) ?? 0) + 1;
  writes.set(key, seq);
  setStore({
    settings: { ...current, [key]: value },
    saving: { ...store.saving, [key]: true },
    fieldErrors: without(store.fieldErrors, key),
  });
  if (store.source === 'mock') {
    setStore({ saving: without(store.saving, key) });
    return true;
  }
  try {
    const answer = readSettings(await api.updateSettings({ [key]: value } as Partial<PondSettings>));
    if (writes.get(key) !== seq) return true;
    setStore({ settings: adopt(answer, key), saving: without(store.saving, key) });
    if (VOICE_KEYS.includes(key)) void applyVoice(key, answer);
    return true;
  } catch (e) {
    if (writes.get(key) !== seq || !store.settings) return false;
    setStore({
      settings: { ...store.settings, [key]: before },
      saving: without(store.saving, key),
      fieldErrors: { ...store.fieldErrors, [key]: saveMessage(e) },
    });
    void reject();
    return false;
  }
}

function clearFieldError(key: PondSettingKey): void {
  if (store.fieldErrors[key]) setStore({ fieldErrors: without(store.fieldErrors, key) });
}

export interface UsePondSettings {
  settings: PondSettings | null;
  loading: boolean;
  error: string | null;
  /** Nothing has loaded and the last read failed: the settings are unknown, not empty. */
  failed: boolean;
  saving: KeyFlags;
  fieldErrors: KeyMessages;
  voice: { applying: boolean; error: string | null };
  actions: {
    update: typeof update;
    refresh: () => Promise<void>;
    clearFieldError: (key: PondSettingKey) => void;
  };
}

export function usePondSettings(): UsePondSettings {
  const { hydrated, isScreenReal } = useServer();
  const source: Source = isScreenReal('settings') ? 'real' : 'mock';
  const snap = useSyncExternalStore(subscribe, () => store);
  // Until this source's first read lands, the record held is another source's.
  const current = snap.source === source ? snap : { ...EMPTY, loading: source === 'real' };

  useLive(() => load(source, false), SETTINGS_MS, hydrated || source === 'mock');
  const refresh = useCallback(() => load(source, true), [source]);

  return {
    settings: current.settings,
    loading: current.loading,
    error: current.error,
    failed: !current.settings && !!current.error,
    saving: current.saving,
    fieldErrors: current.fieldErrors,
    voice: current.voice,
    actions: { update, refresh, clearFieldError },
  };
}

/** For tests: forget everything held. */
export function resetPondSettingsStore(): void {
  store = EMPTY;
  writes.clear();
  reads = 0;
  voiceApplies = 0;
  listeners.forEach((listener) => listener());
}
