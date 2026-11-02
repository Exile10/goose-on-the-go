/**
 * Room voice, the Voice agent and Voice Match, as the Pond serves them: readers for each route's
 * body, and the words each screen uses for what they say.
 *
 * The readers are lenient where a field is news and strict where it is the point: a room status
 * without a state, or a print listing without its members, is not one, and the screen says the
 * Pond answered oddly rather than drawing an empty household.
 */

import i18n from '@/services/i18n';
import type {
  AgentPrefill,
  RoomVoiceEvent,
  RoomVoiceState,
  RoomVoiceUnavailable,
  VoiceAgent,
  VoiceAgentExample,
  VoiceAgentPatch,
  VoiceAgentToolGroup,
  VoicePrintMember,
  VoicePrintModelState,
  VoicePrints,
  VoiceRoom,
  VoiceSpeaker,
  VoiceTakeResult,
  WakeDetectorKind,
  WakeDetectorVerdict,
} from '@/services/types';

import { readPrefills } from './agents';

const ROOM_STATES: readonly RoomVoiceState[] = ['off', 'starting', 'wait', 'listen', 'thinking', 'speak'];
const UNAVAILABLE: readonly RoomVoiceUnavailable[] = ['no_mic_speaker_pair', 'voice_running_elsewhere', 'models_missing'];
const MODEL_STATES: readonly VoicePrintModelState[] = ['missing', 'downloading', 'ready', 'failed'];

type Raw = Record<string, unknown>;

function record(raw: unknown): Raw | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Raw) : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function fraction(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

function count(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function detector(value: unknown): WakeDetectorKind {
  return value === 'hey_goose' ? 'hey_goose' : 'whisper';
}

function speaker(raw: unknown): VoiceSpeaker | null {
  const r = record(raw);
  return r && typeof r.profile_id === 'string' && r.profile_id !== '' ? { profile_id: r.profile_id, name: text(r.name) } : null;
}

export function readVoiceRoom(raw: unknown): VoiceRoom | null {
  const r = record(raw);
  if (!r || !ROOM_STATES.includes(r.state as RoomVoiceState)) return null;
  const wake = record(r.wake) ?? {};
  const heard = record(r.last_heard);
  const reason = UNAVAILABLE.includes(r.unavailable_reason as RoomVoiceUnavailable) ? (r.unavailable_reason as RoomVoiceUnavailable) : null;
  return {
    enabled: r.enabled === true,
    // A Pond that says it is unavailable without saying why is still unavailable.
    available: r.available === true,
    unavailable_reason: reason,
    state: r.state as RoomVoiceState,
    wake: { phrase: text(wake.phrase), detector: detector(wake.detector), reason: text(wake.reason) },
    interrupts: r.interrupts === 'enrolled_or_wake' ? 'enrolled_or_wake' : 'wake_only',
    last_heard: heard && typeof heard.profile_id === 'string' ? { profile_id: heard.profile_id, name: text(heard.name), at: text(heard.at) } : null,
    session_id: typeof r.session_id === 'string' && r.session_id !== '' ? r.session_id : null,
  };
}

/** One frame of the room's event stream; null for one this phone has no use for, `audio_level` among them. */
export function readRoomVoiceEvent(raw: unknown): RoomVoiceEvent | null {
  const r = record(raw);
  if (!r) return null;
  switch (r.event) {
    case 'state':
      return ROOM_STATES.includes(r.state as RoomVoiceState) ? { event: 'state', state: r.state as RoomVoiceState } : null;
    case 'transcript':
      return { event: 'transcript', text: text(r.text) };
    case 'token':
      return { event: 'token', content: text(r.content) };
    case 'tool_call':
      return { event: 'tool_call', tool: text(r.tool), id: text(r.id) };
    case 'tool_result':
      return { event: 'tool_result', tool: text(r.tool), id: text(r.id), content: text(r.content) };
    case 'turn_complete':
      return { event: 'turn_complete', session_id: text(r.session_id) };
    case 'error':
      return { event: 'error', message: text(r.message) };
    case 'wake':
      return { event: 'wake', who: speaker(r.who) };
    case 'interrupt':
      return { event: 'interrupt', why: r.why === 'voice' || r.why === 'wake_word' ? r.why : 'button' };
    default:
      return null;
  }
}

function examples(raw: unknown): VoiceAgentExample[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const e = record(item);
    return e ? [{ brief: text(e.brief), answer: text(e.answer) }] : [];
  });
}

function toolGroups(raw: unknown): VoiceAgentToolGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const g = record(item);
    return g && typeof g.group === 'string' && g.group !== '' ? [{ group: g.group, label: text(g.label) || g.group, on: g.on !== false }] : [];
  });
}

export function readVoiceAgent(raw: unknown): VoiceAgent | null {
  const r = record(raw);
  if (!r || typeof r.instructions !== 'string') return null;
  const prefill: AgentPrefill = readPrefills({ agents: [r.prefill] })?.agents[0] ?? {
    agent: 'voice',
    kind: 'default',
    status: 'not_built',
    compiled_at: null,
    last_used_at: null,
  };
  return {
    name: 'voice',
    title: text(r.title) || i18n.t('agents.builtInName.voice'),
    edited: r.edited === true,
    instructions: r.instructions,
    shipped_instructions: text(r.shipped_instructions),
    examples: examples(r.examples),
    tool_groups: toolGroups(r.tool_groups),
    max_turns: count(r.max_turns),
    prefill,
  };
}

function member(raw: unknown): VoicePrintMember[] {
  const m = record(raw);
  if (!m || typeof m.profile_id !== 'string' || m.profile_id === '') return [];
  const needed = count(m.needed, VOICE_PRINT_TAKES) || VOICE_PRINT_TAKES;
  const takes = count(m.takes);
  return [
    {
      profile_id: m.profile_id,
      name: text(m.name),
      takes,
      needed,
      enrolled: m.enrolled === true,
      consistency: fraction(m.consistency),
      updated_at: typeof m.updated_at === 'string' && m.updated_at !== '' ? m.updated_at : null,
    },
  ];
}

export function readVoicePrints(raw: unknown): VoicePrints | null {
  const r = record(raw);
  if (!r || !Array.isArray(r.members)) return null;
  const model = record(r.model) ?? {};
  return {
    model: {
      state: MODEL_STATES.includes(model.state as VoicePrintModelState) ? (model.state as VoicePrintModelState) : 'missing',
      progress: fraction(model.progress),
      credit: text(model.credit),
    },
    members: r.members.flatMap(member),
  };
}

// ── The room, live ──────────────────────────────────────────

/** What the room is doing, from the status read and the events since. */
export interface RoomLive {
  state: RoomVoiceState;
  /** What the room last heard someone say. */
  heard: string | null;
  /** The reply so far, while one is being spoken. */
  reply: string;
  /** Who woke it last; null for someone Voice Match does not know. Undefined until a wake. */
  woke: VoiceSpeaker | null | undefined;
  /** Why the last reply stopped early, until the next turn begins. */
  interrupted: 'voice' | 'wake_word' | 'button' | null;
  error: string | null;
}

export const QUIET_ROOM: RoomLive = { state: 'off', heard: null, reply: '', woke: undefined, interrupted: null, error: null };

export function foldRoomEvent(live: RoomLive, event: RoomVoiceEvent): RoomLive {
  switch (event.event) {
    case 'state':
      // A new turn starts from listening: last turn's words and interruption are history.
      return event.state === 'listen'
        ? { ...live, state: event.state, reply: '', interrupted: null, error: null }
        : { ...live, state: event.state };
    case 'wake':
      return { ...live, woke: event.who, heard: null, reply: '', interrupted: null, error: null };
    case 'transcript':
      return event.text.trim() ? { ...live, heard: event.text.trim() } : live;
    case 'token':
      return { ...live, reply: live.reply + event.content };
    case 'interrupt':
      return { ...live, interrupted: event.why };
    case 'error':
      return { ...live, error: event.message || null };
    default:
      return live;
  }
}

/** A sentence for what the room is doing now. */
export function roomStateWords(state: RoomVoiceState): string {
  switch (state) {
    case 'off':
      return i18n.t('voiceRoom.state.off');
    case 'starting':
      return i18n.t('voiceRoom.state.starting');
    case 'wait':
      return i18n.t('voiceRoom.state.wait');
    case 'listen':
      return i18n.t('voiceRoom.state.listen');
    case 'thinking':
      return i18n.t('voiceRoom.state.thinking');
    case 'speak':
      return i18n.t('voiceRoom.state.speak');
  }
}

/** Why the Pond cannot listen in the room, and what to do about it. */
export function unavailableWords(reason: RoomVoiceUnavailable | null): string {
  switch (reason) {
    case 'no_mic_speaker_pair':
      return i18n.t('voiceRoom.unavailable.noMicSpeaker');
    case 'voice_running_elsewhere':
      return i18n.t('voiceRoom.unavailable.runningElsewhere');
    case 'models_missing':
      return i18n.t('voiceRoom.unavailable.modelsMissing');
    case null:
      return i18n.t('voiceRoom.unavailable.unknown');
  }
}

export function detectorWords(kind: WakeDetectorKind): string {
  return kind === 'hey_goose' ? i18n.t('voiceRoom.detector.heyGoose') : i18n.t('voiceRoom.detector.whisper');
}

/** How someone stops a reply in the room, by the rule the Pond is using. */
export function interruptWords(rule: VoiceRoom['interrupts'], phrase: string): string {
  const said = phrase.trim() || i18n.t('voiceRoom.defaultPhrase');
  return rule === 'enrolled_or_wake'
    ? i18n.t('voiceRoom.interrupts.enrolledOrWake', { phrase: said })
    : i18n.t('voiceRoom.interrupts.wakeOnly', { phrase: said });
}

export function interruptedWords(why: NonNullable<RoomLive['interrupted']>): string {
  switch (why) {
    case 'voice':
      return i18n.t('voiceRoom.interrupted.voice');
    case 'wake_word':
      return i18n.t('voiceRoom.interrupted.wakeWord');
    case 'button':
      return i18n.t('voiceRoom.interrupted.button');
  }
}

/** Whether the room is saying or about to say something an interrupt would stop. */
export function canInterrupt(state: RoomVoiceState): boolean {
  return state === 'thinking' || state === 'speak';
}

// ── The Voice agent's form ──────────────────────────────────

export interface VoiceAgentDraft {
  instructions: string;
  examples: VoiceAgentExample[];
  /** Groups switched off here; the Pond's list says which it offers. */
  off: string[];
  maxTurns: number;
}

export function draftOf(agent: VoiceAgent): VoiceAgentDraft {
  return {
    instructions: agent.instructions,
    examples: agent.examples.map((e) => ({ ...e })),
    off: agent.tool_groups.filter((g) => !g.on).map((g) => g.group),
    maxTurns: agent.max_turns,
  };
}

function sameExamples(a: readonly VoiceAgentExample[], b: readonly VoiceAgentExample[]): boolean {
  return a.length === b.length && a.every((e, i) => e.brief === b[i].brief && e.answer === b[i].answer);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** Only what changed, so a save never sends back a field the form did not touch. Null when nothing did. */
export function patchFrom(agent: VoiceAgent, draft: VoiceAgentDraft): VoiceAgentPatch | null {
  const was = draftOf(agent);
  const patch: VoiceAgentPatch = {};
  if (draft.instructions !== was.instructions) patch.instructions = draft.instructions;
  const examples = draft.examples.filter((e) => e.brief.trim() || e.answer.trim());
  if (!sameExamples(examples, was.examples)) patch.examples = examples;
  if (!sameSet(draft.off, was.off)) patch.tool_groups_off = [...draft.off];
  if (draft.maxTurns !== was.maxTurns) patch.max_turns = draft.maxTurns;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** The form's field for a refusal's path, so the problem shows under the field it is about. */
export function voiceAgentField(path: string): 'instructions' | 'examples' | 'tools' | 'maxTurns' | null {
  const p = path.replace(/^giap_role\./, '');
  if (p.startsWith('instructions')) return 'instructions';
  if (p.startsWith('examples') || p.startsWith('context.examples')) return 'examples';
  if (p.startsWith('tool_groups')) return 'tools';
  if (p.startsWith('max_turns')) return 'maxTurns';
  return null;
}

// ── Voice Match ─────────────────────────────────────────────

/** Takes the Pond asks for; it says its own number in each answer. */
export const VOICE_PRINT_TAKES = 5;

/** The phrase as said to start a sentence: "hey goose" begins "Hey goose, ...". */
function opening(phrase: string): string {
  const p = phrase.trim() || i18n.t('voiceRoom.defaultPhrase');
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/**
 * The five sentences read while teaching Goose a voice: each starts with the household's wake
 * phrase and asks for something Goose does. Never music, which Spotify's terms keep off voice.
 */
export function teachSentences(phrase: string): string[] {
  const p = opening(phrase);
  return [
    i18n.t('teachVoice.sentences.weather', { phrase: p }),
    i18n.t('teachVoice.sentences.timer', { phrase: p }),
    i18n.t('teachVoice.sentences.reminder', { phrase: p }),
    i18n.t('teachVoice.sentences.calendar', { phrase: p }),
    i18n.t('teachVoice.sentences.question', { phrase: p }),
  ];
}

function verdict(raw: unknown): WakeDetectorVerdict | null {
  const v = record(raw);
  if (!v) return null;
  return { kind: detector(v.kind), heard: count(v.heard), of: count(v.of), reason: text(v.reason) };
}

/** One take's answer; null for a body that is not one, which the screen says rather than guess. */
export function readVoiceTake(raw: unknown): VoiceTakeResult | null {
  const r = record(raw);
  const wake = record(r?.wake);
  const verdictOf = verdict(r?.wake_detector);
  if (!r || typeof r.take !== 'number' || !wake || !verdictOf) return null;
  const match = record(r.voice_match);
  return {
    take: count(r.take),
    of: count(r.of, VOICE_PRINT_TAKES) || VOICE_PRINT_TAKES,
    wake: { heard: wake.heard === true, heard_as: typeof wake.heard_as === 'string' && wake.heard_as ? wake.heard_as : null },
    voice_match: match ? { stored: match.stored === true, enrolled: match.enrolled === true, consistency: fraction(match.consistency) } : null,
    wake_detector: verdictOf,
  };
}

/** Whether the detector heard the latest take: its count of heard takes went up with it. */
export function detectorHeardTake(before: WakeDetectorVerdict | null, after: WakeDetectorVerdict): boolean {
  const heardBefore = before && before.of < after.of ? before.heard : 0;
  return after.heard > heardBefore;
}

/** Known voices first, then those part-way, then everyone else, each by name. */
export function orderMembers(members: readonly VoicePrintMember[]): VoicePrintMember[] {
  const rank = (m: VoicePrintMember) => (m.enrolled ? 0 : m.takes > 0 ? 1 : 2);
  return [...members].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function memberStatus(m: VoicePrintMember): string {
  if (m.enrolled) return i18n.t('voiceMatch.member.known');
  if (m.takes > 0) return i18n.t('voiceMatch.member.partWay', { takes: m.takes, needed: m.needed });
  return i18n.t('voiceMatch.member.notKnown');
}

/**
 * How alike a person's takes sound. Low means one take was noisy or read differently, and the
 * print will match them less often, which re-recording fixes.
 */
export function consistencyWords(consistency: number | null): string | null {
  if (consistency === null) return null;
  if (consistency >= 0.75) return i18n.t('voiceMatch.consistency.steady');
  if (consistency >= 0.55) return i18n.t('voiceMatch.consistency.fair');
  return i18n.t('voiceMatch.consistency.uneven');
}
