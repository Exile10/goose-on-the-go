/**
 * Secrets -- the keys the Pond holds for outside services, listed, added, replaced and deleted
 * from the phone.
 *
 * The Pond lists names and never values, so this screen has names to show and a field to write and
 * nothing to read back. A value exists in this view-model only between being typed and being
 * submitted: `save` takes it out of state before the request goes, whatever the answer, so neither a
 * saved value nor a refused one is left on screen or in memory the screen holds. It is never logged.
 *
 * Always the real Pond: `/api/v1/secrets` is served by every Pond this app pairs with, and a mock
 * that answered "saved" to anything would be the one thing a credentials screen must not do.
 */

import { useCallback, useRef, useState } from 'react';

import { isReservedRefusal, isValidSecretKey, secretLabelKey } from '@/models/secrets';
import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import i18n, { type TranslationKey } from '@/services/i18n';
import { describeApiError } from './describe-error';
import { useLive } from './use-live';

/**
 * How often the list is re-read while the screen is in front. Keys change when somebody changes
 * them, here or on the dashboard, so a minute is plenty.
 */
export const SECRETS_MS = 60_000;

/** One stored key, with the catalogue key for its friendly name when the Pond's catalogue has one. */
export interface SecretRow {
  key: string;
  labelKey: TranslationKey | null;
}

/** What the form is doing: adding a new key, or giving an existing one a new value. */
export type SecretForm = { kind: 'add' } | { kind: 'replace'; key: string };

export interface UseSecrets {
  data: {
    /** Every key the Pond lists, sorted. Members' Uber keys are never in it. */
    keys: SecretRow[];
    /** The open form, or null when none is. */
    form: SecretForm | null;
    /** The key name being typed, for Add. Replace names its key in `form`. */
    draftKey: string;
    /** The value being typed. Emptied the moment it is submitted. */
    draftValue: string;
    /** There is something to save and nothing already in flight. */
    canSave: boolean;
  };
  /** The first read is out and nothing is known yet. */
  loading: boolean;
  /** A read somebody asked for is out, over a list already on screen. */
  refreshing: boolean;
  saving: boolean;
  /** The key a deletion is out for, or null. */
  deleting: string | null;
  /** A read or a deletion failed, in words. */
  error: string | null;
  /** Why the last save did not go through, for the form. */
  formError: string | null;
  /** What the last save or deletion did, in words, until the next action. */
  notice: string | null;
  /** The first read failed and nothing has loaded, so an empty list says nothing about the Pond. */
  failed: boolean;
  actions: {
    refresh: () => Promise<void>;
    startAdd: () => void;
    startReplace: (key: string) => void;
    /** Closes the form and drops whatever was typed in it. */
    cancel: () => void;
    setDraftKey: (text: string) => void;
    setDraftValue: (text: string) => void;
    /** Resolves to whether the Pond stored the value. The value field is empty either way. */
    save: () => Promise<boolean>;
    /** Resolves to whether the key is gone. */
    remove: (key: string) => Promise<boolean>;
  };
}

/** A row's name as the screen writes it: the friendly name when there is one, else the key. */
export function secretName(row: SecretRow): string {
  return row.labelKey ? i18n.t(row.labelKey) : row.key;
}

function rowFor(key: string): SecretRow {
  return { key, labelKey: secretLabelKey(key) };
}

function sorted(keys: readonly string[]): SecretRow[] {
  return [...new Set(keys)].sort((a, b) => a.localeCompare(b)).map(rowFor);
}

/**
 * The sentence for a refusal of one of these routes. A 403 is said in words here rather than left
 * to the connection banner, because on this screen it is a refusal of the key, not of the phone.
 */
function refusal(e: unknown): string | null {
  if (isReservedRefusal(e)) return i18n.t('secrets.reserved');
  if (e instanceof ApiError && e.status === 403) return i18n.t('secrets.refused');
  if (e instanceof ApiError && e.status === 503) return i18n.t('secrets.unavailable');
  return describeApiError(e);
}

/** For the log: the status, never the key's value and never the Pond's sentence about it. */
function statusOf(e: unknown): number | 'network' {
  return e instanceof ApiError ? e.status : 'network';
}

export function useSecrets(): UseSecrets {
  const { hydrated } = useServer();

  const [keys, setKeys] = useState<SecretRow[] | null>(null);
  const [reading, setReading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [form, setForm] = useState<SecretForm | null>(null);
  const [draftKey, setDraftKeyText] = useState('');
  const [draftValue, setDraftValueText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // A read that started before a save or a deletion must not undo it when it lands.
  const writes = useRef(0);
  // Whether a listing has ever arrived: after one, a failed re-read keeps what is on screen.
  const loaded = useRef(false);

  /** `loud` is a read somebody asked for; a poll is quiet and keeps the last good list. */
  const load = useCallback(async (loud: boolean) => {
    if (loud) {
      setReading(true);
      setError(null);
    }
    const startedAt = writes.current;
    try {
      const listed = await api.listSecretKeys();
      if (startedAt !== writes.current) return;
      setKeys(sorted(listed));
      loaded.current = true;
      setError(null);
      setFailed(false);
    } catch (e) {
      if (startedAt !== writes.current) return;
      console.warn('[secrets] listing failed', { status: statusOf(e), loud });
      if (loud || !loaded.current) setError(refusal(e));
      if (!loaded.current) setFailed(true);
    } finally {
      setReading(false);
    }
  }, []);

  // A key added or deleted on the dashboard shows up here without a pull.
  useLive(() => load(false), SECRETS_MS, hydrated);
  const refresh = useCallback(() => load(true), [load]);

  const closeForm = useCallback(() => {
    setForm(null);
    setDraftKeyText('');
    setDraftValueText('');
    setFormError(null);
  }, []);

  const startAdd = useCallback(() => {
    closeForm();
    setNotice(null);
    setForm({ kind: 'add' });
  }, [closeForm]);

  const startReplace = useCallback(
    (key: string) => {
      closeForm();
      setNotice(null);
      setForm({ kind: 'replace', key });
    },
    [closeForm],
  );

  const setDraftKey = useCallback((text: string) => {
    setDraftKeyText(text);
    setFormError(null);
  }, []);

  const setDraftValue = useCallback((text: string) => {
    setDraftValueText(text);
    setFormError(null);
  }, []);

  const busy = saving || deleting !== null;
  const targetKey = form?.kind === 'replace' ? form.key : draftKey.trim();
  const canSave = form !== null && !busy && targetKey.length > 0 && draftValue.trim().length > 0;

  const save = useCallback(async () => {
    if (!form || !canSave) return false;
    const key = targetKey;
    if (form.kind === 'add') {
      if (!isValidSecretKey(key)) {
        setFormError(i18n.t('secrets.invalidKey'));
        return false;
      }
      // Add must not quietly overwrite: replacing a value is its own, deliberate action.
      if (keys?.some((row) => row.key === key)) {
        setFormError(i18n.t('secrets.alreadyStored'));
        return false;
      }
    }
    const value = draftValue.trim();
    // Out of state before the request goes, so no outcome leaves it behind.
    setDraftValueText('');
    setSaving(true);
    setFormError(null);
    setNotice(null);
    try {
      const result = await api.setSecret(key, value);
      writes.current += 1;
      setKeys((known) => sorted([...(known ?? []).map((row) => row.key), key]));
      const name = secretName(rowFor(key));
      setNotice(
        result.restartFailed.length > 0
          ? i18n.t('secrets.savedRestartFailed', { name, extensions: result.restartFailed.join(', ') })
          : i18n.t('secrets.saved', { name }),
      );
      setForm(null);
      setDraftKeyText('');
      return true;
    } catch (e) {
      console.warn('[secrets] save failed', { status: statusOf(e) });
      // An action somebody just took must not fail in silence, even when the banner has a reason.
      setFormError(refusal(e) ?? i18n.t('errors.generic'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [canSave, draftValue, form, keys, targetKey]);

  /** The key is gone once the Pond says so: a refused deletion must not look done. */
  const remove = useCallback(
    async (key: string) => {
      if (busy) return false;
      setDeleting(key);
      setError(null);
      setNotice(null);
      try {
        await api.deleteSecret(key);
        writes.current += 1;
        setKeys((known) => (known ?? []).filter((row) => row.key !== key));
        if (form?.kind === 'replace' && form.key === key) closeForm();
        setNotice(i18n.t('secrets.deleted', { name: secretName(rowFor(key)) }));
        return true;
      } catch (e) {
        console.warn('[secrets] delete failed', { status: statusOf(e) });
        setError(refusal(e) ?? i18n.t('errors.generic'));
        return false;
      } finally {
        setDeleting(null);
      }
    },
    [busy, closeForm, form],
  );

  return {
    data: { keys: keys ?? [], form, draftKey, draftValue, canSave },
    loading: reading && keys === null,
    refreshing: reading && keys !== null,
    saving,
    deleting,
    error,
    formError,
    notice,
    failed,
    actions: { refresh, startAdd, startReplace, cancel: closeForm, setDraftKey, setDraftValue, save, remove },
  };
}
