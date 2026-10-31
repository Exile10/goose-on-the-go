/**
 * The member's setup interview: where it stands, starting or taking it up, and saving what Goose
 * drafted from it. `models/interview.ts` reads the wire. Read on focus, since the screens that show it
 * are the ones the interview's conversation returns to.
 *
 * The member is this phone's own. The Pond answers these routes to that member's devices only, so
 * a phone attributed to nobody, or to somebody else, sees no interview rather than an error, as does
 * a Pond built before the interview existed.
 */

import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import type { ProfileInterview } from '@/services/types';
import { describeApiError } from './describe-error';

export interface UseInterview {
  data: { interview: ProfileInterview | null };
  loading: boolean;
  error: string | null;
  actions: {
    refresh: () => Promise<void>;
    /** Resolves to the interview with its session, or null when it could not be started. */
    start: () => Promise<ProfileInterview | null>;
    /** Resolves to the keys saved, none when the conversation had saved them already, or null on failure. */
    approve: () => Promise<string[] | null>;
  };
}

// 403 is another member's device and 404 an unknown member or a Pond without the routes: no offer.
function absent(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 403 || e.status === 404);
}

/**
 * `profileId` when the screen already knows the member, as the conversation does from its link;
 * `enabled` false reads nothing, for a screen that only sometimes shows an interview.
 */
export function useInterview(profileId?: string | null, enabled = true): UseInterview {
  const { hydrated, paired } = useServer();
  const [interview, setInterview] = useState<ProfileInterview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const member = useRef<string | null>(profileId ?? null);

  const resolve = useCallback(async (): Promise<string | null> => {
    if (profileId) return (member.current = profileId);
    if (!member.current) member.current = (await api.deviceSelf()).profile?.id ?? null;
    return member.current;
  }, [profileId]);

  const refresh = useCallback(async () => {
    try {
      const id = await resolve();
      setInterview(id ? await api.interview(id) : null);
      setError(null);
    } catch (e) {
      if (absent(e)) setInterview(null);
      else setError(describeApiError(e));
    } finally {
      setLoading(false);
    }
  }, [resolve]);

  useFocusEffect(
    useCallback(() => {
      if (hydrated && paired && enabled) void refresh();
    }, [enabled, hydrated, paired, refresh]),
  );

  const start = useCallback(async () => {
    try {
      const id = await resolve();
      if (!id) return null;
      const started = await api.startInterview(id);
      setInterview(started);
      setError(null);
      return started.sessionId ? started : null;
    } catch (e) {
      setError(describeApiError(e));
      return null;
    }
  }, [resolve]);

  const approve = useCallback(async () => {
    const id = member.current;
    if (!id) return null;
    try {
      const saved = await api.approveInterview(id);
      await refresh();
      return saved;
    } catch (e) {
      // The member said yes in the conversation first, so the draft is already saved.
      if (e instanceof ApiError && e.status === 409) {
        await refresh();
        return [];
      }
      setError(describeApiError(e));
      return null;
    }
  }, [refresh]);

  return { data: { interview }, loading, error, actions: { refresh, start, approve } };
}
