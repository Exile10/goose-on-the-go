/**
 * Teaching Goose a voice: five sentences read to this phone, each starting with the household's wake
 * phrase. Every take tunes how the Pond hears the wake phrase, and, with Voice Match on, adds to that
 * person's voice print. A take the Pond accepts moves on to the next sentence by itself; one it
 * refuses keeps the same sentence and says why.
 *
 * What the Pond learned about the phrase belongs to the phrase, not the person, so a run adds to it;
 * it is cleared only when the run saves a different phrase. A print being recorded again is
 * forgotten first, so five new sentences make it rather than five more. The run counts its own
 * sentences: the Pond's verdict on the detector is the household's, across every taught member.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError } from '@/services/api-client';
import { reject } from '@/services/haptics';
import i18n from '@/services/i18n';
import { enrolPhoneTake, forgetPhoneVoice } from '@/services/phone-wake-voices';
import type { VoicePrints, VoiceTakeResult, WakeDetectorVerdict } from '@/services/types';
import { VOICE_PRINT_TAKES, teachSentences } from '@/models/voice-room';
import { isMissingRoute } from './agents-source';
import { describeApiError, logFailure } from './describe-error';
import { usePondSettings } from './use-pond-settings';
import { finishChecklistItem } from './use-setup-checklist';
import { useTakeRecorder } from './use-take-recorder';
import { useVoicePrints } from './use-voice-prints';
import { POND_VOICE, useVoiceSource } from './voice-source';

export type TeachPhase = 'intro' | 'takes' | 'done';

/** Each pause the room is asked for, and how often it is asked again while the flow is open. */
export const ROOM_PAUSE_SECONDS = 120;
export const ROOM_PAUSE_RENEW_MS = 90_000;

export interface TeachMember {
  id: string;
  name: string;
}

/** One accepted sentence, and whether the "hey goose" detector fired on it. */
export interface TeachResult {
  prompt: string;
  detector: boolean;
}

export interface UseTeachVoice {
  phase: TeachPhase;
  phrase: string;
  sentences: string[];
  /** The sentence to say now. */
  index: number;
  of: number;
  /** The phone hears speech: the sentence rises. */
  lit: boolean;
  sending: boolean;
  /** The run is waiting on a Try again, after silence or a failure. */
  stopped: boolean;
  /** Why the last take did not count, in plain words; the same sentence comes again. */
  said: string | null;
  /** Takes accepted in this run, so leaving asks first once there is one. */
  recorded: number;
  voiceMatch: {
    on: boolean;
    /** A print needs a person, and a Pond with Voice Match. */
    available: boolean;
    model: VoicePrints['model'] | null;
  };
  results: TeachResult[];
  detector: WakeDetectorVerdict | null;
  consistency: number | null;
  enrolled: boolean;
  level: number;
  supported: boolean;
  starting: boolean;
  /** Why the run could not start: the microphone, or the Pond refusing the first steps. */
  error: string | null;
  actions: {
    setVoiceMatch: (on: boolean) => void;
    start: () => Promise<void>;
    /** After silence or a failure: the same sentence again. */
    retry: () => Promise<void>;
    stop: () => void;
    retryModel: () => Promise<void>;
  };
}

/** The `error` a refusal names, such as `no_speech` or `no_wake_phrase`. */
function refusalCode(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  const code = (e.body as { error?: unknown } | null)?.error;
  return typeof code === 'string' && code ? code : null;
}

/** A refused take in plain words, or null for a failure that ends the run. */
export function refusalWords(e: unknown, phrase: string): string | null {
  if (!(e instanceof ApiError) || e.status !== 422) return null;
  if (refusalCode(e) === 'no_wake_phrase') {
    const heardAs = (e.body as { heard_as?: unknown } | null)?.heard_as;
    const opening = teachSentences(phrase)[0].split(',')[0];
    return typeof heardAs === 'string' && heardAs.trim()
      ? i18n.t('teachVoice.refused.heardAs', { heardAs: heardAs.trim(), phrase: opening })
      : i18n.t('teachVoice.refused.noPhrase', { phrase: opening });
  }
  return i18n.t('teachVoice.refused.noSpeech');
}

/** A failure that stops the run, as a sentence that says what to do. */
export function describeTeachError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409 || refusalCode(e) === 'model_not_ready') return i18n.t('teachVoice.error.modelNotReady');
    if (e.status === 404) return i18n.t('teachVoice.error.missing');
    if (e.status === 403) return i18n.t('teachVoice.error.notAllowed');
  }
  return describeApiError(e) ?? i18n.t('teachVoice.error.failed');
}

export function useTeachVoice({ member, phrase }: { member: TeachMember | null; phrase: string }): UseTeachVoice {
  const { profileId } = useServer();
  const source = useVoiceSource();
  const prints = useVoicePrints();
  const settings = usePondSettings();
  const sentences = teachSentences(phrase);

  const [phase, setPhase] = useState<TeachPhase>('intro');
  const [index, setIndex] = useState(0);
  const [said, setSaid] = useState<string | null>(null);
  const [results, setResults] = useState<TeachResult[]>([]);
  const [detector, setDetector] = useState<WakeDetectorVerdict | null>(null);
  const [match, setMatch] = useState<VoiceTakeResult['voice_match']>(null);
  const [wantMatch, setWantMatch] = useState(true);
  const [starting, setStarting] = useState(false);

  const available = member !== null && !prints.missing;
  const matchOn = wantMatch && available;
  const run = useRef({ index: 0, matchOn, sentences });
  useEffect(() => {
    run.current.matchOn = matchOn;
    run.current.sentences = sentences;
  });

  // Every sentence starts with the wake phrase, so the room would answer each one: it is asked not to
  // listen from Continue until the flow is done or left. An older Pond has no pause, and the run goes on.
  const [quiet, setQuiet] = useState(false);
  const room = useRef({ quiet: false, source });
  useEffect(() => {
    room.current.source = source;
  });
  const pauseRoom = useCallback(async () => {
    try {
      await room.current.source.pauseRoom(ROOM_PAUSE_SECONDS);
      return true;
    } catch (e) {
      if (isMissingRoute(e)) return false;
      logFailure('teach-voice', 'room pause refused', e);
      return true;
    }
  }, []);
  const resumeRoom = useCallback(() => {
    if (!room.current.quiet) return;
    room.current.quiet = false;
    setQuiet(false);
    room.current.source.resumeRoom().catch((e: unknown) => {
      if (!isMissingRoute(e)) logFailure('teach-voice', 'room resume refused', e);
    });
  }, []);
  useEffect(() => {
    if (!quiet) return;
    const timer = setInterval(() => void pauseRoom(), ROOM_PAUSE_RENEW_MS);
    return () => clearInterval(timer);
  }, [quiet, pauseRoom]);
  useEffect(() => {
    if (phase === 'done') resumeRoom();
  }, [phase, resumeRoom]);
  // Close, Set up later and a swipe back all leave by unmounting the screen.
  useEffect(() => resumeRoom, [resumeRoom]);

  const recorder = useTakeRecorder({
    name: 'teach-voice',
    silence: i18n.t('teachVoice.refused.silence'),
    describe: describeTeachError,
    take: async (uri) => {
      const r = run.current;
      const prompt = r.sentences[r.index] ?? r.sentences[0];
      let result: VoiceTakeResult;
      try {
        result = await source.take({ fileUri: uri, prompt, profileId: member?.id ?? null, voiceMatch: r.matchOn });
      } catch (e) {
        const words = refusalWords(e, phrase);
        if (!words) throw e;
        void reject();
        setSaid(words);
        return 'again';
      }
      // This phone's wake word listens only for the voices taught on it; the take's voice is kept
      // here too while the file still exists. It never fails the take, which the Pond already has.
      if (member && r.matchOn && source === POND_VOICE) await enrolPhoneTake(uri, member.id);
      r.index += 1;
      setDetector(result.wake_detector);
      setResults((was) => [...was, { prompt, detector: result.wake.new_detector }]);
      setSaid(null);
      if (result.voice_match) setMatch(result.voice_match);
      if (r.index >= Math.min(result.of, r.sentences.length)) {
        setPhase('done');
        if (profileId) void finishChecklistItem(profileId, 'wake');
        void prints.actions.refresh();
        return 'done';
      }
      setIndex(r.index);
      return 'again';
    },
  });

  const { update } = settings.actions;
  const saved = settings.settings?.voice_wake_word?.trim() ?? '';
  const memberTakes = member ? (prints.data.members.find((m) => m.profile_id === member.id)?.takes ?? 0) : 0;

  const start = useCallback(async () => {
    setStarting(true);
    setSaid(null);
    try {
      if (!room.current.quiet && (await pauseRoom())) {
        room.current.quiet = true;
        setQuiet(true);
      }
      await recorder.start(async () => {
        // Another member's pronunciations of the same phrase stay; a new phrase starts the list again.
        if (phrase.trim() && phrase.trim() !== saved) {
          await source.resetCalibration();
          if (!(await update('voice_wake_word', phrase.trim()))) throw new Error('The wake phrase was not saved');
        }
        if (run.current.matchOn && member && memberTakes > 0) {
          await source.forget(member.id);
          if (source === POND_VOICE) await forgetPhoneVoice(member.id);
        }
        run.current.index = 0;
        setIndex(0);
        setResults([]);
        setDetector(null);
        setMatch(null);
        setPhase('takes');
      });
    } finally {
      setStarting(false);
    }
  }, [member, memberTakes, pauseRoom, phrase, recorder, saved, source, update]);

  const retry = useCallback(async () => {
    setSaid(null);
    await recorder.start();
  }, [recorder]);

  const { state } = recorder;
  const stopped = phase === 'takes' && state === 'error';
  return {
    phase,
    phrase,
    sentences,
    index,
    of: VOICE_PRINT_TAKES,
    lit: state === 'recording',
    sending: state === 'sending',
    stopped,
    said: stopped ? (recorder.error ?? said) : said,
    recorded: results.length,
    voiceMatch: { on: matchOn, available, model: prints.data.model },
    results,
    detector,
    consistency: match?.consistency ?? null,
    enrolled: match?.enrolled ?? false,
    level: recorder.level,
    supported: recorder.supported,
    starting,
    error: phase === 'intro' && state === 'error' ? recorder.error : null,
    actions: {
      setVoiceMatch: setWantMatch,
      start,
      retry,
      stop: recorder.stop,
      retryModel: prints.actions.retryModel,
    },
  };
}
