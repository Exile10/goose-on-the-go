/**
 * Audio files and PDFs from the Files picker. They go whole, for the Pond to decode and read, and
 * only within what its capabilities say it takes: an older Pond drops them and answers nothing.
 */

import type { TFunction } from 'i18next';

import { ApiError } from '@/services/api-client';
import i18n from '@/services/i18n';
import { audioTypeFor, pickAttachments, turnFileProblem, type Attachment, type FileAccepts } from '@/services/media';
import type { ModelCapabilities, SessionMessage } from '@/services/types';
import { describeTurnError, fromHistory, streamBody } from '@/view-models/use-chat';
import { fileAccepts } from '@/view-models/use-chat-senses';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ base64: jest.fn().mockResolvedValue('JVBERi0xLjc=') })),
}));
jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
// The chat view-model reaches the server provider, whose push-token module warns under jest.
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true }) }));

const picker = jest.requireMock('expo-document-picker') as { getDocumentAsync: jest.Mock };
const t = i18n.t.bind(i18n) as unknown as TFunction;

const AUDIO = ['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/flac', 'audio/ogg'];
const takesAll: FileAccepts = {
  audio: { formats: AUDIO, maxBytes: 10 * 1024 * 1024 },
  documents: { formats: ['application/pdf'], maxBytes: 20 * 1024 * 1024 },
};

function chooses(name: string, mimeType: string | undefined, size = 1024) {
  picker.getDocumentAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: `file:///cache/${name}`, name, mimeType, size }] });
}

const caps = (extra: Partial<ModelCapabilities>): ModelCapabilities => ({
  thinking: true,
  vision: true,
  audio_input: true,
  context_window_tokens: 65536,
  structured_output: true,
  tool_calling: true,
  ...extra,
});

describe('what the picker sends', () => {
  it('sends a PDF whole, under its own name', async () => {
    chooses('lease.pdf', 'application/pdf');
    await expect(pickAttachments('files', 4, takesAll)).resolves.toEqual([
      expect.objectContaining({ kind: 'document', name: 'lease.pdf', mimeType: 'application/pdf', base64: 'JVBERi0xLjc=' }),
    ]);
  });

  it('names an audio file by its extension when the picker gives no type', async () => {
    chooses('memo.m4a', undefined);
    await expect(pickAttachments('files', 4, takesAll)).resolves.toEqual([
      expect.objectContaining({ kind: 'audio', name: 'memo.m4a', mimeType: 'audio/mp4' }),
    ]);
  });

  it('says why when the Pond takes none of that kind', async () => {
    chooses('lease.pdf', 'application/pdf');
    await expect(
      pickAttachments('files', 4, { ...takesAll, documents: { refusal: 'chat.composer.pdfNeedsUpdate' } }),
    ).rejects.toMatchObject({ key: 'chat.composer.pdfNeedsUpdate' });
  });

  it('refuses a file past the Pond’s size, saying the size', async () => {
    chooses('album.flac', 'audio/flac', 40 * 1024 * 1024);
    await expect(pickAttachments('files', 4, takesAll)).rejects.toMatchObject({
      key: 'chat.composer.audioTooLarge',
      params: { limit: '10 MB' },
    });
  });

  it('refuses audio of a kind the Pond does not decode', async () => {
    chooses('call.opus', 'audio/opus');
    await expect(pickAttachments('files', 4, takesAll)).rejects.toMatchObject({ key: 'chat.composer.audioUnsupported' });
  });

  it('knows audio by extension or type', () => {
    expect(audioTypeFor('song.mp3', 'audio/mpeg', AUDIO)).toBe('audio/mpeg');
    expect(audioTypeFor('song.mp3', 'application/octet-stream', AUDIO)).toBe('audio/mpeg');
    expect(audioTypeFor('song.opus', '', AUDIO)).toBeNull();
  });
});

describe('what this Pond takes', () => {
  it('takes nothing it has not said it takes', () => {
    expect(fileAccepts(null)).toEqual({
      audio: { refusal: 'chat.composer.pondUnchecked' },
      documents: { refusal: 'chat.composer.pondUnchecked' },
    });
    expect(fileAccepts(caps({ voice_notes: 'ready' }))).toEqual({
      audio: { refusal: 'chat.composer.audioNeedsUpdate' },
      documents: { refusal: 'chat.composer.pdfNeedsUpdate' },
    });
  });

  it('takes audio only when the model hears, and PDFs whatever the model', () => {
    const attachments = {
      audio: { formats: AUDIO, max_bytes: 10, max_seconds: 300 },
      documents: { formats: ['application/pdf'], max_bytes: 20, max_per_turn: 3 },
    };
    expect(fileAccepts(caps({ voice_notes: 'ready', attachments }))).toEqual({
      audio: { formats: AUDIO, maxBytes: 10 },
      documents: { formats: ['application/pdf'], maxBytes: 20 },
    });
    expect(fileAccepts(caps({ voice_notes: 'not_ready', attachments })).audio).toEqual({ refusal: 'chat.voiceNote.addOnNotReady' });
    expect(fileAccepts(caps({ voice_notes: 'unsupported', attachments })).audio).toEqual({ refusal: 'chat.voiceNote.modelCannotHear' });
  });
});

describe('a turn with files', () => {
  const file = (kind: Attachment['kind'], name: string, mimeType: string): Attachment => ({
    id: name,
    kind,
    uri: `file:///cache/${name}`,
    name,
    mimeType,
    base64: 'QUJD',
  });

  it('carries PDFs under their names and the audio file as the recording', () => {
    expect(streamBody('Summarise these', [file('document', 'lease.pdf', 'application/pdf'), file('audio', 'memo.m4a', 'audio/mp4')], {}, 's1')).toMatchObject({
      message: 'Summarise these',
      documents: [{ data: 'QUJD', mime_type: 'application/pdf', name: 'lease.pdf' }],
      audio: [{ data: 'QUJD', mime_type: 'audio/mp4' }],
    });
  });

  it('holds one recording and the Pond’s number of PDFs', () => {
    const memo = file('audio', 'memo.m4a', 'audio/mp4');
    expect(turnFileProblem([memo, { ...memo, id: 'b' }], 3)).toBe('chat.composer.oneAudio');
    const pdf = file('document', 'a.pdf', 'application/pdf');
    expect(turnFileProblem([pdf, pdf, pdf, pdf], 3)).toBe('chat.composer.tooManyPdfs');
    expect(turnFileProblem([memo, pdf], 3)).toBeNull();
  });

  it('reads a PDF back as its name, not the Pond’s mark', () => {
    const row = { id: 'm1', session_id: 's1', role: 'user', content: 'Summarise this\n[Document: lease.pdf]', created_at: '2026-11-07T10:00:00Z' } as SessionMessage;
    expect(fromHistory([row])[0].content).toBe('Summarise this\nlease.pdf');
  });

  it('says what a refused PDF or recording needs', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const refusal = (status: number, code: string) => new ApiError('POST → refused', status, null, 'English', { code });
    expect(describeTurnError(refusal(422, 'document_no_text'), t)).toBe('That PDF has no text in it to read, only pictures of pages.');
    expect(describeTurnError(refusal(400, 'document_invalid'), t)).toBe(
      'Your Pond could not open that PDF. It may be locked with a password, or damaged.',
    );
    expect(describeTurnError(refusal(413, 'audio_too_long'), t)).toBe('That audio file runs longer than your Pond listens to in one message.');
    jest.restoreAllMocks();
  });
});
