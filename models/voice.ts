/** Voice mode types */

export type VoiceState =
  | 'idle'
  | 'waiting'
  | 'recording'
  | 'thinking'
  | 'speaking'
  | 'error';

export interface VoiceSession {
  state: VoiceState;
  vuLevel: number;
  transcript: string | null;
  errorMessage: string | null;
}
