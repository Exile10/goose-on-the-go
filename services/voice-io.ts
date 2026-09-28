/**
 * The microphone and the speaker, for voice mode.
 *
 * `expo-audio` is loaded lazily, like the pickers in `media.ts`: a development
 * build made before it was added has no native half, and a top-level import
 * would take the whole app down at launch rather than just voice mode. When it
 * is missing, `voiceSupported()` says so and the hook below records nothing.
 *
 * Capture is a PCM stream rather than a recording. The Pond transcribes WAV
 * only, Android's recorder cannot write one, and a stream hands over the
 * samples as they arrive — which is also what the orb and the end-of-speech
 * detector need. `speech.ts` does the arithmetic.
 */

import { File, Paths } from 'expo-file-system';

type Audio = typeof import('expo-audio');
type StreamBuffer = import('expo-audio').AudioStreamBuffer;
type Player = import('expo-audio').AudioPlayer;

function load(): Audio | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-audio') as Audio;
  } catch {
    return null;
  }
}

const audio = load();

export function voiceSupported(): boolean {
  return audio !== null;
}

export interface MicBuffer {
  samples: Int16Array;
  sampleRate: number;
}

/**
 * A microphone stream, as a hook, because that is the shape `expo-audio`
 * offers it in. Asks for 16 kHz 16-bit mono; `sampleRate` on each buffer is
 * what the hardware actually delivered, which on some phones is 48 kHz.
 *
 * Without the native module it is an inert stand-in, chosen once at load so
 * the hooks called are the same on every render.
 */
export const useMicStream: (onBuffer: (buffer: MicBuffer) => void) => {
  start: () => Promise<void>;
  stop: () => void;
} = audio
  ? (onBuffer) => {
      const { stream } = audio.useAudioStream({
        sampleRate: 16_000,
        channels: 1,
        encoding: 'int16',
        onBuffer: (buffer: StreamBuffer) => {
          // Mixed down here if the device insisted on stereo: speech is mono.
          const raw = new Int16Array(buffer.data);
          if (buffer.channels <= 1) {
            onBuffer({ samples: raw, sampleRate: buffer.sampleRate });
            return;
          }
          const mono = new Int16Array(Math.floor(raw.length / buffer.channels));
          for (let i = 0; i < mono.length; i += 1) {
            let sum = 0;
            for (let c = 0; c < buffer.channels; c += 1) sum += raw[i * buffer.channels + c];
            mono[i] = Math.round(sum / buffer.channels);
          }
          onBuffer({ samples: mono, sampleRate: buffer.sampleRate });
        },
      });
      return {
        start: () => stream.start(),
        stop: () => stream.stop(),
      };
    }
  : () => ({ start: async () => {}, stop: () => {} });

/** The microphone answer, and whether asking a second time can still help. */
export interface MicPermission {
  granted: boolean;
  /**
   * False once the OS has stopped showing the prompt — a second refusal on
   * Android, any refusal on iOS. `requestRecordingPermissionsAsync` then
   * returns instantly and silently, so a caller that only reads `granted`
   * leaves the user tapping a control that can never work. Only the Settings
   * app can undo it.
   */
  canAskAgain: boolean;
}

/** Ask for the microphone. Refused, or no audio module at all, is not granted. */
export async function requestMicrophone(): Promise<MicPermission> {
  if (!audio) return { granted: false, canAskAgain: false };
  const permission = await audio.requestRecordingPermissionsAsync();
  return { granted: permission.granted, canAskAgain: permission.canAskAgain };
}

/**
 * Put the audio session in the state voice mode needs: recording allowed,
 * audible in silent mode, and out of the loudspeaker rather than the earpiece
 * — a phone held at arm's length for a conversation is not held to an ear.
 */
export async function beginVoiceSession(): Promise<void> {
  if (!audio) return;
  await audio.setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    shouldRouteThroughEarpiece: false,
    interruptionMode: 'doNotMix',
  });
}

/** Hand the audio session back, so other apps' sound resumes. */
export async function endVoiceSession(): Promise<void> {
  if (!audio) return;
  await audio.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
}

let written = 0;

/** Bytes to a fresh file in the cache, for an upload or a player. */
export function cacheFile(prefix: string, bytes: Uint8Array): string {
  written += 1;
  const file = new File(Paths.cache, `${prefix}-${Date.now().toString(36)}-${written}.wav`);
  file.create({ overwrite: true });
  file.write(bytes);
  return file.uri;
}

export function discardFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone, or the cache was cleared under it; either way it is not here.
  }
}

/**
 * Play a WAV to its end. `onTime` reports the playhead in seconds, often
 * enough to drive the orb; the returned `stop` ends it early. Resolves when
 * playback finishes or is stopped.
 */
export function playFile(
  uri: string,
  onTime: (seconds: number) => void,
): { done: Promise<void>; stop: () => void } {
  if (!audio) return { done: Promise.resolve(), stop: () => {} };
  let player: Player | null = audio.createAudioPlayer({ uri }, { updateInterval: 50 });
  let settle: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const finish = () => {
    if (!player) return;
    sub.remove();
    player.remove();
    player = null;
    settle();
  };
  const sub = player.addListener('playbackStatusUpdate', (status) => {
    onTime(status.currentTime);
    if (status.didJustFinish) finish();
  });
  player.play();
  return {
    done,
    stop: () => {
      player?.pause();
      finish();
    },
  };
}
