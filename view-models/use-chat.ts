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
 * Pond, and `chat-runs.ts` holds its stream, so leaving the conversation leaves
 * the turn running and reopening it picks the reply up where it has got to.
 *
 * One turn runs at a time, and what is sent meanwhile queues behind it
 * (`turn-queue.ts`) rather than being refused: the composer never has to wait
 * for the model.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { BubblePosition } from '@jarida/ink/native';

import type { Message, ToolCall } from '@/models/chat';
import { toolWords, humanizeTool } from '@/constants/tools';
import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import { cardsFor, type CardsByCall } from '@/services/card-cache';
import { composeMessage, type Attachment } from '@/services/media';
import type { ChatFrame, SessionMessage } from '@/services/types';
import { chatRuns, type LiveTurn, type TurnEnd, type TurnHandle } from '@/services/chat-runs';
import { createTurnQueue } from '@/view-models/turn-queue';

/** How much of a long conversation is worth reading back on open. */
const HISTORY_LIMIT = 100;

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
 * Whether a saved conversation ends in a question nothing has answered yet:
 * the only kind a turn can still be running in, since the Pond saves the
 * question before it starts and the answer only once it has finished.
 */
export function endsUnanswered(rows: SessionMessage[]): boolean {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].role === 'user') return true;
    if (rows[i].role === 'assistant') return false;
  }
  return false;
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
    /** Start afresh. A turn still running carries on where it was asked, unwatched. */
    newConversation: () => void;
    /**
     * The conversation is on screen until the returned release is called, so a
     * turn that ends meanwhile is not announced to the person reading it.
     */
    watch: () => () => void;
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
 * A turn as the queue holds it: one to ask, with the question as the thread
 * shows it, or one already running that this screen picked up on opening. The
 * second goes through the queue too, so what is sent meanwhile waits behind it.
 */
type Turn =
  | { kind: 'ask'; question: Message; text: string; attachments: Attachment[]; options: SendOptions }
  | { kind: 'follow'; question: Message; handle: TurnHandle; replyId: string };

const pendingReply = (id: string): Message => ({
  id,
  role: 'assistant',
  content: '',
  timestamp: Date.now(),
  pending: true,
});

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
  const [watched, setWatched] = useState(false);

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

  const shownTitle = title ?? titleFromThread(messages);
  const titleRef = useRef<string | null>(null);
  useEffect(() => {
    titleRef.current = shownTitle;
  }, [shownTitle]);

  /** The turn this screen is drawing, and the row it draws it in. */
  const liveRef = useRef<{ key: string; replyId: string } | null>(null);
  /** An error frame already shown, so a redraw does not bring back one that was dismissed. */
  const shownErrorRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const makeQueue = () => createTurnQueue<Turn>((waiting) => setQueued(waiting.map((w) => w.question)));
  // Handed `runTurn` below, and handed it again whenever it changes, so a
  // queued turn runs through the current one. Replaced with a new conversation,
  // so its first question does not wait for the last conversation's answer.
  const [queue, setQueue] = useState(makeQueue);

  // Leaving the screen lets the turn go rather than stopping it: it carries on
  // in `chatRuns`, and the wall and the reopened conversation read it there.
  // What is queued behind it is still sent, in the background, as before.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const live = liveRef.current;
      if (live) chatRuns.mute(live.key);
      liveRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!watched || !sessionId) return;
    return chatRuns.view(sessionId);
  }, [watched, sessionId]);

  /** Draw a turn's latest into its row. */
  const show = useCallback(
    (turn: LiveTurn, replyId: string) => {
      const reply = { ...turn.reply, id: replyId };
      setMessages((m) => m.map((x) => (x.id === replyId ? reply : x)));
      setStatus(turn.status ? statusFor(turn.status, t) : null);
      if (turn.sessionId && sessionRef.current !== turn.sessionId) {
        sessionRef.current = turn.sessionId;
        setSessionId(turn.sessionId);
      }
      if (turn.errorText && turn.errorText !== shownErrorRef.current) {
        shownErrorRef.current = turn.errorText;
        setError(turn.errorText);
      }
    },
    [t],
  );

  useEffect(
    () =>
      chatRuns.subscribe(() => {
        const live = liveRef.current;
        const turn = live && chatRuns.get(live.key);
        if (live && turn) show(turn, live.replyId);
      }),
    [show],
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

  /**
   * Read a conversation back. `resume` also picks up a turn still running in
   * it; a reload after a turn was lost passes false, so a run that keeps
   * dropping cannot turn the reload into a loop.
   */
  const load = useCallback(
    (id: string, hint: string | undefined, resume: boolean) => {
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
          if (sessionRef.current !== id) return;
          const history = fromHistory(rows, cards);
          setMessages(history);
          if (!resume || !endsUnanswered(rows)) return;
          const handle = await chatRuns.resume(id, named ?? titleRef.current);
          if (!handle || sessionRef.current !== id || liveRef.current || !mountedRef.current) return;
          const replyId = nextLocalId();
          const question = [...history].reverse().find((m) => m.role === 'user') ?? pendingReply(replyId);
          setMessages((m) => [...m, pendingReply(replyId)]);
          void queue.submit({ kind: 'follow', question, handle, replyId });
        } catch (e) {
          setError(describe(e, t));
        } finally {
          setLoading(false);
        }
      })();
    },
    [hydrated, queue, refreshTitle, t],
  );
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const open = useCallback((id: string, hint?: string) => load(id, hint, true), [load]);

  /** What is left to do once a turn this screen was drawing has ended. */
  const settle = useCallback(
    (end: TurnEnd, replyId: string): string | null => {
      const answer = end.outcome === 'done' ? end.reply.content : null;
      // Let go of by leaving or by starting afresh: not this screen's to draw.
      if (liveRef.current?.key !== end.key) return answer;
      liveRef.current = null;
      if (end.error && end.outcome !== 'stopped') setError(describe(end.error, t));
      if (end.error && !end.reply.content && !end.reply.tools?.length) {
        // Nothing arrived: the reply was never started, so it is not shown.
        setMessages((m) => m.filter((x) => x.id !== replyId));
      } else {
        const reply = { ...end.reply, id: replyId };
        setMessages((m) => m.map((x) => (x.id === replyId ? reply : x)));
      }
      setStreaming(false);
      setStatus(null);
      const id = end.sessionId ?? sessionRef.current;
      if (!id) return answer;
      if (end.outcome === 'lost' || end.stale) {
        // Aged out of the Pond's memory means it finished; the saved copy is the answer.
        if (end.outcome === 'lost' && !end.gone) setError(t('chat.lostConnection'));
        loadRef.current(id, undefined, false);
      } else if (end.outcome === 'done') {
        // A saved turn is when the Pond names a new conversation, and its
        // re-titling job may since have named an old one better.
        void refreshTitle(id);
      }
      return answer;
    },
    [refreshTitle, t],
  );

  /** Draw a turn in its row until it ends. */
  const follow = useCallback(
    async (handle: TurnHandle, replyId: string): Promise<string | null> => {
      if (!mountedRef.current) {
        // Sent from the queue after the screen went: it runs, and is drawn when reopened.
        const end = await handle.ended;
        return end.outcome === 'done' ? end.reply.content : null;
      }
      liveRef.current = { key: handle.key, replyId };
      shownErrorRef.current = null;
      setStreaming(true);
      const now = chatRuns.get(handle.key);
      if (now) show(now, replyId);
      return settle(await handle.ended, replyId);
    },
    [settle, show],
  );

  const runTurn = useCallback(
    async (turn: Turn) => {
      if (turn.kind === 'follow') return follow(turn.handle, turn.replyId);
      const { text: trimmed, attachments, options } = turn;
      const images = attachments.filter((a) => a.kind === 'image' && a.base64);
      const replyId = nextLocalId();
      // Stamped when it is asked, which for a queued one is not when it was written.
      const question: Message = { ...turn.question, timestamp: Date.now() };

      setMessages((m) => [...m, question, pendingReply(replyId)]);
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

      const body = {
        message: composeMessage(trimmed, attachments),
        ...(sessionRef.current ? { session_id: sessionRef.current } : {}),
        ...(images.length
          ? { images: images.map((a) => ({ data: a.base64 as string, mime_type: a.mimeType })) }
          : {}),
        voice_mode: Boolean(options.voice),
        resumable: true,
      };
      const handle = chatRuns.start({
        body,
        title: titleRef.current ?? (derivedTitle(trimmed) || null),
        onText: mountedRef.current ? options.onText : undefined,
      });
      return follow(handle, replyId);
    },
    [follow],
  );

  useEffect(() => {
    queue.runWith(runTurn);
  }, [queue, runTurn]);

  const send = useCallback(
    (text: string, attachments: Attachment[] = [], options: SendOptions = {}) => {
      const trimmed = text.trim();
      if (!trimmed && attachments.length === 0) return Promise.resolve(null);
      return queue.submit({
        kind: 'ask',
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
    const live = liveRef.current;
    if (live) chatRuns.stop(live.key);
  }, [queue]);

  const newConversation = useCallback(() => {
    // What was waiting goes with the conversation it was written for.
    queue.clear();
    setQueue(makeQueue());
    const live = liveRef.current;
    if (live) chatRuns.mute(live.key);
    liveRef.current = null;
    setStreaming(false);
    setMessages([]);
    setSessionId(null);
    sessionRef.current = null;
    setTitle(null);
    setError(null);
    setStatus(null);
    setTurnSeed(Date.now());
  }, [queue]);

  const dismissError = useCallback(() => setError(null), []);

  const watch = useCallback(() => {
    setWatched(true);
    return () => setWatched(false);
  }, []);

  return {
    data: {
      messages,
      queued,
      sessionId,
      title: shownTitle,
      streaming,
      status,
      turnSeed,
    },
    loading,
    error,
    actions: { send, unqueue, stop, newConversation, open, dismissError, watch },
  };
}
