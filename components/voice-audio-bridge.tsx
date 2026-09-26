/**
 * VoiceAudioBridge — mounts `expo-audio`'s real-time mic capture and hands
 * every native PCM buffer to `voiceRecorder`.
 *
 * `useAudioStream` is a React hook (there's no standalone imperative
 * constructor in the public `expo-audio` API), but `voiceRecorder` and
 * `voicePlayer` need to be reachable from plain module-scope code
 * (`view-models/voice-pipeline-store.ts`, mirroring `chat-run-store.ts`'s
 * pattern). This component is the bridge between the two worlds — mount it
 * once near the app root (see `app/_layout.tsx`) and nothing else needs to
 * know `expo-audio`'s hook exists.
 *
 * Creating the native stream here is cheap and starts no capture on its
 * own — the mic only actually turns on when `voiceRecorder.start()` calls
 * `stream.start()`.
 */

import { useEffect } from 'react';
import { useAudioStream } from 'expo-audio';

import { voiceRecorder } from '@/services/voice-recorder';

export function VoiceAudioBridge() {
  const { stream } = useAudioStream({
    sampleRate: 16000,
    channels: 1,
    encoding: 'float32',
    onBuffer: (buffer) => voiceRecorder.pushBuffer(buffer),
  });

  useEffect(() => {
    voiceRecorder.attachStream(stream);
  }, [stream]);

  return null;
}
