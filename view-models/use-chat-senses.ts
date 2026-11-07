/**
 * What the model serving chat takes in besides words. Read each time the conversation comes into
 * view, because it changes under it: a model's picture and sound add-on finishing its download is
 * what turns voice notes on.
 */

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';
import type { ModelCapabilities, VoiceNoteSupport } from '@/services/types';

/** `update` is a Pond that predates voice notes: it would drop the sound and answer an empty turn. */
export type VoiceNoteReadiness = VoiceNoteSupport | 'update';

export interface ChatSenses {
  /** Unknown is null, and treated as yes: the Pond's own refusal is clearer than a guess. */
  vision: boolean | null;
  voiceNotes: VoiceNoteReadiness | null;
}

const READINESS: readonly VoiceNoteSupport[] = ['ready', 'not_ready', 'unsupported'];

export function voiceNoteReadiness(caps: Pick<ModelCapabilities, 'voice_notes'>): VoiceNoteReadiness {
  return caps.voice_notes && READINESS.includes(caps.voice_notes) ? caps.voice_notes : 'update';
}

export function useChatSenses(): ChatSenses {
  const { hydrated } = useServer();
  const [senses, setSenses] = useState<ChatSenses>({ vision: null, voiceNotes: null });
  useFocusEffect(
    useCallback(() => {
      if (!hydrated) return;
      let live = true;
      api
        .modelCapabilities()
        .then((caps) => {
          if (live) setSenses({ vision: caps.vision, voiceNotes: voiceNoteReadiness(caps) });
        })
        .catch(() => {
          // Leave what was known; an unreachable Pond is already on the banner.
        });
      return () => {
        live = false;
      };
    }, [hydrated]),
  );
  return senses;
}
