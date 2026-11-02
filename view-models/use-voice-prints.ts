/**
 * Voice Match: who the Pond knows by voice, and making it forget one. Teaching it a voice is the
 * "Teach Goose your voice" flow (`use-teach-voice.ts`). Knowing a voice gives the Pond that person's
 * own context when they speak in the room; it never lets a voice approve anything, which still takes
 * a paired phone, a sign-in or a face.
 *
 * The listing is read every minute while the screen is in front, and every five seconds while the
 * speaker model is downloading, so the progress moves.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import i18n from '@/services/i18n';
import type { VoicePrintMember, VoicePrints } from '@/services/types';
import { orderMembers } from '@/models/voice-room';
import { isMissingRoute } from './agents-source';
import { describeApiError, logFailure } from './describe-error';
import { MIN_POLL_MS, useLive } from './use-live';
import { useVoiceSource } from './voice-source';

export const VOICE_PRINTS_MS = 60_000;

export interface UseVoicePrints {
  data: {
    model: VoicePrints['model'] | null;
    /** Everyone in the household, known voices first. */
    members: VoicePrintMember[];
    known: number;
  };
  loading: boolean;
  failed: boolean;
  /** The Pond has no Voice Match routes: it needs an update. */
  missing: boolean;
  error: string | null;
  actions: {
    refresh: () => Promise<void>;
    retryModel: () => Promise<void>;
    /** Resolves to why the Pond refused, or null once it has forgotten the voice. */
    forget: (member: VoicePrintMember) => Promise<string | null>;
  };
}

export function useVoicePrints(): UseVoicePrints {
  const { hydrated } = useServer();
  const source = useVoiceSource();
  const [prints, setPrints] = useState<VoicePrints | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<VoicePrints | null>(null);

  const [from, setFrom] = useState(source);
  if (from !== source) {
    setFrom(source);
    setPrints(null);
    setMissing(false);
    setFailed(false);
  }

  const load = useCallback(
    async (loud: boolean) => {
      if (loud) {
        setLoading(true);
        setError(null);
      }
      try {
        const next = await source.prints();
        latest.current = next;
        setPrints(next);
        setMissing(false);
        setFailed(false);
        setError(null);
      } catch (e) {
        if (isMissingRoute(e)) {
          setMissing(true);
        } else {
          logFailure('voice-match', 'read failed', e);
          if (loud || latest.current === null) setError(describeApiError(e) ?? i18n.t('voiceMatch.loadFailed'));
          if (latest.current === null) setFailed(true);
        }
      } finally {
        setLoading(false);
      }
    },
    [source],
  );

  const refresh = useCallback(() => load(true), [load]);
  const delay = useCallback(() => (latest.current?.model.state === 'downloading' ? MIN_POLL_MS : VOICE_PRINTS_MS), []);
  useLive(() => load(false), delay, hydrated && !missing);

  const retryModel = useCallback(async () => {
    try {
      await source.retryModel();
    } catch (e) {
      logFailure('voice-match', 'model retry refused', e);
      setError(describeApiError(e) ?? i18n.t('voiceMatch.model.retryFailed'));
    }
    await load(false);
  }, [load, source]);

  const forget = useCallback(
    async (member: VoicePrintMember) => {
      try {
        await source.forget(member.profile_id);
      } catch (e) {
        logFailure('voice-match', 'forget refused', e);
        return describeApiError(e) ?? i18n.t('voiceMatch.forget.failed');
      }
      await load(false);
      return null;
    },
    [load, source],
  );

  const members = useMemo(() => orderMembers(prints?.members ?? []), [prints]);

  return {
    data: { model: prints?.model ?? null, members, known: members.filter((m) => m.enrolled).length },
    loading,
    failed,
    missing,
    error,
    actions: { refresh, retryModel, forget },
  };
}
