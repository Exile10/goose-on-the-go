/**
 * Voice Match: who the Pond knows by voice, and teaching it or making it forget.
 *
 * A voice print is made from five sentences read to this phone. The Pond keeps how the voice sounds
 * and discards the recordings. Knowing a voice gives the Pond that person's own context when they
 * speak in the room; it never lets a voice approve anything, which still takes a paired phone, a
 * sign-in or a face.
 *
 * The listing is read every minute while the screen is in front, and every five seconds while the
 * speaker model is downloading, so the progress moves.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { VoicePrintMember, VoicePrints, VoicePrintTake } from '@/services/types';
import { VOICE_PRINT_TAKES, enrolSentence, orderMembers } from '@/models/voice-room';
import { isMissingRoute } from './agents-source';
import { describeApiError, logFailure } from './describe-error';
import { MIN_POLL_MS, useLive } from './use-live';
import { useTakeRecorder, type TakeState } from './use-take-recorder';
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

/** The `error` code a refusal carries, such as `no_speech` or `model_not_ready`. */
function refusalCode(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  const body = e.body as { error?: unknown; reason?: unknown } | null;
  const code = body?.error ?? body?.reason;
  return typeof code === 'string' && code ? code : null;
}

/** Why a take was refused, as a sentence that says what to do. */
export function describeTakeError(e: unknown): string {
  if (e instanceof ApiError) {
    const code = refusalCode(e);
    if (e.status === 422 || code === 'no_speech') return i18n.t('voiceMatch.error.noSpeech');
    if (e.status === 409 || code === 'model_not_ready') return i18n.t('voiceMatch.error.modelNotReady');
    if (e.status === 404) return i18n.t('voiceMatch.error.unknownPerson');
    if (e.status === 403) return i18n.t('voiceMatch.error.notAllowed');
  }
  return describeApiError(e) ?? i18n.t('voiceMatch.error.failed');
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

export interface UseVoicePrintRecorder {
  state: TakeState;
  /** The sentence to read now; null before a run starts. */
  sentence: string | null;
  /** Takes the Pond holds for this person. */
  takes: number;
  needed: number;
  consistency: number | null;
  level: number;
  error: string | null;
  supported: boolean;
  /** Records takes until the Pond has as many as it needs. `fresh` forgets the old print first. */
  start: (fresh: boolean) => Promise<void>;
  stop: () => void;
}

/**
 * @param member As the listing has it; what the sheet shows whenever no run is in progress.
 * @param onChanged Runs after each take the Pond keeps, so the list shows the new count.
 */
export function useVoicePrintRecorder(member: VoicePrintMember, onChanged: () => Promise<void>): UseVoicePrintRecorder {
  const source = useVoiceSource();
  const [progress, setProgress] = useState<Pick<VoicePrintTake, 'takes' | 'needed' | 'consistency'>>({
    takes: member.takes,
    needed: member.needed || VOICE_PRINT_TAKES,
    consistency: member.consistency,
  });
  const takesRef = useRef(member.takes);

  const recorder = useTakeRecorder({
    name: 'voice-print',
    describe: describeTakeError,
    take: async (uri) => {
      const result = await source.addTake(member.profile_id, uri, enrolSentence(takesRef.current));
      takesRef.current = result.takes;
      setProgress({ takes: result.takes, needed: result.needed, consistency: result.consistency });
      await onChanged();
      return result.enrolled || result.takes >= result.needed ? 'done' : 'again';
    },
  });

  const start = useCallback(
    async (fresh: boolean) => {
      takesRef.current = member.takes;
      setProgress({ takes: member.takes, needed: member.needed || VOICE_PRINT_TAKES, consistency: member.consistency });
      await recorder.start(async () => {
        if (!fresh) return;
        // Recording again starts from nothing: five new takes, not five more.
        await source.forget(member.profile_id);
        takesRef.current = 0;
        setProgress((p) => ({ ...p, takes: 0, consistency: null }));
        await onChanged();
      });
    },
    [member.consistency, member.needed, member.profile_id, member.takes, onChanged, recorder, source],
  );

  const { state } = recorder;
  const active = state === 'listening' || state === 'recording' || state === 'sending';
  return {
    state,
    sentence: active ? enrolSentence(progress.takes) : null,
    takes: active ? progress.takes : member.takes,
    needed: active ? progress.needed : member.needed || VOICE_PRINT_TAKES,
    consistency: active ? progress.consistency : member.consistency,
    level: recorder.level,
    error: recorder.error,
    supported: recorder.supported,
    start,
    stop: recorder.stop,
  };
}
