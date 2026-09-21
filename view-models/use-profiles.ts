/**
 * Household profiles — who the Pond recognises.
 *
 * A profile identifies a person so the assistant can attribute memory and voice
 * to them. It is not an account: `GET /api/v1/profiles` returns
 * `{id, display_name, avatar_emoji}` and nothing else. There is no email, no
 * role, no permission tier and no invite.
 */

import { useCallback, useEffect, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import type { Profile } from '@/services/types';
import { describeApiError } from './describe-error';

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

export function useProfiles(): UseProfiles {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The base URL and bearer token arrive asynchronously; fetching before they
  // land calls the default address unauthenticated and never retries.
  const { hydrated } = useServer();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProfiles(await api.listProfiles());
    } catch (e) {
      setError(describe(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void refresh();
  }, [hydrated, refresh]);

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
    return 'A profile with that name already exists.';
  }
  return describeApiError(e);
}
