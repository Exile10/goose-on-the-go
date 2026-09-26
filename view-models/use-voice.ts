/**
 * Voice ViewModel — thin wrapper around `voice-pipeline-store`'s real
 * mic → transcribe → stream → speak pipeline.
 *
 * The state machine, VAD, and TTS queueing all live in the module-scoped
 * store (same reasoning as `chat-run-store.ts`: a voice turn can outlive
 * whichever screen opened it). This hook is just a `useSyncExternalStore`
 * subscription plus the same `{data, actions}` shape callers already use.
 */

import type { VoiceState } from '@/models/voice';
import { cancel, startRecording, useVoiceSnapshot } from '@/view-models/voice-pipeline-store';

export function useVoice() {
  const snapshot = useVoiceSnapshot();

  return {
    data: {
      state: snapshot.state as VoiceState,
      vuLevel: snapshot.vuLevel,
      transcript: snapshot.transcript,
      errorMessage: snapshot.errorMessage,
    },
    actions: {
      startRecording,
      stop: cancel,
    },
  };
}
