/**
 * Chat run store — module-scoped rather than component state.
 *
 * A chat turn can outlive the screen that started it: switching tabs,
 * navigating to Sessions, or the app backgrounding mid-reply must not throw
 * away the transcript or the in-flight stream. State that has to survive a
 * screen unmount cannot live in that screen's `useState`, so it lives here,
 * at module scope, and screens subscribe via `useChatRun`. Mirrors
 * pond-desktop's `chatRunStore.ts`, the working reference for this exact
 * problem.
 *
 * Every send asks the server for a resumable turn (`resumable: true`), which
 * is what makes everything below reachable: the turn keeps running
 * server-side after a disconnect, named by a `run_id` this store persists
 * (via `services/storage.ts`) so `resumeActiveRun` can find its way back in.
 *
 * Only takes over when the caller is in "real" mode — see `use-chat.ts`,
 * which is the one place that reads `isScreenReal('chat')`. This module has
 * no opinion about that flag; it only knows how to drive a real turn.
 */

import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import type { Message } from '@/models/chat';
import { ApiError, api } from '@/services/api-client';
import { Storage } from '@/services/storage';
import type { ActiveRun, ChatStreamFrame } from '@/services/types';

let _msgId = 0;
function nextId(): string {
  return String(++_msgId);
}

export interface ChatRunSnapshot {
  messages: Message[];
  sessionId: string | null;
  streaming: boolean;
  activity: string | null;
  error: string | null;
}

interface InternalState extends ChatRunSnapshot {
  runId: string | null;
  epoch: string | null;
  /** How far this client has read. What a reattach resumes from. */
  lastSeq: number;
  /** Bumped per turn/session-switch; a run whose seq no longer matches must stop writing. */
  runSeq: number;
  activeStream: { close: () => void } | null;
  snapshot: ChatRunSnapshot;
  subs: Set<() => void>;
}

const state: InternalState = {
  messages: [],
  sessionId: null,
  streaming: false,
  activity: null,
  error: null,
  runId: null,
  epoch: null,
  lastSeq: 0,
  runSeq: 0,
  activeStream: null,
  snapshot: { messages: [], sessionId: null, streaming: false, activity: null, error: null },
  subs: new Set(),
};

function commit(): void {
  state.snapshot = {
    messages: state.messages,
    sessionId: state.sessionId,
    streaming: state.streaming,
    activity: state.activity,
    error: state.error,
  };
  state.subs.forEach((f) => f());
}

function subscribe(f: () => void): () => void {
  state.subs.add(f);
  return () => {
    state.subs.delete(f);
  };
}

function getSnapshot(): ChatRunSnapshot {
  return state.snapshot;
}

export function useChatRun(): ChatRunSnapshot {
  ensureAppStateListener();
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Wire `resumeActiveRun` to real background→foreground transitions, once,
 * for the life of the module — not to this hook's mount/unmount cycle.
 *
 * A screen remounting (switching tabs, navigating to Sessions and back) must
 * NOT re-trigger a resume: the store's own `activeStream`, if any, is still
 * the live connection, and nothing has actually happened to the app's
 * lifecycle. `AppState`'s 'change' event only fires on a genuine transition
 * (page visibility on web, real backgrounding on native), which is the
 * correct — and only — signal to act on. Called from `useChatRun` so it's
 * guaranteed to run before any screen needs it, but the `subscribed` guard
 * means the actual listener and the one-time launch check happen exactly
 * once regardless of how many components call this.
 */
let subscribed = false;
function ensureAppStateListener(): void {
  if (subscribed) return;
  subscribed = true;
  AppState.addEventListener('change', (next) => {
    if (next === 'active') void resumeActiveRun();
  });
  // AppState.currentState is already 'active' at launch, so the 'change'
  // event above never fires for it — this is what catches "the app was
  // relaunched with a turn still running server-side."
  void resumeActiveRun();
}

// ── Run pointer persistence ─────────────────────────────────────────────────

interface RunPointer {
  sessionId: string;
  runId: string;
  epoch: string;
  lastSeq: number;
}

function rememberRun(): void {
  if (!state.sessionId || !state.runId || !state.epoch) return;
  void Storage.setJSON<RunPointer>('chatRun', {
    sessionId: state.sessionId,
    runId: state.runId,
    epoch: state.epoch,
    lastSeq: state.lastSeq,
  });
}

function forgetRun(): void {
  void Storage.remove('chatRun');
}

// ── Loading persisted history ────────────────────────────────────────────────

async function reloadFromHistory(sessionId: string, stale: () => boolean): Promise<void> {
  try {
    const history = await api.listSessionMessages(sessionId);
    if (stale()) return;
    state.messages = history
      .filter((m) => m.role !== 'tool')
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: Date.parse(m.created_at),
      }));
    commit();
  } catch (e) {
    if (stale()) return;
    state.error = e instanceof ApiError ? e.message : 'Failed to load conversation';
    commit();
  }
}

// ── Frame handling — shared by a fresh send and a reattach ──────────────────

interface TurnCtx {
  stale: () => boolean;
  assistantId: string;
}

function appendAssistantText(assistantId: string, text: string): void {
  if (!text) return;
  state.messages = state.messages.map((m) =>
    m.id === assistantId ? { ...m, content: m.content + text } : m,
  );
  commit();
}

/** One frame. Returns whether the caller should keep streaming, reload from history, or stop. */
function consume(frame: ChatStreamFrame, ctx: TurnCtx): 'continue' | 'reload' | 'done' {
  if (ctx.stale()) return 'done';

  const seq = (frame as { seq?: number }).seq;
  if (typeof seq === 'number') {
    state.lastSeq = seq;
    rememberRun();
  }

  if ('error' in frame) {
    state.error = frame.error;
    state.streaming = false;
    state.activity = null;
    commit();
    forgetRun();
    return 'done';
  }
  if ('done' in frame) {
    state.sessionId = frame.session_id;
    state.streaming = false;
    state.activity = null;
    commit();
    forgetRun();
    return 'done';
  }

  switch (frame.type) {
    case 'run_started':
      state.runId = frame.run_id;
      state.epoch = frame.epoch;
      if (!state.sessionId) state.sessionId = frame.session_id;
      rememberRun();
      commit();
      return 'continue';
    case 'reattached':
    case 'cancelled':
      // Bookkeeping only. `cancelled` is followed by a `done` frame carrying
      // `interrupted: true`, which is what actually ends the turn.
      return 'continue';
    case 'replay_gap':
    case 'run_evicted':
      // The server cannot hand back what this client missed. The database is
      // authoritative for anything that already committed, so reload from
      // there rather than stitch a partial answer together and present it as
      // whole.
      return 'reload';
    case 'text':
      appendAssistantText(ctx.assistantId, frame.content ?? frame.token ?? '');
      state.activity = null;
      return 'continue';
    case 'thinking':
      state.activity = 'Thinking…';
      commit();
      return 'continue';
    case 'tool_call':
      state.activity = `Using ${frame.tool}…`;
      commit();
      return 'continue';
    case 'tool_result':
      state.activity = null;
      commit();
      return 'continue';
    case 'status':
    case 'review_status':
      state.activity = frame.content;
      commit();
      return 'continue';
    default:
      // review_revision / tool_revision / turn_limit_reached / context_warning /
      // subagent_progress / turn_stats — parsed, no UI treatment this pass.
      return 'continue';
  }
}

function attachStream(
  open: (handlers: {
    onFrame: (frame: ChatStreamFrame) => void;
    onNetworkError?: (message: string) => void;
  }) => { close: () => void },
  ctx: TurnCtx,
): void {
  const handle = open({
    onFrame: (frame) => {
      const result = consume(frame, ctx);
      if (result === 'reload') {
        state.activeStream?.close();
        state.activeStream = null;
        state.streaming = false;
        state.activity = null;
        commit();
        if (state.sessionId) void reloadFromHistory(state.sessionId, ctx.stale);
      } else if (result === 'done') {
        state.activeStream = null;
      }
    },
    onNetworkError: (message) => {
      if (ctx.stale()) return;
      state.error = message;
      state.streaming = false;
      state.activity = null;
      state.activeStream = null;
      commit();
    },
  });
  state.activeStream = handle;
}

// ── Sending ───────────────────────────────────────────────────────────────────

export function send(text: string): void {
  const trimmed = text.trim();
  if (!trimmed || state.streaming) return;

  const userMsg: Message = { id: nextId(), role: 'user', content: trimmed, timestamp: Date.now() };
  const assistantId = nextId();
  const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', timestamp: Date.now() };

  state.messages = [...state.messages, userMsg, assistantMsg];
  state.error = null;
  state.activity = null;
  state.streaming = true;
  state.runId = null;
  state.epoch = null;
  state.lastSeq = 0;
  const runSeq = ++state.runSeq;
  commit();

  const ctx: TurnCtx = { stale: () => runSeq !== state.runSeq, assistantId };
  attachStream(
    (handlers) =>
      api.streamChat(
        { message: trimmed, session_id: state.sessionId ?? undefined, resumable: true },
        handlers,
      ),
    ctx,
  );
}

/** Stop a run on purpose — the only way, now that a resumable turn keeps generating after disconnect. */
function stopServerRun(): void {
  const runId = state.runId;
  forgetRun();
  if (!runId) return;
  void api.cancelRun(runId).catch(() => {
    // Non-fatal: local state already reflects the stop the user asked for.
  });
}

export function abortRun(): void {
  ++state.runSeq;
  state.activeStream?.close();
  state.activeStream = null;
  state.streaming = false;
  state.activity = null;
  commit();
  stopServerRun();
}

export function newConversation(): void {
  ++state.runSeq;
  state.activeStream?.close();
  state.activeStream = null;
  stopServerRun();
  state.messages = [];
  state.sessionId = null;
  state.runId = null;
  state.epoch = null;
  state.lastSeq = 0;
  state.streaming = false;
  state.error = null;
  state.activity = null;
  commit();
}

export async function loadSession(id: string): Promise<void> {
  ++state.runSeq;
  state.activeStream?.close();
  state.activeStream = null;
  stopServerRun();
  state.error = null;
  state.streaming = false;
  state.activity = null;
  state.sessionId = id;
  state.runId = null;
  state.epoch = null;
  state.lastSeq = 0;
  commit();
  await reloadFromHistory(id, () => false);
}

// ── Surviving a background/foreground cycle, or a full relaunch ─────────────

/**
 * Pick up a turn this window was not around to finish.
 *
 * Called on app launch and every foreground transition. Cheap when there is
 * nothing to resume: `readRunPointer` is the only work done before bailing.
 */
export async function resumeActiveRun(): Promise<void> {
  const pointer = await Storage.getJSON<RunPointer>('chatRun');
  if (!pointer) return;

  // A send that started after this call was queued wins — never stomp on a
  // run fresher than the one the pointer names.
  if (state.streaming && state.runId && state.runId !== pointer.runId) return;

  // The old connection is presumed dead: iOS suspends background network
  // activity without always telling the app, so `state.streaming` staying
  // true is not proof the stream is still live.
  state.activeStream?.close();
  state.activeStream = null;

  let active: ActiveRun | null;
  try {
    active = await api.getActiveRun(pointer.sessionId);
  } catch {
    // Non-fatal — try again on the next foreground.
    return;
  }

  const sameSessionAlreadyOpen = state.sessionId === pointer.sessionId && state.messages.length > 0;

  const lost =
    !active || active.run_id !== pointer.runId || active.epoch !== pointer.epoch || active.state !== 'running';

  if (lost) {
    // Gone, aged out, or the server restarted underneath the client. Either
    // way the pointer is stale; persisted history is the whole truth for
    // whatever session this window has open.
    forgetRun();
    state.streaming = false;
    state.activity = null;
    if (state.sessionId === pointer.sessionId) {
      await reloadFromHistory(pointer.sessionId, () => false);
    }
    return;
  }

  const runSeq = ++state.runSeq;
  const stale = () => runSeq !== state.runSeq;

  if (!sameSessionAlreadyOpen) {
    await reloadFromHistory(pointer.sessionId, stale);
    if (stale()) return;
  }

  state.sessionId = pointer.sessionId;
  state.runId = pointer.runId;
  state.epoch = pointer.epoch;
  state.lastSeq = pointer.lastSeq;
  state.streaming = true;
  state.error = null;

  const last = state.messages[state.messages.length - 1];
  const assistantId =
    sameSessionAlreadyOpen && last && last.role === 'assistant' ? last.id : nextId();
  if (assistantId !== last?.id) {
    state.messages = [...state.messages, { id: assistantId, role: 'assistant', content: '', timestamp: Date.now() }];
  }
  commit();

  attachStream(
    (handlers) => api.reattachChat(pointer.runId, pointer.lastSeq, pointer.epoch, handlers),
    { stale, assistantId },
  );
}
