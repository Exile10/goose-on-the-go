/**
 * What the model serving chat takes in besides words. Read each time the conversation comes into
 * view, because it changes under it: a model's picture and sound add-on finishing its download is
 * what turns voice notes on.
 */

import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';
import type { FileAccepts } from '@/services/media';
import type { ModelCapabilities, VoiceNoteSupport } from '@/services/types';

/** `update` is a Pond that predates voice notes: it would drop the sound and answer an empty turn. */
export type VoiceNoteReadiness = VoiceNoteSupport | 'update';

export interface ChatSenses {
  /** Unknown is null, and treated as yes: the Pond's own refusal is clearer than a guess. */
  vision: boolean | null;
  voiceNotes: VoiceNoteReadiness | null;
  files: FileAccepts;
  /** PDFs in one message; nothing is refused for it until the Pond has said. */
  maxPdfs: number;
}

const READINESS: readonly VoiceNoteSupport[] = ['ready', 'not_ready', 'unsupported'];

export function voiceNoteReadiness(caps: Pick<ModelCapabilities, 'voice_notes'>): VoiceNoteReadiness {
  return caps.voice_notes && READINESS.includes(caps.voice_notes) ? caps.voice_notes : 'update';
}

/** What the Files picker may send this Pond, or why not; unknown refuses, since an old Pond drops files. */
export function fileAccepts(caps: ModelCapabilities | null): FileAccepts {
  if (!caps) return { audio: { refusal: 'chat.composer.pondUnchecked' }, documents: { refusal: 'chat.composer.pondUnchecked' } };
  const audio = caps.attachments?.audio;
  const documents = caps.attachments?.documents;
  const hears = voiceNoteReadiness(caps);
  return {
    audio: !audio
      ? { refusal: 'chat.composer.audioNeedsUpdate' }
      : hears === 'ready'
        ? { formats: audio.formats, maxBytes: audio.max_bytes }
        : { refusal: hears === 'not_ready' ? 'chat.voiceNote.addOnNotReady' : hears === 'unsupported' ? 'chat.voiceNote.modelCannotHear' : 'chat.composer.audioNeedsUpdate' },
    documents: documents?.formats.includes('application/pdf')
      ? { formats: documents.formats, maxBytes: documents.max_bytes }
      : { refusal: 'chat.composer.pdfNeedsUpdate' },
  };
}

export function useChatSenses(): ChatSenses {
  const { hydrated } = useServer();
  const [caps, setCaps] = useState<ModelCapabilities | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!hydrated) return;
      let live = true;
      api
        .modelCapabilities()
        .then((next) => {
          if (live) setCaps(next);
        })
        .catch(() => {
          // Leave what was known; an unreachable Pond is already on the banner.
        });
      return () => {
        live = false;
      };
    }, [hydrated]),
  );
  return useMemo(
    () => ({
      vision: caps ? caps.vision : null,
      voiceNotes: caps ? voiceNoteReadiness(caps) : null,
      files: fileAccepts(caps),
      maxPdfs: caps?.attachments?.documents?.max_per_turn ?? Number.POSITIVE_INFINITY,
    }),
    [caps],
  );
}
