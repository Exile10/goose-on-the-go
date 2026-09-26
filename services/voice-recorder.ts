/**
 * Real mic capture + voice-activity-detection for the voice pipeline.
 *
 * `expo-audio`'s real-time PCM capture (`AudioStream`) is only reachable
 * through the `useAudioStream` React hook — there's no standalone imperative
 * constructor in the public API. So this module is a singleton *engine* that
 * a small bridge component (`components/voice-audio-bridge.tsx`, mounted
 * once near the app root) feeds native PCM buffers into via `pushBuffer()`.
 * Everything else here — the VAD state machine, WAV encoding, permission
 * check — is plain, testable TypeScript with no direct RN dependency.
 */

import type { AudioStream, AudioStreamBuffer } from 'expo-audio';
import { getRecordingPermissionsAsync } from 'expo-audio';

import { DEFAULT_VAD_CONFIG, advanceVad, calculateRms, createVadState, downsampleTo16k, encodeWav, type VadState } from './voice-dsp';

/** Thrown by `start()` when the mic permission isn't granted. */
export class VoicePermissionError extends Error {
  constructor(public readonly canAskAgain: boolean) {
    super('Microphone permission not granted');
    this.name = 'VoicePermissionError';
  }
}

class VoiceRecorderEngine {
  private stream: AudioStream | null = null;
  private vadState: VadState = createVadState();
  private chunks: Float32Array[] = [];
  private startedAt = 0;
  private recording = false;
  private resolveFn: ((wav: ArrayBuffer | null) => void) | null = null;
  private onLevel: ((rms: number) => void) | null = null;

  /** Called once by the bridge component on mount. */
  attachStream(stream: AudioStream): void {
    this.stream = stream;
  }

  /** Live RMS level while recording — feeds the VU meter. `null` clears it. */
  setOnLevel(cb: ((rms: number) => void) | null): void {
    this.onLevel = cb;
  }

  /**
   * Start recording, resolving once VAD detects end-of-speech, the 30s cap
   * is hit, or `cancel()` is called. Resolves `null` if no speech was ever
   * confirmed (silence throughout) or the recording was cancelled.
   */
  async start(): Promise<ArrayBuffer | null> {
    const permission = await getRecordingPermissionsAsync();
    if (!permission.granted) {
      throw new VoicePermissionError(permission.canAskAgain);
    }
    if (!this.stream) {
      throw new Error('voice recorder: audio stream not attached yet');
    }

    this.vadState = createVadState();
    this.chunks = [];
    this.startedAt = Date.now();
    this.recording = true;

    await this.stream.start();

    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  /** Called by the bridge's `onBuffer` for every native PCM chunk. */
  pushBuffer(buffer: AudioStreamBuffer): void {
    if (!this.recording) return;

    const samples = new Float32Array(buffer.data);
    this.chunks.push(samples);

    const rms = calculateRms(samples);
    this.onLevel?.(rms);

    const now = Date.now();
    const vadStop = advanceVad(this.vadState, rms, now, DEFAULT_VAD_CONFIG);
    const capped = now - this.startedAt >= DEFAULT_VAD_CONFIG.maxDurationMs;
    if (vadStop || capped) {
      this.finish();
    }
  }

  /** User tapped the orb again mid-recording, or the pipeline is aborting — no turn results. */
  cancel(): void {
    if (!this.recording) return;
    this.finish(/* forceNull */ true);
  }

  private finish(forceNull = false): void {
    this.recording = false;
    this.stream?.stop();
    this.onLevel?.(0);

    const resolve = this.resolveFn;
    this.resolveFn = null;
    if (!resolve) return;

    if (forceNull || !this.vadState.speechConfirmed) {
      this.chunks = [];
      resolve(null);
      return;
    }

    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];

    // Available only once the stream has started — falls back to the
    // requested rate if the native side hasn't reported one yet.
    const actualRate = this.stream?.sampleRate || 16000;
    const downsampled = downsampleTo16k(merged, actualRate);
    resolve(encodeWav(downsampled, 16000));
  }
}

/** One recorder for the whole app — voice is a single, app-wide concern. */
export const voiceRecorder = new VoiceRecorderEngine();
