/**
 * Household profiles — who the Pond recognises.
 *
 * A profile identifies a person so the assistant can attribute memory and voice
 * to them. It is not an account: `GET /api/v1/profiles` returns
 * `{id, display_name, avatar_emoji}` and nothing else. There is no email, no
 * role, no permission tier and no invite.
 */

import { useCallback, useEffect, useState } from 'react';

import { ApiError, api } from '@/services/api-client';
import type { Profile } from '@/services/types';

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
    void refresh();
  }, [refresh]);

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

function describe(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return 'A profile with that name already exists.';
    if (e.isRetryable) return 'Your Pond is busy. Try again in a moment.';
    return `Your Pond refused the request (HTTP ${e.status}).`;
  }
  return 'Could not reach your Pond. Check that it is running on this network.';
}
