/**
 * Sequential TTS playback queue for the voice pipeline.
 *
 * Mirrors the desktop client's `playNext`/`enqueue` pattern
 * (`pond-desktop/src/modes/voice/WebVoiceBackend.ts`): the queue holds
 * sentence *text*, not audio — synthesis for a sentence only happens once
 * it's that sentence's turn to play, strictly one clip at a time. That's
 * what keeps playback order correct: enqueuing eagerly-synthesized audio
 * instead would let a slow `/tts` call for an earlier sentence lose a race
 * against a fast one for a later sentence. The caller can still enqueue new
 * sentences concurrently as more SSE tokens arrive — synthesis/playback of
 * sentence N overlaps with the stream still producing sentence N+1.
 *
 * `/api/v1/tts` returns raw WAV bytes, and `expo-audio`'s `AudioSource` needs
 * a URI rather than raw bytes, so each sentence's audio is written to a
 * cache file before playback and deleted once its turn is done.
 */

import { createAudioPlayer, type AudioEvents, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';

import { api } from './api-client';

/**
 * `AudioPlayer` extends `SharedObject<AudioEvents>`, but this version of
 * `expo-modules-core`'s typings don't carry `EventEmitter`'s `addListener`
 * through that generic re-export chain — it's still there and works at
 * runtime (the same base class `useAudioStream`'s `AudioStream.addListener`
 * uses), the types just don't resolve. Narrow, local workaround rather than
 * fighting the whole declaration chain.
 */
interface PlaybackStatusEmitter {
  addListener(eventName: 'playbackStatusUpdate', listener: AudioEvents['playbackStatusUpdate']): { remove(): void };
}

class VoicePlayerEngine {
  private player: AudioPlayer | null = null;
  private queue: string[] = [];
  private lastPlayed: File | null = null;
  private playing = false;
  private fileCounter = 0;
  private onDrained: (() => void) | null = null;
  /** Bumped by `stopAndClear` so an in-flight `/tts` call from before a cancel can't play into a new turn. */
  private generation = 0;

  /** Fires when the queue naturally empties (not on `stopAndClear`'s cancel). */
  setOnDrained(cb: (() => void) | null): void {
    this.onDrained = cb;
  }

  private ensurePlayer(): AudioPlayer {
    if (!this.player) {
      this.player = createAudioPlayer();
      (this.player as unknown as PlaybackStatusEmitter).addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) void this.advance();
      });
    }
    return this.player;
  }

  /** Queue a sentence for playback — synthesized only once it reaches the front. */
  enqueue(text: string): void {
    if (!text.trim()) return;
    this.queue.push(text);
    if (!this.playing) void this.advance();
  }

  /** True while a clip is playing or queued sentences remain. */
  get isPlaying(): boolean {
    return this.playing;
  }

  private async advance(gen: number = this.generation): Promise<void> {
    if (gen !== this.generation) return; // superseded by a stopAndClear since this call was scheduled

    this.deleteQuietly(this.lastPlayed);
    this.lastPlayed = null;

    const nextText = this.queue.shift();
    if (!nextText) {
      this.playing = false;
      this.onDrained?.();
      return;
    }
    this.playing = true;

    try {
      const wav = await api.synthesizeSpeech(nextText);
      // A cancel (and possibly a whole new turn) may have landed while the
      // /tts request was in flight — `playing` alone can't tell the two
      // apart, since a new turn sets it back to true.
      if (gen !== this.generation) return;

      const file = new File(Paths.cache, `voice-tts-${Date.now()}-${this.fileCounter++}.wav`);
      file.write(new Uint8Array(wav));
      this.lastPlayed = file;
      const player = this.ensurePlayer();
      player.replace(file.uri);
      player.play();
    } catch {
      // Synthesis failed for this sentence — skip it, the conversation keeps going.
      if (gen === this.generation) void this.advance(gen);
    }
  }

  /** Barge-in/cancel: stop immediately and drop everything queued. */
  stopAndClear(): void {
    this.generation++;
    this.playing = false;
    this.player?.pause();
    this.deleteQuietly(this.lastPlayed);
    this.lastPlayed = null;
    this.queue = [];
  }

  private deleteQuietly(file: File | null): void {
    if (!file) return;
    try {
      file.delete();
    } catch {
      // Best-effort cleanup — the OS reclaims the cache dir regardless.
    }
  }
}

/** One player for the whole app — voice is a single, app-wide concern. */
export const voicePlayer = new VoicePlayerEngine();
