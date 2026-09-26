/**
 * What a picture costs, and what a text file becomes, before either is sent.
 * The limits are the Pond's own (`image_limits.rs`); getting them wrong here
 * means a 413 after the upload instead of a word before it.
 */

import {
  base64Bytes,
  composeMessage,
  fitLongEdge,
  MAX_TURN_IMAGE_BYTES,
  pickAttachments,
  withinTurnLimit,
  type Attachment,
} from '@/services/media';
import { isPhantom } from '@/view-models/use-voice';

// The pickers are native; only their answers matter here.
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));

const image = (bytes: number): Attachment => ({
  id: String(bytes),
  kind: 'image',
  uri: 'file:///x.jpg',
  name: 'x.jpg',
  mimeType: 'image/jpeg',
  base64: 'A'.repeat(Math.ceil((bytes * 4) / 3)),
});

describe('base64Bytes', () => {
  it('counts the decoded size, padding included', () => {
    expect(base64Bytes('TWFu')).toBe(3);
    expect(base64Bytes('TWE=')).toBe(2);
    expect(base64Bytes('TQ==')).toBe(1);
  });
});

describe('fitLongEdge', () => {
  it('shrinks a phone photo to a 1024px long edge, keeping its shape', () => {
    expect(fitLongEdge(4032, 3024)).toEqual({ width: 1024, height: 768 });
    expect(fitLongEdge(3024, 4032)).toEqual({ width: 768, height: 1024 });
  });

  it('leaves a picture that already fits alone', () => {
    expect(fitLongEdge(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('withinTurnLimit', () => {
  it('allows up to the Pond’s 8 MiB a turn, and not a byte over', () => {
    const half = MAX_TURN_IMAGE_BYTES / 2;
    expect(withinTurnLimit([image(half), image(half - 3)])).toBe(true);
    expect(withinTurnLimit([image(half), image(half + 3)])).toBe(false);
  });
});

describe('composeMessage', () => {
  it('sends a text file inside the message, under its name', () => {
    const file: Attachment = { id: 'f', kind: 'text', uri: '', name: 'notes.md', mimeType: 'text/markdown', text: '- milk' };
    expect(composeMessage('Summarise this', [file])).toBe('Summarise this\n\nnotes.md:\n```\n- milk\n```');
    expect(composeMessage('Just words', [image(10)])).toBe('Just words');
  });
});

describe('isPhantom', () => {
  it('knows what Whisper hears in an empty room', () => {
    for (const heard of ['', ' Thank you. ', '[BLANK_AUDIO]', '(music)', 'you']) {
      expect(isPhantom(heard)).toBe(true);
    }
  });

  it('keeps anything a person could have meant', () => {
    expect(isPhantom('Thank you, turn off the lights')).toBe(false);
    expect(isPhantom('What is the weather?')).toBe(false);
  });
});

describe('pickAttachments', () => {
  const documents = jest.requireMock('expo-document-picker') as { getDocumentAsync: jest.Mock };
  const images = jest.requireMock('expo-image-picker') as { launchImageLibraryAsync: jest.Mock };

  it('says a picker would not open, rather than blaming a picture', async () => {
    // What a picker still holding a request that was cut off answers every one after it.
    documents.getDocumentAsync.mockRejectedValueOnce(
      new Error('Different document picking in progress. Await other document picking first.'),
    );
    await expect(pickAttachments('files', 4)).rejects.toMatchObject({ key: 'chat.composer.pickerFailed' });

    images.launchImageLibraryAsync.mockRejectedValueOnce(new Error('Another picker is already presented'));
    await expect(pickAttachments('photos', 4)).rejects.toMatchObject({ key: 'chat.composer.pickerFailed' });
  });

  it('comes back empty when the reader backs out', async () => {
    documents.getDocumentAsync.mockResolvedValueOnce({ canceled: true, assets: null });
    await expect(pickAttachments('files', 4)).resolves.toEqual([]);

    images.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: null });
    await expect(pickAttachments('photos', 4)).resolves.toEqual([]);
  });

  it('asks for nothing when there is no room left', async () => {
    documents.getDocumentAsync.mockClear();
    await expect(pickAttachments('files', 0)).resolves.toEqual([]);
    expect(documents.getDocumentAsync).not.toHaveBeenCalled();
  });
});
