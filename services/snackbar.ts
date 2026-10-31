/**
 * The snackbar's one message, held outside React so anything can ask for it.
 *
 * A screen, a view-model hook and a module-level store (the model library is one) all report what
 * an action came to, and only the first two can call a hook. So the message lives here, and
 * `SnackbarProvider` (`providers/snackbar-provider.tsx`) is only the thing that draws it, times it
 * and announces it.
 *
 * One at a time, as Material and the HIG both have it: a new message replaces the one on screen
 * rather than queueing behind it, because the newer one is about what the user just did.
 */

/** Neutral for "it worked", danger for "it did not". */
export type SnackbarTone = 'neutral' | 'danger';

/** The one thing a snackbar can offer to do -- Try again, mostly. */
export interface SnackbarAction {
  label: string;
  onPress: () => void;
}

/** What a caller asks to be said. `message` is one short sentence, never a status code. */
export interface SnackbarRequest {
  message: string;
  tone?: SnackbarTone;
  action?: SnackbarAction;
}

/** A message on screen. `id` tells one showing of a sentence from the next showing of the same one. */
export interface Snackbar {
  id: number;
  message: string;
  tone: SnackbarTone;
  action?: SnackbarAction;
}

/** How long a plain message stays, at least: long enough to read a short sentence twice. */
export const SNACKBAR_MS = 4_000;
/** How long one that offers an action stays, at least: reading it and reaching for it takes longer. */
export const SNACKBAR_ACTION_MS = 8_000;

let current: Snackbar | null = null;
let counter = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** Say something about an action the user just took. Replaces whatever is on screen. */
export function showSnackbar({ message, tone = 'neutral', action }: SnackbarRequest): number {
  counter += 1;
  current = { id: counter, message, tone, action };
  emit();
  return counter;
}

/**
 * Put the message away. With an id, only that showing goes, so a timer started for an older
 * message cannot take a newer one with it.
 */
export function dismissSnackbar(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

/** The message on screen, or null. */
export function currentSnackbar(): Snackbar | null {
  return current;
}

/** Called on every change, for `useSyncExternalStore`. */
export function subscribeSnackbar(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For tests: put the message away and forget the count. */
export function resetSnackbar(): void {
  current = null;
  counter = 0;
  emit();
}
