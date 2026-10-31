/**
 * The conversation with Goose.
 *
 * Follows the view-model contract in docs/ARCHITECTURE.md: the screen renders
 * `data` and calls `actions`, and never touches the network itself.
 *
 * Two sources feed `messages`. Opening an existing conversation reads it back
 * from the Pond, which is the only way history survives the app being closed;
 * sending appends locally first so the message appears under the thumb that
 * sent it, then builds the reply as it streams. The Pond persists both, so a
 * reload agrees with what was on screen.
 *
 * Every turn streams (`POST /api/v1/chat/stream`). `/chat` answers whole and
 * drops pictures and voice mode on the floor, and a reader watching nothing
 * happen for a minute has no way to tell thinking from broken. On the stream
 * they see each tool Goose calls as it calls it, and the answer as it is
 * written.
 *
 * Turns are resumable. A phone locks, walks out of Wi-Fi range, backgrounds
 * the app; a turn tied to the connection would be cancelled by any of them and
 * its question deleted from the history. A resumable one keeps running on the
 * Pond, and this picks it back up from the last frame it saw.
 *
 * One turn runs at a time, and what is sent meanwhile queues behind it
 * (`turn-queue.ts`) rather than being refused: the composer never has to wait
 * for the model.
 *
 * A conversation's thread is not this hook's. It lives in `chat-threads.ts`,
 * and the hook shows whichever one is open, so a conversation left and reopened
 * comes back as it was while the Pond is read again behind it, and a turn
 * writes into its own thread whichever conversation is on screen by then. A
 * reply given up mid-stream — by leaving the screen or starting another
 * conversation — is picked back up from its last frame when its conversation
 * reopens, rather than waiting until the Pond has saved it.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { BubblePosition } from '@jarida/ink/native';

import type { CardHint, Message, ToolCall } from '@/models/chat';
import { toolWords, humanizeTool } from '@/constants/tools';
import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import { cardsFor, rememberCard, type CardsByCall } from '@/services/card-cache';
import {
  changed,
  keepThread,
  newThread,
  threadFor,
  watchThread,
  type LiveTurn,
  type Thread,
} from '@/services/chat-threads';
import { composeMessage, type Attachment } from '@/services/media';
import { StreamStalledError } from '@/services/sse';
import type { AnswerShape, ChatFrame, ChatStreamRequest, SessionMessage } from '@/services/types';
import { createTurnQueue } from '@/view-models/turn-queue';
import { MOCK_RESEARCH_REPLY, MOCK_TASK_REPLY } from '@/models/long-tasks-mock';
import { mockTaskStart } from '@/view-models/use-long-task';
import { researchRefusal } from '@/view-models/use-deep-research';

/** How much of a long conversation is worth reading back on open. */
const HISTORY_LIMIT = 100;

/**
 * How often streamed text reaches the screen. Tokens arrive faster than a
 * reader can see them change, and each state update re-renders the thread.
 */
const FLUSH_MS = 50;

/** Reattaching after a drop: how many times, and how long to wait before each. */
const REATTACH_DELAYS_MS = [800, 2000, 4000];

/**
 * Whether a failure is the request being given up on rather than refused.
 *
 * React Native's abort surfaces as a plain Error whose text names the native
 * frame that threw — `FetchRequestCanceledException … NativeResponse.swift` —
 * so `name === 'AbortError'` alone does not catch it.
 */
function isAbort(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === 'AbortError') return true;
  return /cancel|abort/i.test(e.message);
}

/** A dropped connection, as distinct from the Pond refusing: worth reattaching. */
function isDrop(e: unknown): boolean {
  if (e instanceof StreamStalledError) return true;
  if (e instanceof ApiError) return false;
  return e instanceof TypeError || (e instanceof Error && /network|connection|socket/i.test(e.message));
}

export function describeTurnError(e: unknown, t: TFunction): string {
  const research = researchRefusal(e);
  if (research === 'off') return t('chat.research.refusedOff');
  if (research === 'unidentified') return t('chat.research.unidentified');
  if (e instanceof ApiError) {
    if (e.status === 503) return t('chat.busy');
    if (e.status === 413) return t('chat.composer.tooLarge');
    if (e.status === 415) return t('chat.composer.unsupported');
    return e.message;
  }
  if (isAbort(e)) return t('chat.timedOut');
  return e instanceof Error ? e.message : t('chat.failed');
}

/** A tool row's `content` is a JSON blob around the result; this is the result. */
export function toolResultText(content: string): string {
  try {
    const blob = JSON.parse(content) as { content?: unknown };
    if (blob && typeof blob.content === 'string') return blob.content;
  } catch {
    // Not the blob: an older row that stored the result bare.
  }
  return content;
}

/**
 * A stored message as the screen draws it.
 *
 * `tool` rows are dropped: they are the transcript of Goose calling something,
 * addressed to the model rather than to the reader. Their results reach the
 * screen through `fromHistory`, folded into the call that asked for them.
 */
export function toMessage(m: SessionMessage): Message | null {
  if (m.role === 'tool') return null;
  const message: Message = {
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: Date.parse(m.created_at) || Date.now(),
  };
  if (m.images?.length) {
    message.images = m.images.map((image) => ({
      id: image.id,
      uri: image.url,
      local: false,
      mimeType: image.mime_type,
    }));
  }
  if (m.thinking?.length) message.thinking = m.thinking;
  return message;
}

/**
 * A saved conversation, as a reader would recount it.
 *
 * The Pond stores a turn as `user`, then a `tool` row per result, then one
 * `assistant` row holding the whole answer and every call it made. The results
 * come first and the calls after, so they are gathered in one pass and matched
 * to their calls in the next. An assistant row with no words and no calls said
 * nothing, and is left out.
 *
 * The Pond saves no cards, so `cards` is what this phone kept of them, by call.
 */
export function fromHistory(rows: SessionMessage[], cards: CardsByCall = {}): Message[] {
  const results = new Map<string, string>();
  for (const row of rows) {
    if (row.role === 'tool' && row.tool_call_id) results.set(row.tool_call_id, toolResultText(row.content));
  }

  const out: Message[] = [];
  for (const row of rows) {
    // System rows are the Pond talking to the model.
    if ((row.role as string) === 'system') continue;
    const message = toMessage(row);
    if (!message) continue;
    if (row.role === 'assistant' && row.tool_calls?.length) {
      message.tools = row.tool_calls.map<ToolCall>((call) => {
        const tool: ToolCall = {
          id: call.id,
          name: call.name,
          args: call.arguments,
          status: 'ok',
          result: results.get(call.id),
        };
        const card = cards[call.id];
        if (card) tool.card = card;
        return tool;
      });
    }
    if (row.role === 'assistant' && !message.content.trim() && !message.tools?.length) continue;
    out.push(message);
  }
  return out;
}

/**
 * Where each message sits in its run of same-speaker turns.
 *
 * Ink draws a bubble's tail from this, so four consecutive turns from one
 * speaker read as a single block rather than four identical shapes. It lives
 * here rather than in the screen because it shapes data, and because a screen
 * that imports Ink cannot be unit-tested without a native transform.
 */
export function positionsFor(messages: Message[]): BubblePosition[] {
  return messages.map((m, i) => {
    const samePrev = i > 0 && messages[i - 1].role === m.role;
    const sameNext = i < messages.length - 1 && messages[i + 1].role === m.role;
    if (samePrev && sameNext) return 'middle';
    if (samePrev) return 'last';
    if (sameNext) return 'first';
    return 'only';
  });
}

/** The Pond's first guess at a title keeps this many words, and this many characters. */
const TITLE_WORDS = 6;
const TITLE_CHARS = 60;

const unquote = (s: string) => s.replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');

/**
 * The title the Pond gives a conversation after its first reply, made the same
 * way (`derive_title_from_text` in pond-core's chat service): the first six
 * words of the first question, quotes trimmed, sixty characters at most. Kept
 * identical so a new conversation's title bar says, from the moment it is
 * asked, what the wall will call it once the Pond has saved the turn. Empty
 * when there are no words.
 */
export function derivedTitle(text: string): string {
  const words = unquote(text.trim()).split(/\s+/).filter(Boolean).slice(0, TITLE_WORDS).join(' ');
  const title = unquote(words.trim()).trim();
  const chars = Array.from(title);
  if (chars.length <= TITLE_CHARS) return title;
  return `${chars.slice(0, TITLE_CHARS).join('').trimEnd()}…`;
}

/**
 * The title a conversation on screen would be given, from its first question.
 * Null when the thread may not begin at the beginning — a long one is read back
 * from its most recent end — or nothing has been asked in words yet.
 */
export function titleFromThread(messages: Message[]): string | null {
  if (messages.length >= HISTORY_LIMIT) return null;
  const first = messages.find((m) => m.role === 'user' && m.content.trim());
  return first ? derivedTitle(first.content) || null : null;
}

/** The card a tool result asks to be drawn as, when it asks. */
export function cardOf(frame: ChatFrame): CardHint | undefined {
  return frame.ui?.card_type && frame.ui.data ? { type: frame.ui.card_type, data: frame.ui.data } : undefined;
}

/**
 * One frame, folded into the reply it belongs to. Pure, so a turn can be
 * replayed in a test exactly as it arrived.
 */
export function applyFrame(reply: Message, frame: ChatFrame): Message {
  switch (frame.type) {
    case 'text':
      return frame.content ? { ...reply, content: reply.content + frame.content } : reply;
    case 'review_revision':
      // A review pass rewrote the answer; what streamed before is superseded.
      return typeof frame.content === 'string' ? { ...reply, content: frame.content } : reply;
    case 'thinking':
      return frame.content ? { ...reply, thinking: [...(reply.thinking ?? []), frame.content] } : reply;
    case 'tool_call': {
      if (!frame.tool || !frame.id) return reply;
      const tools = reply.tools ?? [];
      if (tools.some((t) => t.id === frame.id)) return reply;
      const call: ToolCall = {
        id: frame.id,
        name: frame.tool,
        args: frame.input === undefined || frame.input === null ? '{}' : JSON.stringify(frame.input),
        status: 'running',
      };
      return { ...reply, tools: [...tools, call] };
    }
    case 'tool_result': {
      if (!frame.id) return reply;
      const tools = reply.tools ?? [];
      const card = cardOf(frame);
      const done = (call: ToolCall): ToolCall => ({
        ...call,
        status: 'ok',
        result: frame.content ?? call.result,
        card: card ?? call.card,
      });
      if (tools.some((t) => t.id === frame.id)) {
        return { ...reply, tools: tools.map((t) => (t.id === frame.id ? done(t) : t)) };
      }
      // A result for a call this reply never saw — joined mid-turn. Keep it.
      return {
        ...reply,
        tools: [...tools, done({ id: frame.id, name: frame.tool ?? '', args: '{}', status: 'ok' })],
      };
    }
    default:
      return reply;
  }
}

/**
 * What Goose is doing, in words: under the thinking quips before the answer,
 * and beside the spinner under it after. `review_status` is the Pond reviewing
 * an answer it has already sent, when review mode is on — still the turn, and
 * anything queued behind it waits for it.
 */
export function statusFor(frame: ChatFrame, t: TFunction): string | null {
  if ((frame.type === 'status' || frame.type === 'review_status') && frame.content) return frame.content;
  if (frame.type === 'tool_call' && frame.tool) {
    const words = toolWords(frame.tool);
    if (words?.doing) return t(words.doing);
    return t('chat.tools.using', { tool: words ? t(words.label) : humanizeTool(frame.tool) });
  }
  return null;
}

/** What `/chat/stream` is sent for a turn; `deep_research` only when it is research, as older Ponds expect. */
export function streamBody(
  text: string,
  attachments: Attachment[],
  options: SendOptions,
  sessionId: string | null,
): ChatStreamRequest {
  const images = attachments.filter((a) => a.kind === 'image' && a.base64);
  return {
    message: composeMessage(text, attachments),
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(images.length ? { images: images.map((a) => ({ data: a.base64 as string, mime_type: a.mimeType })) } : {}),
    voice_mode: Boolean(options.voice),
    resumable: true,
    ...(options.research ? { deep_research: true } : {}),
    ...(options.research && options.answer && options.answer !== 'auto' ? { deep_research_answer: options.answer } : {}),
  };
}

export interface SendOptions {
  /** Spoken rather than read: a shorter answer, no reasoning passage. */
  voice?: boolean;
  /** A research question: the Pond starts a long task on it rather than answering in the turn. */
  research?: boolean;
  /** How much the research should write; read only with `research`. */
  answer?: AnswerShape;
  /** The reply so far, each time it grows — voice mode speaks it as it comes. */
  onText?: (text: string) => void;
}

export interface UseChat {
  data: {
    messages: Message[];
    /** Sent while a reply was still coming, waiting their turn in order. */
    queued: Message[];
    sessionId: string | null;
    /**
     * What the conversation is called: the Pond's title, or until it has one
     * the title it will give it. Null for a conversation nothing has been
     * asked in yet.
     */
    title: string | null;
    /** A turn is in flight. */
    streaming: boolean;
    /** What Goose says it is doing right now, when it has said. */
    status: string | null;
    /** Changes each turn, so a quip is chosen once per turn rather than per render. */
    turnSeed: number;
  };
  loading: boolean;
  error: string | null;
  actions: {
    /**
     * Send now, or once the turns ahead of it have settled. Resolves with the
     * whole reply, or null when nothing was sent, it failed, or it was taken
     * back while it waited.
     */
    send: (text: string, attachments?: Attachment[], options?: SendOptions) => Promise<string | null>;
    /** Take back a queued message before it goes. */
    unqueue: (id: string) => void;
    /** Stop the turn in flight and drop what is queued behind it. What already arrived stays. */
    stop: () => void;
    newConversation: () => void;
    /**
     * Read an existing conversation back from the Pond. `title` is what the
     * screen that linked here already calls it, shown until the Pond says
     * otherwise.
     */
    open: (sessionId: string, title?: string) => void;
    dismissError: () => void;
  };
}

/**
 * A turn as the queue holds it: a question to ask, or a turn to pick back up
 * where an earlier visit left it. Either belongs to the thread it was made in,
 * whichever conversation is on screen by the time it runs.
 */
type Job =
  | {
      kind: 'ask';
      thread: Thread;
      question: Message;
      text: string;
      attachments: Attachment[];
      options: SendOptions;
    }
  | { kind: 'resume'; thread: Thread };

/**
 * The question a turn asks, drawn once, when it is sent. A queued one shows as
 * it will be asked, pictures and all, so the picture is never re-bound to a
 * later question.
 */
function questionFor(id: string, text: string, attachments: Attachment[]): Message {
  const images = attachments.filter((a) => a.kind === 'image' && a.base64);
  const files = attachments.filter((a) => a.kind === 'text');
  return {
    id,
    role: 'user',
    content: [text, ...files.map((f) => f.name)].filter(Boolean).join('\n'),
    timestamp: Date.now(),
    images: images.map((a) => ({
      id: a.id,
      uri: a.uri,
      local: true,
      mimeType: a.mimeType,
      width: a.width,
      height: a.height,
    })),
  };
}

export function useChat(): UseChat {
  const { t } = useTranslation();
  const { hydrated, isScreenReal } = useServer();

  // The conversation on screen. Its thread lives in `chat-threads.ts`, not
  // here, so leaving the screen does not take the thread with it.
  const [thread, setThread] = useState<Thread>(() => newThread());
  const viewRef = useRef(thread);
  const subscribe = useCallback((listener: () => void) => watchThread(thread, listener), [thread]);
  useSyncExternalStore(subscribe, () => thread.version);

  const [queued, setQueued] = useState<Message[]>([]);
  const [turnSeed, setTurnSeed] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const localId = useRef(0);
  const nextLocalId = () => `local-${Date.now().toString(36)}-${++localId.current}`;

  // Read fresh at delivery time rather than at send time, so a reply always
  // reflects whatever the toggle is when it actually lands.
  const isScreenRealRef = useRef(isScreenReal);
  useEffect(() => {
    isScreenRealRef.current = isScreenReal;
  }, [isScreenReal]);

  /** The thread a turn run from here is streaming into, if any. */
  const activeRef = useRef<Thread | null>(null);

  const show = useCallback((next: Thread) => {
    viewRef.current = next;
    setThread(next);
  }, []);

  /** Whatever is said about a thread is said only while it is the one on screen. */
  const sayFor = useCallback((th: Thread, message: string | null) => {
    if (viewRef.current === th) setError(message);
  }, []);

  // Handed `runJob` below, and handed it again whenever it changes, so a
  // queued turn runs through the current one.
  const [queue] = useState(() =>
    createTurnQueue<Job>((waiting) =>
      setQueued(waiting.flatMap((w) => (w.kind === 'ask' ? [w.question] : []))),
    ),
  );

  // Leaving the screen gives the stream up so the Pond's four slots are not
  // held by a phone that is not listening. The turn itself is resumable and
  // carries on; its thread keeps where it was left, so reopening the
  // conversation picks the reply back up rather than waiting for it to be
  // saved.
  //
  // Not while something is queued behind it. The end of this stream is how the
  // phone knows to send the next, so giving it up would quietly drop what was
  // written; the queue finishes in the background instead, into its thread.
  useEffect(
    () => () => {
      if (queue.size === 0) leave(activeRef.current);
    },
    [queue],
  );

  /**
   * The Pond's own title for a conversation. It has no route for one
   * conversation, so this reads the list the wall reads. A failure leaves the
   * bar as it was.
   */
  const refreshTitle = useCallback(async (th: Thread) => {
    const id = th.session;
    if (!id) return;
    try {
      const named = (await api.listSessions()).find((s) => s.id === id)?.title?.trim();
      if (named) {
        th.title = named;
        changed(th);
      }
    } catch {
      // The title already shown stands.
    }
  }, []);

  /**
   * Read a thread back from the Pond. `loud` is a thread with nothing to show
   * yet: it shows the loading state and says when the read fails. Otherwise the
   * kept thread stays up, and a failed read leaves it there; the offline banner
   * already says whether the Pond can be reached.
   *
   * A read that a turn overtook is dropped. The turn's own messages are newer
   * than the history the read began with.
   */
  const reload = useCallback(
    async (th: Thread, loud: boolean) => {
      const id = th.session;
      if (!id) return;
      const turns = th.turns;
      if (loud) setLoading(true);
      try {
        const [rows, cards] = await Promise.all([api.listSessionMessages(id, HISTORY_LIMIT), cardsFor(id)]);
        if (th.turn || th.left || th.turns !== turns) return;
        th.messages = fromHistory(rows, cards);
        keepThread(th);
        changed(th);
      } catch (e) {
        if (loud) sayFor(th, describeTurnError(e, t));
        else console.warn('[chat] re-reading a kept conversation failed; showing what was kept', e instanceof ApiError ? e.status : 'network');
      } finally {
        if (loud && viewRef.current === th) setLoading(false);
      }
    },
    [sayFor, t],
  );

  /**
   * Stream one turn into its thread: the first request, reattaching after a
   * drop, and settling the reply however it ends. `first` is what opens the
   * stream — asking, or reattaching to a run an earlier visit left.
   */
  const drive = useCallback(
    async (
      th: Thread,
      start: Message,
      cursor: { runId: string | null; seq: number; epoch: number | string | undefined },
      first: (onFrame: (frame: ChatFrame) => void, signal: AbortSignal) => Promise<void>,
      options: SendOptions,
    ): Promise<string | null> => {
      let reply = start;
      const replyId = start.id;
      const resuming = cursor.runId !== null;
      const controller = new AbortController();
      let finish!: () => void;
      const turn: LiveTurn = {
        controller,
        ...cursor,
        replyId,
        left: false,
        done: new Promise<void>((resolve) => {
          finish = resolve;
        }),
      };
      th.turn = turn;
      th.status = null;
      changed(th);
      activeRef.current = th;
      const run = { done: false, failed: false };

      const put = (snapshot: Message) => {
        th.messages = th.messages.map((x) => (x.id === replyId ? snapshot : x));
        changed(th);
      };

      // Tokens land in `reply` immediately and reach the screen in batches.
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        flushTimer = null;
        put(reply);
      };
      const schedule = () => {
        if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
      };

      // Cards reach the phone on the stream and nowhere else, so each is kept
      // as it lands. One that lands before the Pond has named a new
      // conversation waits for the name.
      const unnamed = new Map<string, CardHint>();
      const keep = (callId: string, card: CardHint) => {
        if (th.session) void rememberCard(th.session, callId, card);
        else unnamed.set(callId, card);
      };

      const named = (session: string | undefined) => {
        if (!session || th.session === session) return;
        th.session = session;
        keepThread(th);
        changed(th);
      };

      const onFrame = (frame: ChatFrame) => {
        if (frame.seq !== undefined) turn.seq = Math.max(turn.seq, frame.seq);
        if (frame.type === 'run_started') {
          turn.runId = frame.run_id ?? null;
          turn.epoch = frame.epoch;
          named(frame.session_id);
          return;
        }
        const line = statusFor(frame, t);
        if (line) {
          th.status = line;
          changed(th);
        }
        if (frame.done) {
          run.done = true;
          named(frame.session_id);
          return;
        }
        if (!frame.type && frame.error) {
          // Terminal when nothing follows it; either way it is the thing to say.
          run.failed = true;
          sayFor(th, frame.error);
          return;
        }
        if (frame.type === 'replay_gap' || frame.type === 'run_evicted') {
          // The Pond no longer has the frames between; the saved turn does.
          run.failed = true;
          return;
        }
        const before = reply.content;
        reply = applyFrame(reply, frame);
        if (frame.type === 'tool_result' && frame.id) {
          const card = cardOf(frame);
          if (card) keep(frame.id, card);
        }
        if (reply.content !== before) options.onText?.(reply.content);
        if ((frame.type === 'text' || frame.type === 'review_revision') && th.status) {
          th.status = null;
          changed(th);
        }
        schedule();
      };

      let lost = false;
      // The run is gone from the Pond's memory, or its frames are: the saved
      // turn is the way to the rest of it.
      let gone = false;
      try {
        try {
          await first(onFrame, controller.signal);
        } catch (e) {
          if (resuming && e instanceof ApiError) gone = true;
          else if (!isDrop(e)) throw e;
          else lost = true;
        }
        // Ended without a `done`: the connection went, not the turn.
        if (!gone && !run.done && !run.failed && !controller.signal.aborted) lost = true;

        for (const wait of REATTACH_DELAYS_MS) {
          if (!lost || !turn.runId || controller.signal.aborted) break;
          await new Promise((resolve) => setTimeout(resolve, wait));
          if (controller.signal.aborted) break;
          try {
            await api.reattachRun(turn.runId, turn.seq, turn.epoch, onFrame, controller.signal);
            lost = !run.done && !run.failed;
          } catch (e) {
            // 404 and 410 mean the run is gone from memory; the saved turn is not.
            if (e instanceof ApiError) {
              lost = false;
              gone = true;
              break;
            }
            if (!isDrop(e)) throw e;
          }
        }

        if (lost && !controller.signal.aborted) sayFor(th, t('chat.lostConnection'));
      } catch (e) {
        if (!isAbort(e) || !controller.signal.aborted) sayFor(th, describeTurnError(e, t));
        if (!turn.left && !reply.content && !reply.tools?.length) {
          // Nothing arrived: the reply was never started, so it is not shown.
          th.messages = th.messages.filter((x) => x.id !== replyId);
          changed(th);
          reply = { ...reply, pending: false };
          return null;
        }
      } finally {
        if (flushTimer) clearTimeout(flushTimer);
        if (th.session) for (const [callId, card] of unnamed) void rememberCard(th.session, callId, card);
        if (turn.left && turn.runId) {
          // Given up on purpose. The reply stays as far as it got, still
          // pending, and the thread keeps where to pick it up.
          th.left = { runId: turn.runId, seq: turn.seq, epoch: turn.epoch, replyId };
          put(reply);
        } else {
          reply = {
            ...reply,
            pending: false,
            // A tool that never answered by the end of the turn did not finish.
            tools: reply.tools?.map((c) => (c.status === 'running' ? { ...c, status: 'error' } : c)),
          };
          put(reply);
        }
        th.turn = null;
        th.status = null;
        changed(th);
        if (activeRef.current === th) activeRef.current = null;
        finish();
        // A saved turn is when the Pond names a new conversation, and its
        // re-titling job may since have named an old one better.
        if (run.done) void refreshTitle(th);
        if (gone || (lost && !controller.signal.aborted) || (run.failed && !run.done)) void reload(th, false);
      }
      return run.done ? reply.content : null;
    },
    [refreshTitle, reload, sayFor, t],
  );

  const runJob = useCallback(
    async (job: Job): Promise<string | null> => {
      const th = job.thread;
      // A turn an earlier visit left running in this thread finishes first:
      // one conversation answers one question at a time.
      if (th.turn) await th.turn.done;

      if (job.kind === 'resume') {
        const left = th.left;
        if (!left) return null;
        th.left = null;
        th.turns += 1;
        let reply = th.messages.find((m) => m.id === left.replyId);
        if (!reply) {
          reply = { id: left.replyId, role: 'assistant', content: '', timestamp: Date.now(), pending: true };
          th.messages = [...th.messages, reply];
        }
        return drive(
          th,
          reply,
          { runId: left.runId, seq: left.seq, epoch: left.epoch },
          (onFrame, signal) => api.reattachRun(left.runId, left.seq, left.epoch, onFrame, signal),
          {},
        );
      }

      const { text: trimmed, attachments, options } = job;
      const images = attachments.filter((a) => a.kind === 'image' && a.base64);
      const reply: Message = {
        id: nextLocalId(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        pending: true,
      };
      // Stamped when it is asked, which for a queued one is not when it was written.
      const question: Message = { ...job.question, timestamp: Date.now() };

      th.turns += 1;
      th.messages = [...th.messages, question, reply];
      changed(th);
      sayFor(th, null);
      setTurnSeed(Date.now());

      if (!isScreenRealRef.current('chat')) {
        let finish!: () => void;
        th.turn = {
          controller: new AbortController(),
          runId: null,
          seq: 0,
          epoch: undefined,
          replyId: reply.id,
          left: false,
          done: new Promise<void>((resolve) => {
            finish = resolve;
          }),
        };
        changed(th);
        await new Promise((resolve) => setTimeout(resolve, 700));
        // Research, or a message asking for a long task, starts one in the mock Pond, so its card can be seen.
        const tools = options.research
          ? [mockTaskStart(trimmed, 'research', options.answer)]
          : /\blong task\b/i.test(trimmed)
            ? [mockTaskStart(trimmed)]
            : undefined;
        const content = options.research
          ? MOCK_RESEARCH_REPLY
          : tools
            ? MOCK_TASK_REPLY
            : `Working on it. (${trimmed.length} characters received — this is a mock response.)`;
        th.messages = th.messages.map((x) => (x.id === reply.id ? { ...x, content, tools, pending: false } : x));
        th.turn = null;
        changed(th);
        finish();
        return content;
      }

      return drive(
        th,
        reply,
        { runId: null, seq: 0, epoch: undefined },
        (onFrame, signal) =>
          api.streamChat(streamBody(trimmed, attachments, options, th.session), onFrame, signal),
        options,
      );
    },
    [drive, sayFor],
  );

  useEffect(() => {
    queue.runWith(runJob);
  }, [queue, runJob]);

  const open = useCallback(
    (id: string, hint?: string) => {
      if (!hydrated) return;
      const named = hint?.trim() || null;
      const kept = threadFor(id);
      const th = kept ?? newThread(id, named);
      // Reopening keeps the title it had rather than blanking it while the
      // list is read again; a title from the linking screen is newer.
      if (named) th.title = named;
      keepThread(th);
      show(th);
      setError(null);
      setLoading(false);
      if (!th.title) void refreshTitle(th);
      // A turn is writing into it now: what is kept is already current.
      if (th.turn) return;
      // A turn was left mid-reply: pick it up where it was left.
      if (th.left) {
        void queue.submit({ kind: 'resume', thread: th });
        return;
      }
      void reload(th, th.messages.length === 0);
    },
    [hydrated, queue, refreshTitle, reload, show],
  );

  const send = useCallback(
    (text: string, attachments: Attachment[] = [], options: SendOptions = {}) => {
      const trimmed = text.trim();
      if (!trimmed && attachments.length === 0) return Promise.resolve(null);
      return queue.submit({
        kind: 'ask',
        thread: viewRef.current,
        question: questionFor(nextLocalId(), trimmed, attachments),
        text: trimmed,
        attachments,
        options,
      });
    },
    [queue],
  );

  const unqueue = useCallback(
    (id: string) => queue.remove((job) => job.kind === 'ask' && job.question.id === id),
    [queue],
  );

  const stop = useCallback(() => {
    queue.clear();
    const turn = viewRef.current.turn;
    if (!turn) return;
    if (turn.runId) void api.cancelRun(turn.runId).catch(() => {});
    turn.controller.abort();
  }, [queue]);

  // Starting another conversation is not stopping this one. A reply still being
  // written is left with its thread to be picked up on return; only what was
  // queued and not yet asked is dropped, as stopping drops it.
  const newConversation = useCallback(() => {
    queue.clear();
    leave(viewRef.current);
    show(newThread());
    setError(null);
    setLoading(false);
    setTurnSeed(Date.now());
  }, [queue, show]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    data: {
      messages: thread.messages,
      queued,
      sessionId: thread.session,
      title: thread.title ?? titleFromThread(thread.messages),
      streaming: thread.turn !== null || thread.left !== null,
      status: thread.status,
      turnSeed,
    },
    loading,
    error,
    actions: { send, unqueue, stop, newConversation, open, dismissError },
  };
}

/**
 * Give up a thread's stream on purpose, so it can be picked up later. Only a
 * turn the Pond has named a run for can be: before that there is nothing to
 * reattach to, and the stream ends as it did before there was anywhere to keep
 * it — the saved turn is read back when the conversation reopens.
 */
function leave(th: Thread | null): void {
  const turn = th?.turn;
  if (!turn) return;
  if (turn.runId) turn.left = true;
  turn.controller.abort();
}
