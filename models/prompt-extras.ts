/**
 * Assistant notes, as the Assistant notes screen reads them.
 *
 * The wire type is the Pond's `PromptExtra` (`services/types.ts`): a `key`, the note's text in
 * `instruction`, whether it is `active`, and a `sort_order`. Every active note is sent to the model
 * on every turn, after the Pond's built-in prompt, as `<extension-notes name="{key}">`. That is why
 * this file advises a length: the Pond itself sets none, and on a Jetson each extra token is read
 * again on every turn by a small model.
 *
 * `key` is the note's identity and the Pond's upsert target, so it is fixed once a note exists: a
 * rename would be a delete and a create. People type a name; the key is made from it here, and
 * kept to letters, digits and underscores because the Pond writes it unescaped into the
 * `name="..."` attribute of the block the model reads.
 */

import type { TranslationKey } from '@/services/i18n';
import type { PromptExtra } from '@/services/types';

/**
 * The phone's own advice, well under the Pond's limit. About two sentences, which is what a standing
 * note needs and little enough that the small model on a Jetson barely notices.
 */
export const ADVISED_NOTE_LENGTH = 280;

/** The Pond refuses a longer note: `MAX_INSTRUCTION_CHARS` in pond-core's `prompt_extra.rs`. */
export const MAX_NOTE_LENGTH = 1000;

/** Long enough for any name a household would give a note; the Pond sets no limit here either. */
export const MAX_KEY_LENGTH = 64;

/** Why a new note or new words cannot be sent yet. */
export type NoteProblem = 'nameRequired' | 'nameUnusable' | 'nameTaken' | 'textRequired';

/** The key a typed name becomes: lower case, runs of anything else folded to one underscore. */
export function keyFromName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_KEY_LENGTH)
    .replace(/_+$/, '');
}

/** A key read back as a name, for notes made here and for ones made by the desktop or the API. */
export function noteName(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

/** The Pond's own order: `sort_order`, then `key`. */
export function inPondOrder(extras: readonly PromptExtra[]): PromptExtra[] {
  return [...extras].sort((a, b) => a.sort_order - b.sort_order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** A new note goes last, after every note there is now. */
export function nextSortOrder(extras: readonly PromptExtra[]): number {
  return extras.reduce((max, e) => Math.max(max, e.sort_order + 1), 0);
}

/** A new note from what was typed, or why it cannot be sent. */
export function newNote(
  name: string,
  text: string,
  existing: readonly PromptExtra[],
): { note: PromptExtra } | { problem: NoteProblem } {
  if (!name.trim()) return { problem: 'nameRequired' };
  const key = keyFromName(name);
  if (!key) return { problem: 'nameUnusable' };
  // The Pond would quietly replace the note already under this key.
  if (existing.some((e) => e.key === key)) return { problem: 'nameTaken' };
  const instruction = text.trim();
  if (!instruction) return { problem: 'textRequired' };
  return { note: { key, instruction, active: true, sort_order: nextSortOrder(existing) } };
}

/** The sentence for each problem, one literal key apiece. */
export function problemKey(problem: NoteProblem): TranslationKey {
  switch (problem) {
    case 'nameRequired':
      return 'promptNotes.errors.nameRequired';
    case 'nameUnusable':
      return 'promptNotes.errors.nameUnusable';
    case 'nameTaken':
      return 'promptNotes.errors.nameTaken';
    case 'textRequired':
      return 'promptNotes.errors.textRequired';
  }
}

/** What the mock shows, so the screen can be looked at without a Pond. */
export const SAMPLE_PROMPT_EXTRAS: PromptExtra[] = [
  { key: 'language', instruction: 'Always answer in Swahili unless asked otherwise.', active: true, sort_order: 0 },
  { key: 'quiet_evenings', instruction: 'After 9 PM, keep spoken answers to one sentence.', active: false, sort_order: 1 },
];
