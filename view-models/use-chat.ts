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
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { BubblePosition } from '@jarida/ink/native';

import type { CardHint, Message, ToolCall } from '@/models/chat';
import { toolWords, humanizeTool } from '@/constants/tools';
import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import { cardsFor, rememberCard, type CardsByCall } from '@/services/card-cache';
import { composeMessage, type Attachment } from '@/services/media';
import { StreamStalledError } from '@/services/sse';
import type { ChatFrame, SessionMessage } from '@/services/types';
import { createTurnQueue } from '@/view-models/turn-queue';

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

function describe(e: unknown, t: TFunction): string {
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

export interface SendOptions {
  /** Spoken rather than read: a shorter answer, no reasoning passage. */
  voice?: boolean;
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

/** A turn as the queue holds it: the question as the thread shows it, and what sending it needs. */
interface Turn {
  question: Message;
  text: string;
  attachments: Attachment[];
  options: SendOptions;
}

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [queued, setQueued] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** The Pond's title, or the one the linking screen passed; see `data.title`. */
  const [title, setTitle] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [turnSeed, setTurnSeed] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const localId = useRef(0);
  const nextLocalId = () => `local-${++localId.current}`;

  // Read fresh at delivery time rather than at send time, so a reply always
  // reflects whatever the toggle is when it actually lands.
  const isScreenRealRef = useRef(isScreenReal);
  useEffect(() => {
    isScreenRealRef.current = isScreenReal;
  }, [isScreenReal]);

  const sessionRef = useRef<string | null>(null);
  useEffect(() => {
    sessionRef.current = sessionId;
  }, [sessionId]);

  /** The turn in flight, if any: what stopping it needs. */
  const turnRef = useRef<{ controller: AbortController; runId: string | null } | null>(null);

  // Handed `runTurn` below, and handed it again whenever it changes, so a
  // queued turn runs through the current one.
  const [queue] = useState(() =>
    createTurnQueue<Turn>((waiting) => setQueued(waiting.map((w) => w.question))),
  );

  // Leaving the screen gives the stream up so the Pond's four slots are not
  // held by a phone that is not listening. The turn itself is resumable and
  // carries on; the answer is in the history when the conversation reopens.
  //
  // Not while something is queued behind it. The end of this stream is how the
  // phone knows to send the next, so giving it up would quietly drop what was
  // written; the queue finishes in the background instead.
  useEffect(
    () => () => {
      if (queue.size === 0) turnRef.current?.controller.abort();
    },
    [queue],
  );

  /**
   * The Pond's own title for a conversation. It has no route for one
   * conversation, so this reads the list the wall reads. An answer that lands
   * after the screen has moved to another conversation is dropped, and a
   * failure leaves the bar as it was.
   */
  const refreshTitle = useCallback(async (id: string) => {
    try {
      const named = (await api.listSessions()).find((s) => s.id === id)?.title?.trim();
      if (named && sessionRef.current === id) setTitle(named);
    } catch {
      // The title already shown stands.
    }
  }, []);

  const open = useCallback(
    (id: string, hint?: string) => {
      if (!hydrated) return;
      const named = hint?.trim() || null;
      // Reopening the same conversation, as a lost connection does, keeps its
      // title rather than blanking it while the list is read again.
      if (named || sessionRef.current !== id) setTitle(named);
      sessionRef.current = id;
      setSessionId(id);
      setLoading(true);
      setError(null);
      if (!named) void refreshTitle(id);
      void (async () => {
        try {
          const [rows, cards] = await Promise.all([api.listSessionMessages(id, HISTORY_LIMIT), cardsFor(id)]);
          setMessages(fromHistory(rows, cards));
        } catch (e) {
          setError(describe(e, t));
        } finally {
          setLoading(false);
        }
      })();
    },
    [hydrated, refreshTitle, t],
  );

  const runTurn = useCallback(
    async (turn: Turn) => {
      const { text: trimmed, attachments, options } = turn;
      const images = attachments.filter((a) => a.kind === 'image' && a.base64);
      const replyId = nextLocalId();
      let reply: Message = {
        id: replyId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        pending: true,
      };
      // Stamped when it is asked, which for a queued one is not when it was written.
      const question: Message = { ...turn.question, timestamp: Date.now() };

      setMessages((m) => [...m, question, reply]);
      setStreaming(true);
      setStatus(null);
      setError(null);
      setTurnSeed(Date.now());

      if (!isScreenRealRef.current('chat')) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const content = `Working on it. (${trimmed.length} characters received — this is a mock response.)`;
        setMessages((m) =>
          m.map((x) => (x.id === replyId ? { ...x, content, pending: false } : x)),
        );
        setStreaming(false);
        return content;
      }

      const controller = new AbortController();
      const turnState = { controller, runId: null as string | null };
      turnRef.current = turnState;
      const run = { seq: 0, epoch: undefined as number | string | undefined, done: false, failed: false };

      // Tokens land in `reply` immediately and reach the screen in batches.
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        flushTimer = null;
        const snapshot = reply;
        setMessages((m) => m.map((x) => (x.id === replyId ? snapshot : x)));
      };
      const schedule = () => {
        if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
      };

      // Cards reach the phone on the stream and nowhere else, so each is kept
      // as it lands. One that lands before the Pond has named a new
      // conversation waits for the name.
      const unnamed = new Map<string, CardHint>();
      const keep = (callId: string, card: CardHint) => {
        const session = sessionRef.current;
        if (session) void rememberCard(session, callId, card);
        else unnamed.set(callId, card);
      };

      const onFrame = (frame: ChatFrame) => {
        if (frame.seq !== undefined) run.seq = Math.max(run.seq, frame.seq);
        if (frame.type === 'run_started') {
          turnState.runId = frame.run_id ?? null;
          run.epoch = frame.epoch;
          if (frame.session_id) {
            sessionRef.current = frame.session_id;
            setSessionId(frame.session_id);
          }
          return;
        }
        const line = statusFor(frame, t);
        if (line) setStatus(line);
        if (frame.done) {
          run.done = true;
          if (frame.session_id) {
            sessionRef.current = frame.session_id;
            setSessionId(frame.session_id);
          }
          return;
        }
        if (!frame.type && frame.error) {
          // Terminal when nothing follows it; either way it is the thing to say.
          run.failed = true;
          setError(frame.error);
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
        if (frame.type === 'text' || frame.type === 'review_revision') setStatus(null);
        schedule();
      };

      const body = {
        message: composeMessage(trimmed, attachments),
        ...(sessionRef.current ? { session_id: sessionRef.current } : {}),
        ...(images.length
          ? { images: images.map((a) => ({ data: a.base64 as string, mime_type: a.mimeType })) }
          : {}),
        voice_mode: Boolean(options.voice),
        resumable: true,
      };

      let lost = false;
      try {
        try {
          await api.streamChat(body, onFrame, controller.signal);
        } catch (e) {
          if (!isDrop(e)) throw e;
          lost = true;
        }
        // Ended without a `done`: the connection went, not the turn.
        if (!run.done && !run.failed && !controller.signal.aborted) lost = true;

        for (const wait of REATTACH_DELAYS_MS) {
          if (!lost || !turnState.runId || controller.signal.aborted) break;
          await new Promise((resolve) => setTimeout(resolve, wait));
          if (controller.signal.aborted) break;
          try {
            await api.reattachRun(turnState.runId, run.seq, run.epoch, onFrame, controller.signal);
            lost = !run.done && !run.failed;
          } catch (e) {
            // 404 and 410 mean the run is gone from memory; the saved turn is not.
            if (e instanceof ApiError) break;
            if (!isDrop(e)) throw e;
          }
        }

        if (lost && !controller.signal.aborted) {
          setError(t('chat.lostConnection'));
          const id = sessionRef.current;
          if (id) open(id);
        }
      } catch (e) {
        if (!isAbort(e) || !controller.signal.aborted) setError(describe(e, t));
        if (!reply.content && !reply.tools?.length) {
          // Nothing arrived: the reply was never started, so it is not shown.
          setMessages((m) => m.filter((x) => x.id !== replyId));
          reply = { ...reply, pending: false };
          return null;
        }
      } finally {
        if (flushTimer) clearTimeout(flushTimer);
        const session = sessionRef.current;
        if (session) for (const [callId, card] of unnamed) void rememberCard(session, callId, card);
        reply = {
          ...reply,
          pending: false,
          // A tool that never answered by the end of the turn did not finish.
          tools: reply.tools?.map((c) => (c.status === 'running' ? { ...c, status: 'error' } : c)),
        };
        const snapshot = reply;
        setMessages((m) => m.map((x) => (x.id === replyId ? snapshot : x)));
        setStreaming(false);
        setStatus(null);
        if (turnRef.current === turnState) turnRef.current = null;
        // A saved turn is when the Pond names a new conversation, and its
        // re-titling job may since have named an old one better.
        if (run.done && sessionRef.current) void refreshTitle(sessionRef.current);
      }
      return run.done ? reply.content : null;
    },
    [open, refreshTitle, t],
  );

  useEffect(() => {
    queue.runWith(runTurn);
  }, [queue, runTurn]);

  const send = useCallback(
    (text: string, attachments: Attachment[] = [], options: SendOptions = {}) => {
      const trimmed = text.trim();
      if (!trimmed && attachments.length === 0) return Promise.resolve(null);
      return queue.submit({
        question: questionFor(nextLocalId(), trimmed, attachments),
        text: trimmed,
        attachments,
        options,
      });
    },
    [queue],
  );

  const unqueue = useCallback(
    (id: string) => queue.remove((turn) => turn.question.id === id),
    [queue],
  );

  const stop = useCallback(() => {
    queue.clear();
    const turn = turnRef.current;
    if (!turn) return;
    if (turn.runId) void api.cancelRun(turn.runId).catch(() => {});
    turn.controller.abort();
  }, [queue]);

  const newConversation = useCallback(() => {
    stop();
    setMessages([]);
    setSessionId(null);
    sessionRef.current = null;
    setTitle(null);
    setError(null);
    setStatus(null);
    setTurnSeed(Date.now());
  }, [stop]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    data: {
      messages,
      queued,
      sessionId,
      title: title ?? titleFromThread(messages),
      streaming,
      status,
      turnSeed,
    },
    loading,
    error,
    actions: { send, unqueue, stop, newConversation, open, dismissError },
  };
}
