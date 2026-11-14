// A reply travels as its message's text, a quote ahead of the words, and reads back as the quote
// and the words apart; a reply to a picture carries the picture again.

import { pictureAttachment, replyQuote, splitReply, withReply } from '../reply';
import { attachFile } from '../media';
import { loadPondImage } from '../pond-images';

jest.mock('../media', () => ({
  ...jest.requireActual('../media'),
  attachFile: jest.fn(),
}));
jest.mock('../pond-images', () => ({ loadPondImage: jest.fn() }));
jest.mock('../api-client', () => ({ api: {} }));

describe('a reply as text', () => {
  it('quotes the words as > lines ahead of what was written, and reads back apart', () => {
    const sent = withReply('Goose said:', 'Jarida builds privacy-first software.\nIn Nairobi.', 'Who funds it?');
    expect(sent).toBe('> Goose said:\n> Jarida builds privacy-first software.\n> In Nairobi.\n\nWho funds it?');
    expect(splitReply(sent)).toEqual({
      head: 'Goose said:',
      quote: 'Jarida builds privacy-first software.\nIn Nairobi.',
      body: 'Who funds it?',
    });
  });

  it('names a whole message by its start, and keeps a chosen part whole', () => {
    const long = 'word '.repeat(200);
    expect(replyQuote({ kind: 'text', from: 'goose', text: long, part: false })).toHaveLength(280);
    expect(replyQuote({ kind: 'text', from: 'goose', text: long.slice(0, 900), part: true })).toBe(long.slice(0, 900).trim());
  });

  it('reads a message without a quote as having none', () => {
    expect(splitReply('Just a question.')).toBeNull();
    expect(splitReply('> a quote with nothing after it')).toBeNull();
  });
});

describe('a reply to a picture', () => {
  it("carries a picture on this phone, prepared as any picked one is", async () => {
    jest.mocked(attachFile).mockResolvedValueOnce({ id: 'a', kind: 'image', uri: 'file://x.jpg', name: 'photo.jpg', mimeType: 'image/jpeg', base64: 'QUJD' });
    expect(await pictureAttachment({ uri: 'file://x.jpg', local: true })).toMatchObject({ kind: 'image', base64: 'QUJD' });
  });

  it("carries one the Pond holds, read through the Pond's connection", async () => {
    jest.mocked(loadPondImage).mockResolvedValueOnce('data:image/png;base64,QUJD');
    expect(await pictureAttachment({ uri: '/api/v1/attachments/1', local: false })).toMatchObject({
      kind: 'image',
      mimeType: 'image/png',
      base64: 'QUJD',
      uri: 'data:image/png;base64,QUJD',
    });
  });

  it('carries nothing when the picture cannot be read', async () => {
    jest.mocked(loadPondImage).mockRejectedValueOnce(new Error('gone'));
    expect(await pictureAttachment({ uri: '/api/v1/attachments/2', local: false })).toBeNull();
  });
});
