/**
 * Audio DSP for the voice pipeline — WAV encoding and RMS-based voice
 * activity detection (VAD).
 *
 * Ported from goose-in-a-pond's desktop voice pipeline
 * (`pond-desktop/src/modes/voice/webAudioUtils.ts`), which is itself a port
 * of the server's `pond-voice/src/dsp.rs`. Pure functions, no RN/Expo APIs —
 * `services/voice-recorder.ts` is the only caller, and it supplies real PCM
 * samples from `expo-audio`'s `useAudioStream`.
 */

// ── WAV Encoding ──────────────────────────────────────────────────

/**
 * Encode raw Float32 PCM samples as a 16-bit mono WAV file.
 *
 * Produces a complete RIFF/WAVE binary (44-byte header + PCM data) that
 * the pond-server `/api/v1/transcribe` endpoint accepts as `audio/wav`.
 *
 * @param samples  Raw PCM samples in the range [-1, 1]
 * @param sampleRate  Sample rate in Hz (should be 16000)
 * @returns ArrayBuffer containing a valid WAV file
 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM samples — clamp to 16-bit signed integer range
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// ── RMS Calculation ───────────────────────────────────────────────

/**
 * Root Mean Square of a PCM buffer — a 0..~1 amplitude reading, used both
 * for VAD speech detection and the live VU meter level.
 */
export function calculateRms(data: Float32Array): number {
  if (data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * data[i];
  }
  return Math.sqrt(sum / data.length);
}

// ── VAD Configuration ─────────────────────────────────────────────

/** Thresholds for voice activity detection. */
export interface VadConfig {
  /** RMS level above which speech is considered active. */
  speechOnsetThreshold: number;
  /** Minimum duration in ms of sustained level to confirm speech onset. */
  speechOnsetDurationMs: number;
  /** RMS level below which silence is detected after speech. */
  silenceThreshold: number;
  /** Duration of silence in ms before recording stops. */
  silenceTimeoutMs: number;
  /** Maximum recording duration in ms — a hard cap regardless of VAD state. */
  maxDurationMs: number;
}

/**
 * Matches the desktop client's `DEFAULT_VAD_CONFIG` — close to the backend's
 * own `pond-adapters-whisper` onset/silence RMS constants (0.010 / 0.005).
 */
export const DEFAULT_VAD_CONFIG: VadConfig = {
  speechOnsetThreshold: 0.01,
  speechOnsetDurationMs: 60,
  silenceThreshold: 0.005,
  silenceTimeoutMs: 400,
  maxDurationMs: 30_000,
};

// ── VAD State Machine ─────────────────────────────────────────────

export type VadPhase = 'waiting' | 'speech' | 'trailing_silence';

export interface VadState {
  phase: VadPhase;
  /** Timestamp when speech onset was first detected (for onset duration check). */
  onsetStart: number | null;
  /** Timestamp when trailing silence began. */
  silenceStart: number | null;
  /** Whether any speech was confirmed during this recording. */
  speechConfirmed: boolean;
}

export function createVadState(): VadState {
  return {
    phase: 'waiting',
    onsetStart: null,
    silenceStart: null,
    speechConfirmed: false,
  };
}

/**
 * Advance the VAD state machine with a new RMS reading.
 *
 * @returns `true` if the recording should stop (end-of-speech via trailing
 * silence). Mutates `state` in place — callers own the `now` clock (real
 * timestamps in production, synthetic ones in tests).
 */
export function advanceVad(state: VadState, rms: number, now: number, config: VadConfig): boolean {
  switch (state.phase) {
    case 'waiting':
      if (rms >= config.speechOnsetThreshold) {
        if (state.onsetStart === null) {
          state.onsetStart = now;
        } else if (now - state.onsetStart >= config.speechOnsetDurationMs) {
          // Speech onset confirmed
          state.phase = 'speech';
          state.speechConfirmed = true;
          state.onsetStart = null;
        }
      } else {
        state.onsetStart = null;
      }
      return false;

    case 'speech':
      if (rms < config.silenceThreshold) {
        state.phase = 'trailing_silence';
        state.silenceStart = now;
      }
      return false;

    case 'trailing_silence':
      if (rms >= config.speechOnsetThreshold) {
        // Speech resumed — go back to speech phase
        state.phase = 'speech';
        state.silenceStart = null;
        return false;
      }
      if (state.silenceStart !== null && now - state.silenceStart >= config.silenceTimeoutMs) {
        // Silence timeout — end of speech
        return true;
      }
      return false;

    default:
      return false;
  }
}

// ── Resampling ────────────────────────────────────────────────────

/**
 * Downsample audio to 16kHz via linear interpolation. `useAudioStream` is
 * asked for 16kHz directly, but the actual delivered rate can differ by
 * device/OS, so this stays a defensive no-op when it already matches.
 */
export function downsampleTo16k(buffer: Float32Array, fromRate: number): Float32Array {
  if (fromRate === 16000) return buffer;
  const ratio = fromRate / 16000;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIdx = i * ratio;
    const low = Math.floor(srcIdx);
    const high = Math.min(low + 1, buffer.length - 1);
    const frac = srcIdx - low;
    result[i] = buffer[low] * (1 - frac) + buffer[high] * frac;
  }
  return result;
}
