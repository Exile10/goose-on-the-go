/**
 * Pictures and files for a message: Camera, Photos, Files.
 *
 * Every picture is re-encoded before it is sent, whatever it was. The Pond takes
 * JPEG, PNG, WebP, GIF or BMP, at most 4 MiB each and 8 MiB a turn, and a phone
 * photo is usually a 12-megapixel HEIC — the wrong format, and three times too
 * big even once converted. pond-desktop resizes anything past a 1024px long
 * edge to a JPEG at 0.85 (`lib/imageAttach.ts`); this does the same for every
 * picture, because on a phone that is every picture.
 *
 * Files are pictures or plain text. The Pond reads images and words and nothing
 * in between, so a text file is read here and sent as part of the message, and
 * anything else is refused at the picker rather than after an upload.
 *
 * The three native modules are loaded on first use rather than imported. A
 * development build made before they were added has no native half for them,
 * and an import would crash the app on launch; a lazy load fails only the
 * button that needed it, with a message that says why.
 */

import { File } from 'expo-file-system';

import type { TranslationKey } from '@/services/i18n';

export type AttachSource = 'camera' | 'photos' | 'files';

export interface Attachment {
  id: string;
  kind: 'image' | 'text' | 'audio';
  /** A file on this phone, for the preview. */
  uri: string;
  name: string;
  mimeType: string;
  /** Images, and voice notes for a model that hears: raw base64, ready for the Pond. */
  base64?: string;
  /** Text files: the contents, which travel inside the message. */
  text?: string;
  /** Voice notes: how long it runs. `base64` carries the WAV only when the model hears audio itself. */
  durationMs?: number;
  width?: number;
  height?: number;
}

/** A refusal worth telling the reader, as the words to tell them. */
export class AttachError extends Error {
  readonly key: TranslationKey;
  constructor(key: TranslationKey) {
    super(key);
    this.name = 'AttachError';
    this.key = key;
  }
}

/** pond-desktop's long edge and quality, so a picture costs the same from either. */
const LONG_EDGE = 1024;
const JPEG_QUALITY = 0.85;
/** The Pond's per-picture ceiling, decoded. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** And per turn. */
export const MAX_TURN_IMAGE_BYTES = 8 * 1024 * 1024;
/** A text file goes inside the message, so past this it is no longer a message. */
const MAX_TEXT_BYTES = 64 * 1024;

const TEXT_TYPES = ['text/plain', 'text/markdown', 'text/csv', 'application/json'];

/** Decoded size of raw base64, without decoding it. */
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** The size to draw a picture at so its longer edge is `LONG_EDGE`, or itself if smaller. */
export function fitLongEdge(width: number, height: number, edge = LONG_EDGE) {
  const long = Math.max(width, height);
  if (!long || long <= edge) return { width, height };
  const scale = edge / long;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

type Picker = typeof import('expo-image-picker');
type Documents = typeof import('expo-document-picker');
type Manipulator = typeof import('expo-image-manipulator');

function load<T>(get: () => T): T | null {
  try {
    return get();
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const picker = () => load<Picker>(() => require('expo-image-picker'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const documents = () => load<Documents>(() => require('expo-document-picker'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const manipulator = () => load<Manipulator>(() => require('expo-image-manipulator'));

let counter = 0;
const nextId = () => `attach-${Date.now().toString(36)}-${(counter += 1)}`;

/**
 * Open a system picker, and say so plainly when it will not open. Nothing the
 * reader chose was ever reached, so "that picture could not be read" — what an
 * unexplained failure used to become — would be untrue. The usual cause is a
 * picker still waiting on a request that was cut off, which refuses every one
 * after it until the app restarts.
 */
async function launch<T>(open: () => Promise<T>): Promise<T> {
  try {
    return await open();
  } catch {
    throw new AttachError('chat.composer.pickerFailed');
  }
}

/**
 * Re-encode a picture as the Pond wants it: JPEG, 1024px on its long edge at
 * most, and under the per-picture ceiling.
 */
async function prepareImage(
  uri: string,
  size: { width?: number; height?: number },
  name: string,
): Promise<Attachment> {
  const lib = manipulator();
  if (!lib) throw new AttachError('chat.composer.needsUpdate');

  const context = lib.ImageManipulator.manipulate(uri);
  if (size.width && size.height) {
    const fit = fitLongEdge(size.width, size.height);
    if (fit.width !== size.width) context.resize({ width: fit.width, height: fit.height });
  } else {
    // Unknown dimensions: bound the long edge without knowing which it is.
    context.resize({ width: LONG_EDGE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({
    format: lib.SaveFormat.JPEG,
    compress: JPEG_QUALITY,
    base64: true,
  });
  if (!saved.base64) throw new AttachError('chat.composer.unreadable');
  if (base64Bytes(saved.base64) > MAX_IMAGE_BYTES) throw new AttachError('chat.composer.tooLarge');

  return {
    id: nextId(),
    kind: 'image',
    uri: saved.uri,
    name: name.replace(/\.[^.]+$/, '') + '.jpg',
    mimeType: 'image/jpeg',
    base64: saved.base64,
    width: saved.width,
    height: saved.height,
  };
}

async function prepareText(uri: string, name: string, mimeType: string, size?: number) {
  if (size !== undefined && size > MAX_TEXT_BYTES) throw new AttachError('chat.composer.textTooLarge');
  let text: string;
  try {
    text = await new File(uri).text();
  } catch {
    throw new AttachError('chat.composer.fileUnreadable');
  }
  if (text.length > MAX_TEXT_BYTES) throw new AttachError('chat.composer.textTooLarge');
  return { id: nextId(), kind: 'text' as const, uri, name, mimeType, text };
}

/**
 * Ask for up to `room` attachments from one source. Resolves with what was
 * chosen — nothing, if the reader backed out — and throws `AttachError` for
 * a refusal the reader should hear about.
 */
export async function pickAttachments(source: AttachSource, room: number): Promise<Attachment[]> {
  if (room <= 0) return [];

  if (source === 'files') {
    const lib = documents();
    if (!lib) throw new AttachError('chat.composer.needsUpdate');
    const result = await launch(() =>
      lib.getDocumentAsync({
        type: ['image/*', ...TEXT_TYPES],
        multiple: room > 1,
        copyToCacheDirectory: true,
      }),
    );
    if (result.canceled) return [];
    const chosen = result.assets.slice(0, room);
    const out: Attachment[] = [];
    for (const asset of chosen) {
      const type = asset.mimeType ?? '';
      if (type.startsWith('image/')) {
        out.push(await prepareImage(asset.uri, {}, asset.name));
      } else if (TEXT_TYPES.includes(type) || /\.(txt|md|csv|json)$/i.test(asset.name)) {
        out.push(await prepareText(asset.uri, asset.name, type || 'text/plain', asset.size));
      } else {
        throw new AttachError('chat.composer.unsupported');
      }
    }
    return out;
  }

  const lib = picker();
  if (!lib) throw new AttachError('chat.composer.needsUpdate');

  if (source === 'camera') {
    const permission = await launch(() => lib.requestCameraPermissionsAsync());
    if (!permission.granted) throw new AttachError('chat.composer.cameraDenied');
    let result: Awaited<ReturnType<Picker['launchCameraAsync']>>;
    try {
      result = await lib.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    } catch {
      // A simulator, or a device whose camera another app is holding.
      throw new AttachError('chat.composer.cameraUnavailable');
    }
    if (result.canceled) return [];
    const shot = result.assets[0];
    return [await prepareImage(shot.uri, shot, shot.fileName ?? 'photo.jpg')];
  }

  // The system photo picker hands over only what the reader chose, so there is
  // no library permission to ask for.
  const result = await launch(() =>
    lib.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: room > 1,
      selectionLimit: room,
      orderedSelection: true,
      quality: 1,
      exif: false,
    }),
  );
  if (result.canceled) return [];
  const out: Attachment[] = [];
  for (const asset of result.assets.slice(0, room)) {
    out.push(await prepareImage(asset.uri, asset, asset.fileName ?? 'photo.jpg'));
  }
  return out;
}

/**
 * The message the Pond is sent: what was typed, then each text file's contents
 * under its name. A reader sees only what they typed and the file's chip.
 */
export function composeMessage(text: string, attachments: Attachment[]): string {
  const files = attachments.filter((a) => a.kind === 'text' && a.text !== undefined);
  if (files.length === 0) return text;
  const blocks = files.map((f) => `${f.name}:\n\`\`\`\n${f.text}\n\`\`\``);
  return [text, ...blocks].filter((part) => part.trim().length > 0).join('\n\n');
}

/** Whether a turn's pictures fit the Pond's per-turn ceiling. */
export function withinTurnLimit(attachments: Attachment[]): boolean {
  const total = attachments.reduce((n, a) => n + (a.kind === 'image' && a.base64 ? base64Bytes(a.base64) : 0), 0);
  return total <= MAX_TURN_IMAGE_BYTES;
}
