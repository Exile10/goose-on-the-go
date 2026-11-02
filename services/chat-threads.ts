/**
 * The conversations this phone has open, held in memory while the app runs.
 *
 * The conversation screen is pushed over the wall and popped off it again, so
 * every visit used to start from nothing: the thread was read back from the
 * Pond and the screen was empty until it landed, and the composer's draft was
 * gone.
 *
 * So each conversation's thread lives here rather than in the screen, and the
 * screen shows whichever one it has open:
 *
 * - **Its messages**, shown the moment a conversation reopens while the Pond is
 *   asked again behind them.
 * - **The turn in flight**, if any. Its stream is held in `chat-runs.ts`, and
 *   it keeps writing into its own thread whoever is looking at it, so a reply
 *   that carries on in the background is still on screen, as far as it has
 *   got, when its conversation comes back into view.
 *
 * Drafts are kept beside the threads, by conversation, with one slot for a
 * conversation not yet started (`NEW_DRAFT`).
 *
 * Memory only, on purpose: this is a cache of what the Pond holds, not a
 * second record of it, and a cold start reads the Pond again. It is bounded,
 * least recently opened first, and goes with the pairing.
 */

import type { Message } from '@/models/chat';

import { chatRuns } from './chat-runs';

/** Threads kept. Past this, the ones opened least recently go first. */
export const MAX_THREADS = 20;

/** The draft slot for a conversation that has no id yet. */
export const NEW_DRAFT = '';

/** A turn streaming into this thread now. */
export interface ThreadTurn {
  /** The turn in `chat-runs.ts`, or a mock one that only this thread knows. */
  key: string;
  replyId: string;
  /** Settles when the turn has finished with this thread, however it ended. */
  done: Promise<void>;
}

export interface Thread {
  /** Null until the Pond names a new conversation, on its first turn. */
  session: string | null;
  messages: Message[];
  /** The Pond's title, or the one the linking screen passed. */
  title: string | null;
  turn: ThreadTurn | null;
  /** What Goose says it is doing right now, while a turn runs. */
  status: string | null;
  /** Counts turns started, so a read of history that a turn overtook can tell. */
  turns: number;
  /** Counts changes, for `useSyncExternalStore`. */
  version: number;
}

type Listener = () => void;

const threads = new Map<string, Thread>();
const drafts = new Map<string, string>();
const listeners = new Map<Thread, Set<Listener>>();

/** A thread for a conversation not yet saved, or not yet read. */
export function newThread(session: string | null = null, title: string | null = null): Thread {
  return { session, messages: [], title, turn: null, status: null, turns: 0, version: 0 };
}

/** The thread kept for a conversation, marked as just opened. */
export function threadFor(session: string): Thread | undefined {
  const thread = threads.get(session);
  if (thread) {
    threads.delete(session);
    threads.set(session, thread);
  }
  return thread;
}

/**
 * Keep a thread under its conversation's id, once it has one. A thread whose
 * turn is still running is never the one evicted: it would go on writing into
 * a thread nobody could reopen.
 */
export function keepThread(thread: Thread): void {
  if (!thread.session) return;
  threads.delete(thread.session);
  threads.set(thread.session, thread);
  for (const [id, kept] of threads) {
    if (threads.size <= MAX_THREADS) break;
    if (kept !== thread && !kept.turn) threads.delete(id);
  }
}

/** Tell whoever is showing `thread` that it changed. */
export function changed(thread: Thread): void {
  thread.version += 1;
  listeners.get(thread)?.forEach((listener) => listener());
}

/** Hear about changes to `thread`. Returns the way to stop. */
export function watchThread(thread: Thread, listener: Listener): () => void {
  let set = listeners.get(thread);
  if (!set) {
    set = new Set();
    listeners.set(thread, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(thread);
  };
}

/** The half-written message for a conversation, or `NEW_DRAFT`'s. */
export function draftFor(key: string): string {
  return drafts.get(key) ?? '';
}

export function setDraft(key: string, text: string): void {
  if (text) drafts.set(key, text);
  else drafts.delete(key);
}

/** A new conversation was named: what is being written in it moves with it. */
export function moveDraft(from: string, to: string): void {
  const text = drafts.get(from);
  drafts.delete(from);
  if (text) drafts.set(to, text);
}

/** Deleted conversations take their thread and draft with them. */
export function forgetThreads(sessions: string[]): void {
  for (const id of sessions) {
    threads.delete(id);
    drafts.delete(id);
  }
}

/** Signing out: everything here is the household's. */
export function forgetAllThreads(): void {
  chatRuns.dropAll();
  threads.clear();
  drafts.clear();
}
