/**
 * Voice mode, as the orb shows it.
 *
 * The orb's own states, pond-desktop's names and colours: `wait` is listening
 * for speech to begin, `recording` is speech arriving, `thinking` covers the
 * transcription and the turn, `speaking` is the reply being played.
 */

export type VoiceState = 'idle' | 'wait' | 'recording' | 'thinking' | 'speaking' | 'error';

export interface VoiceSession {
  state: VoiceState;
  vuLevel: number;
  transcript: string | null;
  errorMessage: string | null;
}
