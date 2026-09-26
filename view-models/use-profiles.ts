/**
 * Household profiles — who the Pond recognises.
 *
 * A profile identifies a person so the assistant can attribute memory and voice
 * to them. It is not an account: `GET /api/v1/profiles` returns
 * `{id, display_name, avatar_emoji}` and nothing else. There is no email, no
 * role, no permission tier and no invite.
 */

import { useCallback, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import type { Profile } from '@/services/types';
import { describeApiError } from './describe-error';
import { useLive } from './use-live';
import i18n from '@/services/i18n';

export interface UseProfiles {
  data: { profiles: Profile[] };
  loading: boolean;
  error: string | null;
  actions: {
    add: (displayName: string, avatarEmoji?: string) => Promise<boolean>;
    remove: (id: string) => Promise<void>;
    refresh: () => Promise<void>;
  };
}


/** A member added or removed on the desktop should show up here without a restart. */
export const PROFILES_MS = 60_000;

export function useProfiles(): UseProfiles {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The base URL and bearer token arrive asynchronously; fetching before they
  // land calls the default address unauthenticated and never retries.
  const { hydrated } = useServer();

  // Whether a read has ever succeeded. After one, a failed poll keeps what is on screen.
  const loaded = useRef(false);

  /** `loud` is a read somebody asked for; a poll is quiet and keeps the last good data. */
  const load = useCallback(async (loud: boolean) => {
    if (loud) {
      setLoading(true);
      setError(null);
    }
    try {
      setProfiles(await api.listProfiles());
      loaded.current = true;
      setError(null);
    } catch (e) {
      if (loud || !loaded.current) setError(describe(e));
      else console.warn('[profiles] refresh failed; showing the last result', e instanceof ApiError ? e.status : 'network');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => load(true), [load]);

  useLive(() => load(false), PROFILES_MS, hydrated);

  /** Returns whether it was added, so the caller knows to close its form. */
  const add = useCallback(async (displayName: string, avatarEmoji?: string) => {
    setError(null);
    try {
      const created = await api.createProfile(displayName.trim(), avatarEmoji);
      setProfiles((current) => [...current, created]);
      return true;
    } catch (e) {
      setError(describe(e));
      return false;
    }
  }, []);

  /**
   * Removed optimistically and restored on failure. Deleting a profile is the
   * one destructive action here, so the list must not keep showing someone the
   * server refused to remove.
   */
  const remove = useCallback(
    async (id: string) => {
      const previous = profiles;
      setProfiles((current) => current.filter((p) => p.id !== id));
      try {
        await api.deleteProfile(id);
      } catch (e) {
        setProfiles(previous);
        setError(describe(e));
      }
    },
    [profiles],
  );

  return { data: { profiles }, loading, error, actions: { add, remove, refresh } };
}

function describe(e: unknown): string | null {
  if (e instanceof ApiError && e.status === 409) {
    return i18n.t('errors.profileExists');
  }
  return describeApiError(e);
}
