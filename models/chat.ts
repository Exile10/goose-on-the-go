/**
 * The conversation, shaped for the screen that draws it.
 *
 * The wire has a message per row, and a tool's result arrives as a row of its
 * own that points back at the call. A reader does not think of it that way: a
 * turn is Goose doing some things and then saying something. So a `Message`
 * here carries its tool calls with their results folded in, and `tool` rows
 * never reach the screen.
 */

import type { MessageNote } from './message-note';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/** Where a tool call has got to. `running` only exists while a turn streams. */
export type ToolStatus = 'running' | 'ok' | 'error';

/**
 * A tool's own suggestion for how to draw its answer: `weather`, `devices`,
 * `knowledge` and a few more, with the facts to draw it from.
 */
export interface CardHint {
  type: string;
  data: Record<string, unknown>;
}

export interface ToolCall {
  /** The call's id, which the result row names in `tool_call_id`. */
  id: string;
  /** The tool as the model named it, e.g. `giap-device-control__set_device_state`. */
  name: string;
  /** Arguments as the model wrote them: JSON text, usually, but not promised. */
  args: string;
  status: ToolStatus;
  /** What the tool answered — text addressed to the model, so shown sparingly. */
  result?: string;
  /**
   * How the tool asked for its answer to be drawn. Only a live turn carries
   * one — the Pond strips it before saving — so a reopened conversation has it
   * only when this phone kept it (`services/card-cache.ts`).
   */
  card?: CardHint;
  /**
   * In a saved turn, the stub the Pond keeps in place of a result it may not
   * store, such as Brave's search results. A quiet line, never a result to open.
   */
  kept?: string;
}

/**
 * A picture in a conversation.
 *
 * `uri` is either a file on this phone (an attachment not yet sent) or a path
 * on the Pond, which needs the bearer token to fetch — `api.imageSource`
 * turns the second into something `expo-image` can load.
 */
export interface ChatImage {
  id: string;
  uri: string;
  local: boolean;
  mimeType?: string;
  width?: number;
  height?: number;
}

/** A voice note the person sent, kept on this phone so it can be played back. */
export interface ChatVoiceNote {
  uri: string;
  durationMs: number;
  /** An audio file's own name; a voice note has none. */
  name?: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  images?: ChatImage[];
  /** User turns only: the note this turn was spoken as; `content` is then what was heard, if anything. */
  voice?: ChatVoiceNote;
  /** Assistant turns only: what Goose did before it answered, in order. */
  tools?: ToolCall[];
  /** Reasoning passages, when the Pond kept them. */
  thinking?: string[];
  /**
   * Live turns only: what Goose wrote while it worked, moved out of the answer
   * when the Pond marks it as working notes. Never saved, so never reloaded.
   */
  steps?: string[];
  /** Live turns only: where the text since the turn's last tool call begins in `content`. */
  stepFrom?: number;
  /** Still arriving: text may grow, tools may still be running. */
  pending?: boolean;
  /**
   * Where the message came from, what it really set and what it offers. From the saved message,
   * or for a live turn from its tool results as they arrive.
   */
  note?: MessageNote;
}

export interface SessionSummary {
  id: string;
  title: string;
  messageCount: number;
  lastActivity: number;
  modelId: string;
}

export interface ChatState {
  messages: Message[];
  sessionId: string | null;
  streaming: boolean;
}
