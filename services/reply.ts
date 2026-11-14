/**
 * A reply to something earlier in the conversation: a whole message, a part of one, or a picture.
 *
 * It travels as the message's own text, a short quote ahead of what the person wrote, so the
 * model reads what is being answered and a conversation read back on any device shows it. The
 * thread draws the quote above the bubble rather than as the `>` lines it is sent as. A reply to a
 * picture also carries the picture again, since words about a photo are no use to a model that
 * cannot see it.
 */

import type { TFunction } from 'i18next';

import { attachFile, base64Bytes, MAX_IMAGE_BYTES, nextId, type Attachment } from './media';
import { loadPondImage } from './pond-images';

export type ReplyFrom = 'you' | 'goose';

/** A reply's card, in the thread and over the composer: a set share of the screen, whatever it quotes. */
export const REPLY_CARD = 0.8;

/** A picture as the thread holds it: a file on this phone, or a path on the Pond. */
export interface ReplyPicture {
  uri: string;
  local: boolean;
  /** What the picture is, when the Pond said: a caption or a credit. */
  label?: string;
}

export type ReplyTarget =
  | { kind: 'text'; from: ReplyFrom; text: string; part: boolean }
  | { kind: 'picture'; from: ReplyFrom; picture: ReplyPicture };

/** A whole message is named by its start; a part chosen on purpose is kept whole, within reason. */
const WHOLE_CHARS = 280;
const PART_CHARS = 1200;

function clip(text: string, max: number): string {
  const flat = text.trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The quote's first line, which says whose words or picture it is. */
export function replyHead(target: ReplyTarget, t: TFunction): string {
  if (target.kind === 'picture') return t(target.from === 'goose' ? 'chat.replyTo.goosePicture' : 'chat.replyTo.yourPicture');
  return t(target.from === 'goose' ? 'chat.replyTo.goose' : 'chat.replyTo.you');
}

/** What the quote says of its target: the words, clipped, or what the picture is. */
export function replyQuote(target: ReplyTarget): string {
  if (target.kind === 'picture') return target.picture.label?.trim() ?? '';
  return clip(target.text, target.part ? PART_CHARS : WHOLE_CHARS);
}

/** The message as sent: the quote as `>` lines, a blank line, then what the person wrote. */
export function withReply(head: string, quote: string, typed: string): string {
  const lines = [head, ...(quote ? quote.split('\n') : [])].map((line) => `> ${line}`.trimEnd());
  return `${lines.join('\n')}\n\n${typed.trim()}`.trimEnd();
}

/** A sent message read back: its quote, if it opens with one, and the words after it. */
export function splitReply(content: string): { head: string; quote: string; body: string } | null {
  const m = /^((?:>[^\n]*\n)+)\n([\s\S]*)$/.exec(content);
  if (!m) return null;
  const [head, ...rest] = m[1]
    .trimEnd()
    .split('\n')
    .map((line) => line.replace(/^> ?/, ''));
  return { head, quote: rest.join('\n'), body: m[2] };
}

/** The picture a reply carries, read from this phone or from the Pond; null if it cannot be. */
export async function pictureAttachment(picture: ReplyPicture): Promise<Attachment | null> {
  try {
    if (picture.local) return await attachFile(picture.uri, 'photo');
    const data = await loadPondImage(picture.uri);
    const m = /^data:([^;]+);base64,(.*)$/s.exec(data);
    if (!m || base64Bytes(m[2]) > MAX_IMAGE_BYTES) return null;
    return { id: nextId(), kind: 'image', uri: data, name: 'photo.jpg', mimeType: m[1], base64: m[2] };
  } catch {
    return null;
  }
}
