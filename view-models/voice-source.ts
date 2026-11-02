// Every room voice, Voice agent and Voice Match route goes through here, so the Developer toggle can
// swap in the mock Pond while the real one does not serve them yet.

import { createMockVoice, type VoiceSource } from '@/models/voice-mock';
import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';

import { mockAgents } from './agents-source';

export type { VoiceSource } from '@/models/voice-mock';

/** Calls `api` at call time, so a test's mock of the client is the one used. */
export const POND_VOICE: VoiceSource = {
  room: () => api.voiceRoom(),
  setRoom: (enabled) => api.setVoiceRoom(enabled),
  interrupt: () => api.interruptVoiceRoom(),
  streamRoom: (onEvent, signal, onOpen) => api.streamVoiceRoom(onEvent, signal, onOpen),
  agent: () => api.voiceAgent(),
  updateAgent: (patch) => api.updateVoiceAgent(patch),
  resetAgent: () => api.resetVoiceAgent(),
  prints: () => api.voicePrints(),
  retryModel: () => api.retryVoicePrintModel(),
  take: (take) => api.voiceTake(take),
  resetCalibration: () => api.resetWakeWordCalibration(),
  forget: (profileId) => api.forgetVoicePrints(profileId),
};

// One mock for the whole app, so the room switched off on the Voice agent page is off on Home too.
let mock: VoiceSource | null = null;

export function mockVoice(): VoiceSource {
  mock ??= createMockVoice(
    Date.now,
    async () => (await mockAgents().prefills()).agents.find((p) => p.agent === 'voice') ?? null,
    () => mockAgents().rebuild('voice'),
  );
  return mock;
}

/** For tests: the next `mockVoice()` starts from the samples again. */
export function resetMockVoice(): void {
  mock = null;
}

export function useVoiceSource(): VoiceSource {
  const { isScreenReal } = useServer();
  return isScreenReal('voice') ? POND_VOICE : mockVoice();
}
