// A voice note reaches the model as sound, against goose-in-a-pond#817: the WAV rides on the turn
// with no transcript, a Pond that would not hear it is known before anyone records, its refusals
// read as what to do, and the mark the Pond keeps reads back as a note.

import type { TFunction } from 'i18next';

import { ApiError } from '@/services/api-client';
import i18n from '@/services/i18n';
import { bytesToBase64, type Attachment } from '@/services/media';
import type { SessionMessage } from '@/services/types';
import { describeTurnError, fromHistory, streamBody } from '@/view-models/use-chat';
import { voiceNoteReadiness } from '@/view-models/use-chat-senses';
import { spokenClip } from '@/view-models/use-voice';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));

const t = i18n.t.bind(i18n) as unknown as TFunction;

const note: Attachment = {
  id: 'voice-1',
  kind: 'audio',
  uri: 'file:///cache/voice-note-1.wav',
  name: 'voice-note.wav',
  mimeType: 'audio/wav',
  base64: 'UklGRg==',
  durationMs: 2400,
};

function row(content: string, role: SessionMessage['role'] = 'user'): SessionMessage {
  return { id: `m-${content.length}`, session_id: 's1', role, content, created_at: '2026-11-07T10:00:00Z' } as SessionMessage;
}

describe('a spoken turn in voice mode', () => {
  it('sends the recording with the words beside it, never as the message', () => {
    const clip = spokenClip('what time is it', new Uint8Array([82, 73, 70, 70]), 1200);
    expect(streamBody('what time is it', [clip], { voice: true }, 's1')).toEqual({
      message: '',
      session_id: 's1',
      audio: [{ data: 'UklGRg==', mime_type: 'audio/wav', heard_as: 'what time is it' }],
      voice_mode: true,
      resumable: true,
    });
  });
});

describe('the turn a voice note goes in', () => {
  it('carries the recording itself and no words', () => {
    expect(streamBody('', [note], {}, 's1')).toEqual({
      message: '',
      session_id: 's1',
      audio: [{ data: 'UklGRg==', mime_type: 'audio/wav' }],
      voice_mode: false,
      resumable: true,
    });
  });

  it('sends no audio field on a turn without a note, as older Ponds expect', () => {
    expect('audio' in streamBody('Hello', [], {}, 's1')).toBe(false);
  });
});

describe('whether the Pond would hear it', () => {
  it('takes the Pond at its word when it says', () => {
    expect(voiceNoteReadiness({ voice_notes: 'ready' })).toBe('ready');
    expect(voiceNoteReadiness({ voice_notes: 'not_ready' })).toBe('not_ready');
    expect(voiceNoteReadiness({ voice_notes: 'unsupported' })).toBe('unsupported');
  });

  it('calls a Pond that says nothing out of date, whatever its older audio flag claims', () => {
    expect(voiceNoteReadiness({})).toBe('update');
    expect(voiceNoteReadiness({ voice_notes: 'someday' as never })).toBe('update');
  });
});

describe('a refused note', () => {
  // A failed turn is logged as it is put into words.
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());
  const refusal = (code: string) => new ApiError('POST /api/v1/chat/stream → 409', 409, null, 'English', { code });

  it('says what would let the model hear it', () => {
    expect(describeTurnError(refusal('audio_not_ready'), t)).toBe(
      "Your Pond's model will hear voice notes once its picture and sound add-on is ready.",
    );
    expect(describeTurnError(refusal('audio_unsupported'), t)).toBe(
      "The model your Pond is using can't listen to voice notes. Gemma 4 E2B and E4B can.",
    );
    expect(describeTurnError(refusal('audio_invalid'), t)).toBe('Your Pond could not read that voice note. Try recording it again.');
  });
});

describe('a note read back from the Pond', () => {
  it('is a note with nothing to play, not the mark the Pond saved', () => {
    const [alone, typed] = fromHistory([row('[Voice note]'), row('About the roof\n[Voice note]')]);
    expect(alone).toMatchObject({ content: '', voice: { uri: '', durationMs: 0 } });
    expect(typed).toMatchObject({ content: 'About the roof', voice: { uri: '' } });
  });

  it('leaves the mark alone in anything but the reader’s own message', () => {
    const [reply] = fromHistory([row('[Voice note]', 'assistant')]);
    expect(reply.content).toBe('[Voice note]');
    expect(reply.voice).toBeUndefined();
  });
});

describe('the recording as base64', () => {
  it('survives the trip at the size of a minute of speech', () => {
    const bytes = Uint8Array.from({ length: 70_001 }, (_, i) => (i * 31) % 256);
    expect(Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0))).toEqual(bytes);
  });
});
