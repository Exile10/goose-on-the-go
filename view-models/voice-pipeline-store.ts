/**
 * Voice pipeline store — module-scoped, mirroring `chat-run-store.ts`'s
 * pattern (a turn's async work outlives whichever component is mounted, so
 * it can't live in `useState`).
 *
 * Orchestrates one full voice turn: record (VAD-gated) → transcribe →
 * stream a chat reply → speak it back sentence-by-sentence → auto-listen
 * for the next turn → ... → idle after `NO_SPEECH_TIMEOUT_MS` of silence.
 * Matches the backend's own turn state machine (`pond-voice/src/turn.rs`):
 * activation here is always the `PushToTalk` transition (tapping the Voice
 * Orb) rather than the `Activated` (wake-word) one — passive wake-word
 * detection isn't reachable from a phone talking to a remote server (see
 * the plan for why), so `wait`/`wake word` aren't states this pipeline ever
 * enters on its own; a tap goes straight to `recording`.
 */

import { useSyncExternalStore } from 'react';

import { api } from '@/services/api-client';
import i18n from '@/services/i18n';
import type { ChatStreamFrame } from '@/services/types';
import { voicePlayer } from '@/services/voice-player';
import { VoicePermissionError, voiceRecorder } from '@/services/voice-recorder';
import {
  checkDismissal,
  getToolAnnouncement,
  isWhisperArtifact,
  normalizeForSpeech,
  splitSentences,
  stripMarkdown,
} from '@/services/voice-text';

/** Matches the desktop client's exact auto-listen-to-wait/idle timeout. */
const NO_SPEECH_TIMEOUT_MS = 8_000;

export type VoicePipelineState = 'idle' | 'recording' | 'thinking' | 'speaking' | 'error';

export interface VoiceSnapshot {
  state: VoicePipelineState;
  vuLevel: number;
  transcript: string | null;
  errorMessage: string | null;
}

interface InternalState extends VoiceSnapshot {
  sessionId: string | null;
  /** Bumped per turn; a callback whose seq no longer matches must stop acting. */
  turnSeq: number;
  activeStream: { close: () => void } | null;
  noSpeechTimer: ReturnType<typeof setTimeout> | null;
  snapshot: VoiceSnapshot;
  subs: Set<() => void>;
}

const state: InternalState = {
  state: 'idle',
  vuLevel: 0,
  transcript: null,
  errorMessage: null,
  sessionId: null,
  turnSeq: 0,
  activeStream: null,
  noSpeechTimer: null,
  snapshot: { state: 'idle', vuLevel: 0, transcript: null, errorMessage: null },
  subs: new Set(),
};

function commit(): void {
  state.snapshot = {
    state: state.state,
    vuLevel: state.vuLevel,
    transcript: state.transcript,
    errorMessage: state.errorMessage,
  };
  state.subs.forEach((f) => f());
}

function subscribe(f: () => void): () => void {
  state.subs.add(f);
  return () => {
    state.subs.delete(f);
  };
}

function getSnapshot(): VoiceSnapshot {
  return state.snapshot;
}

export function useVoiceSnapshot(): VoiceSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function clearNoSpeechTimer(): void {
  if (state.noSpeechTimer) {
    clearTimeout(state.noSpeechTimer);
    state.noSpeechTimer = null;
  }
}

function toIdle(): void {
  clearNoSpeechTimer();
  state.state = 'idle';
  state.vuLevel = 0;
  commit();
}

/** Show an error briefly, then settle back to idle — mirrors the error banner elsewhere in the app. */
function toErrorThenIdle(message: string): void {
  clearNoSpeechTimer();
  state.state = 'error';
  state.errorMessage = message;
  state.vuLevel = 0;
  commit();
  setTimeout(() => {
    state.errorMessage = null;
    toIdle();
  }, 2000);
}

/** Entry point: tap the Voice Orb from idle. No-op if a turn is already running. */
export function startRecording(): void {
  if (state.state !== 'idle') return;
  void runTurn(false);
}

/** The `streamReply`/`speakFixedLineThenSettle` awaiting this turn's playback drain, if any. */
let pendingDrainResolve: (() => void) | null = null;

/** Tapped the orb mid-turn (or navigating away) — stop everything, back to idle. */
export function cancel(): void {
  ++state.turnSeq;
  clearNoSpeechTimer();
  voiceRecorder.cancel();
  state.activeStream?.close();
  state.activeStream = null;
  voicePlayer.setOnDrained(null);
  voicePlayer.stopAndClear();
  // Unblock whatever's awaiting `waitForPlaybackDrain()` — it would otherwise
  // hang forever, since `stopAndClear` deliberately doesn't fire `onDrained`.
  // The awaiting turn is already stale (turnSeq just moved), so it exits at
  // its next `stale()` check the moment this resumes it.
  if (pendingDrainResolve) {
    pendingDrainResolve();
    pendingDrainResolve = null;
  }
  state.sessionId = null;
  toIdle();
}

/** Wait for the TTS queue to finish playing everything enqueued so far. */
function waitForPlaybackDrain(): Promise<void> {
  return new Promise((resolve) => {
    if (!voicePlayer.isPlaying) {
      resolve();
      return;
    }
    pendingDrainResolve = resolve;
    voicePlayer.setOnDrained(() => {
      voicePlayer.setOnDrained(null);
      pendingDrainResolve = null;
      resolve();
    });
  });
}

async function runTurn(isAutoListen: boolean): Promise<void> {
  const mySeq = ++state.turnSeq;
  const stale = () => mySeq !== state.turnSeq;

  state.state = 'recording';
  state.errorMessage = null;
  state.transcript = null;
  commit();

  voiceRecorder.setOnLevel((rms) => {
    if (stale()) return;
    // `vuLevel` is a display value, not the VAD's own RMS reading — real
    // speech rarely pushes raw RMS past ~0.1-0.15, so passed straight
    // through the VU meter would barely light. Visual gain only.
    state.vuLevel = Math.min(1, rms / 0.12);
    commit();
  });

  // Only the auto-listen continuation races a silence clock — a manual tap
  // is the user's own signal that they're about to speak, so it just waits
  // out the recorder's normal 30s cap instead.
  if (isAutoListen) {
    state.noSpeechTimer = setTimeout(() => {
      if (stale()) return;
      voiceRecorder.cancel();
    }, NO_SPEECH_TIMEOUT_MS);
  }

  let wav: ArrayBuffer | null;
  try {
    wav = await voiceRecorder.start();
  } catch (e) {
    clearNoSpeechTimer();
    if (stale()) return;
    if (e instanceof VoicePermissionError) {
      toErrorThenIdle(
        e.canAskAgain ? i18n.t('voice.micNeeded') : i18n.t('voice.micDisabled'),
      );
    } else {
      toErrorThenIdle(i18n.t('voice.micStartFailed'));
    }
    return;
  }
  clearNoSpeechTimer();
  if (stale()) return;

  if (!wav) {
    // No speech confirmed — silence throughout, the 30s cap, or a cancel.
    toIdle();
    return;
  }

  state.state = 'thinking';
  state.vuLevel = 0;
  commit();

  let transcript: string;
  try {
    const res = await api.transcribe(wav);
    if (stale()) return;
    transcript = res.text;
  } catch {
    if (stale()) return;
    toErrorThenIdle(i18n.t('voice.transcribeFailed'));
    return;
  }

  if (isWhisperArtifact(transcript)) {
    toIdle();
    return;
  }

  state.transcript = transcript;
  commit();

  const dismissal = checkDismissal(transcript);
  if (dismissal.dismissed) {
    await speakFixedLineThenSettle(
      dismissal.isExit ? i18n.t('voice.farewellExit') : i18n.t('voice.farewellPause'),
      mySeq,
    );
    return;
  }

  await streamReply(transcript, mySeq);
}

/** A fixed spoken line (dismissal/exit) — no LLM turn, then the conversation ends. */
async function speakFixedLineThenSettle(line: string, mySeq: number): Promise<void> {
  const stale = () => mySeq !== state.turnSeq;

  state.state = 'speaking';
  commit();
  voicePlayer.enqueue(line);

  await waitForPlaybackDrain();
  if (stale()) return;

  state.sessionId = null;
  toIdle();
}

async function streamReply(message: string, mySeq: number): Promise<void> {
  const stale = () => mySeq !== state.turnSeq;

  let sentenceBuffer = '';
  let enqueuedAny = false;
  let networkError: string | null = null;

  const enqueueSentence = (raw: string): void => {
    const cleaned = normalizeForSpeech(stripMarkdown(raw));
    if (!cleaned.trim()) return;
    if (!enqueuedAny) {
      enqueuedAny = true;
      state.state = 'speaking';
      commit();
    }
    voicePlayer.enqueue(cleaned);
  };

  await new Promise<void>((resolve) => {
    const handle = api.streamChat(
      { message, session_id: state.sessionId ?? undefined, voice_mode: true, resumable: false },
      {
        onFrame: (frame: ChatStreamFrame) => {
          if (stale()) return;

          if ('error' in frame) {
            networkError = frame.error;
            resolve();
            return;
          }
          if ('done' in frame) {
            state.sessionId = frame.session_id;
            resolve();
            return;
          }
          if (frame.type === 'text') {
            // Synchronous through the buffer mutation and split — frames can
            // arrive faster than a sentence's TTS synthesizes, but the split
            // decision itself must never straddle an await, or an
            // interleaved frame would append to a buffer this frame already
            // meant to have flushed.
            sentenceBuffer += frame.content;
            const sentences = splitSentences(sentenceBuffer);
            if (sentences.length > 1) {
              for (let i = 0; i < sentences.length - 1; i++) enqueueSentence(sentences[i]);
              sentenceBuffer = sentences[sentences.length - 1];
            }
          } else if (frame.type === 'tool_call') {
            enqueueSentence(getToolAnnouncement(frame.tool));
          }
        },
        onNetworkError: (message) => {
          if (stale()) return;
          networkError = message;
          resolve();
        },
      },
    );
    state.activeStream = handle;
  });

  state.activeStream = null;
  if (stale()) return;

  if (sentenceBuffer.trim()) enqueueSentence(sentenceBuffer);

  if (networkError) {
    toErrorThenIdle(networkError);
    return;
  }

  await waitForPlaybackDrain();
  if (stale()) return;

  // Conversational turn-taking: listen for the next thing the user says
  // without requiring a fresh tap, same as the backend's own Think/Speak →
  // Replied → Listen transition.
  void runTurn(true);
}
