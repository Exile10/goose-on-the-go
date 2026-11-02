// An in-memory Pond for room voice, the Voice agent and Voice Match, answering as the contract says
// the real one will. Time is read from the clock at each call, so nothing runs unasked and a test can
// move it; only an open event stream keeps a timer, and closing the stream stops it.

import { ApiError } from '@/services/api-client';
import type {
  AgentPrefill,
  RecipeFieldError,
  RoomVoiceEvent,
  VoiceAgent,
  VoiceAgentExample,
  VoiceAgentPatch,
  VoicePrintMember,
  VoicePrints,
  VoiceRoom,
  VoiceTakeResult,
  VoiceThinking,
  WakeDetectorVerdict,
} from '@/services/types';

import { VOICE_PRINT_TAKES } from './voice-room';

/** The routes the voice screens use, so the real Pond and this one are driven by the same code. */
export interface VoiceSource {
  room(): Promise<VoiceRoom>;
  setRoom(enabled: boolean): Promise<VoiceRoom>;
  interrupt(): Promise<void>;
  streamRoom(onEvent: (event: RoomVoiceEvent) => void, signal: AbortSignal, onOpen: () => void): Promise<void>;
  agent(): Promise<VoiceAgent>;
  updateAgent(patch: VoiceAgentPatch): Promise<VoiceAgent>;
  resetAgent(): Promise<VoiceAgent>;
  prints(): Promise<VoicePrints>;
  retryModel(): Promise<void>;
  /** Asks the room not to listen for `seconds` (`POST /voice/room/pause`); asking again renews it. */
  pauseRoom(seconds: number): Promise<void>;
  /** Lets the room listen again before its pause runs out (`POST /voice/room/resume`). */
  resumeRoom(): Promise<void>;
  /** One sentence read while teaching Goose a voice (`POST /voice/takes`). */
  take(take: { fileUri: string; prompt: string; profileId: string | null; voiceMatch: boolean }): Promise<VoiceTakeResult>;
  /** Clears what earlier runs taught about the wake phrase (`DELETE /voice/calibrate`). */
  resetCalibration(): Promise<void>;
  forget(profileId: string): Promise<void>;
}

/** How long the mock room takes to start listening after it is switched on. */
export const MOCK_ROOM_START_MS = 2_000;
/** How long the mock speaker model takes to download. */
export const MOCK_MODEL_MS = 15_000;
/** How long the mock room waits between turns while its stream is open. */
export const MOCK_TURN_EVERY_MS = 20_000;

export const MOCK_CREDIT = 'Speaker model: WeSpeaker ResNet34, trained on VoxCeleb. CC BY 4.0.';

const SHIPPED_INSTRUCTIONS = `You are answering out loud, to someone in the room.
Say the answer first, in one or two short sentences. Use plain words a listener can follow:
no lists, no headings, no links, no symbols to read out. If you need something from them,
ask one short question.`;

// The Pond's own labels for the groups a spoken turn may have.
const GROUPS = [
  { group: 'giap-memory', label: 'What the household has said' },
  { group: 'giap-system', label: 'The time and this machine' },
  { group: 'giap-schedule', label: 'Timers, reminders and schedules' },
  { group: 'giap-weather', label: 'Weather' },
  { group: 'giap-knowledge', label: 'Web search and Wikipedia' },
  { group: 'giap-device-control', label: 'Switching devices' },
];

/** The Pond's limits on an edit, which every spoken turn's preamble carries. */
const MAX_INSTRUCTIONS_CHARS = 4_000;
const MAX_EXAMPLES = 8;
const MAX_EXAMPLE_CHARS = 2_000;
const MAX_TURNS = 12;

/** The household's edit, as the Pond keeps it; null fields are the shipped agent's. */
interface MockVoiceEdit {
  instructions: string | null;
  examples: VoiceAgentExample[];
  off: string[];
  maxTurns: number | null;
  thinking: VoiceThinking | null;
}

const UNEDITED: MockVoiceEdit = { instructions: null, examples: [], off: [], maxTurns: null, thinking: null };
const THINKING: readonly VoiceThinking[] = ['off', 'auto', 'on'];

/** A turn the mock room plays while its stream is open: someone wakes it, asks, and is answered. */
function scriptedTurn(who: { profile_id: string; name: string } | null): RoomVoiceEvent[] {
  return [
    { event: 'wake', who },
    { event: 'state', state: 'listen' },
    { event: 'transcript', text: 'What is the weather like this afternoon?' },
    { event: 'state', state: 'thinking' },
    { event: 'tool_call', tool: 'giap-weather__get_weather', id: 'mock-1' },
    { event: 'token', content: 'Sunny and warm, ' },
    { event: 'state', state: 'speak' },
    { event: 'token', content: 'about twenty-six degrees, ' },
    { event: 'token', content: 'with rain likely after four.' },
    { event: 'turn_complete', session_id: 'mock-room' },
    { event: 'state', state: 'wait' },
  ];
}

/**
 * A fresh mock Pond, reading `now` as its clock in milliseconds. `prefill` is the agents mock's own
 * row for the Voice agent, and `rebuild` queues it there, so Agents and this page agree.
 */
export function createMockVoice(
  now: () => number = Date.now,
  prefill: () => Promise<AgentPrefill | null> = async () => null,
  rebuild: () => Promise<void> = async () => {},
): VoiceSource {
  let enabled = true;
  let startedAt = now() - MOCK_ROOM_START_MS;
  let state: VoiceRoom['state'] = 'wait';
  let lastHeard: VoiceRoom['last_heard'] = null;
  let pausedUntil: number | null = null;
  const streams = new Set<(event: RoomVoiceEvent) => void>();

  const members: VoicePrintMember[] = [
    { profile_id: 'mock-amina', name: 'Amina', takes: 5, needed: VOICE_PRINT_TAKES, enrolled: true, consistency: 0.82, updated_at: new Date(now() - 86_400_000).toISOString() },
    { profile_id: 'mock-baraka', name: 'Baraka', takes: 2, needed: VOICE_PRINT_TAKES, enrolled: false, consistency: 0.61, updated_at: new Date(now() - 3_600_000).toISOString() },
    { profile_id: 'mock-zawadi', name: 'Zawadi', takes: 0, needed: VOICE_PRINT_TAKES, enrolled: false, consistency: null, updated_at: null },
  ];
  let modelFrom: number | null = null;
  let modelFailed = false;

  let edits: MockVoiceEdit | null = null;

  // A run of takes, which ends at the fifth: its second sentence is refused once, so the refusal can
  // be seen without a Pond. The detector's verdict is the household's, across runs.
  let run = { taken: 0, tries: 0 };
  let detector: WakeDetectorVerdict = { kind: 'whisper', heard: 0, of: 0, reason: 'not_calibrated' };

  const anyEnrolled = () => members.some((m) => m.enrolled);

  const settleRoom = () => {
    if (pausedUntil !== null && now() >= pausedUntil) pausedUntil = null;
    if (!enabled) state = 'off';
    else if (now() < startedAt + MOCK_ROOM_START_MS) state = 'starting';
    else if (pausedUntil !== null) state = 'paused';
    else if (state === 'off' || state === 'starting' || state === 'paused') state = 'wait';
  };

  const emit = (event: RoomVoiceEvent) => {
    if (event.event === 'state') state = event.state;
    if (event.event === 'wake' && event.who) lastHeard = { ...event.who, at: new Date(now()).toISOString() };
    streams.forEach((send) => send(event));
  };

  const room = (): VoiceRoom => {
    settleRoom();
    return {
      enabled,
      available: true,
      unavailable_reason: null,
      state,
      wake: { phrase: 'hey goose', detector: 'whisper', reason: 'not_calibrated' },
      interrupts: anyEnrolled() ? 'enrolled_or_wake' : 'wake_only',
      last_heard: lastHeard,
      session_id: 'mock-room',
      paused_until: state === 'paused' && pausedUntil !== null ? new Date(pausedUntil).toISOString() : null,
    };
  };

  const model = (): VoicePrints['model'] => {
    if (modelFailed) return { state: 'failed', progress: null, credit: MOCK_CREDIT };
    if (modelFrom === null) modelFrom = now();
    const done = (now() - modelFrom) / MOCK_MODEL_MS;
    return done >= 1 ? { state: 'ready', progress: null, credit: MOCK_CREDIT } : { state: 'downloading', progress: Math.max(0, done), credit: MOCK_CREDIT };
  };

  const agent = async (): Promise<VoiceAgent> => {
    const row = (await prefill()) ?? { agent: 'voice', kind: 'default', status: 'ready', compiled_at: null, last_used_at: null };
    const off = edits?.off ?? [];
    return {
      name: 'voice',
      title: 'Voice',
      edited: edits !== null,
      instructions: edits?.instructions ?? SHIPPED_INSTRUCTIONS,
      shipped_instructions: SHIPPED_INSTRUCTIONS,
      examples: (edits?.examples ?? []).map((e) => ({ ...e })),
      tool_groups: GROUPS.map((g) => ({ ...g, on: !off.includes(g.group) })),
      max_turns: edits?.maxTurns ?? null,
      shipped_max_turns: 0,
      thinking: edits?.thinking ?? 'auto',
      prefill: { ...row },
    };
  };

  const member = (profileId: string) => {
    const found = members.find((m) => m.profile_id === profileId);
    if (!found) throw new ApiError(`mock /voice/prints/${profileId} → 404`, 404, null, 'no such member');
    return found;
  };

  return {
    room: async () => room(),
    setRoom: async (on) => {
      if (on && !enabled) startedAt = now();
      enabled = on;
      return room();
    },
    interrupt: async () => {
      settleRoom();
      if (state === 'speak' || state === 'thinking') {
        emit({ event: 'interrupt', why: 'button' });
        emit({ event: 'state', state: 'wait' });
      }
    },
    pauseRoom: async (seconds) => {
      pausedUntil = now() + seconds * 1000;
      settleRoom();
      emit({ event: 'state', state });
    },
    resumeRoom: async () => {
      pausedUntil = null;
      settleRoom();
      emit({ event: 'state', state });
    },
    streamRoom: (onEvent, signal, onOpen) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        streams.add(onEvent);
        onOpen();
        let step = 0;
        let script: RoomVoiceEvent[] = [];
        let nextTurnAt = now() + 3_000;
        const timer = setInterval(() => {
          settleRoom();
          if (state === 'paused') {
            script = [];
            step = 0;
            return;
          }
          if (state === 'off' || state === 'starting') return;
          if (step < script.length) {
            emit(script[step]);
            step += 1;
            return;
          }
          if (now() < nextTurnAt) return;
          script = scriptedTurn(anyEnrolled() ? { profile_id: 'mock-amina', name: 'Amina' } : null);
          step = 0;
          nextTurnAt = now() + MOCK_TURN_EVERY_MS;
        }, 700);
        signal.addEventListener('abort', () => {
          clearInterval(timer);
          streams.delete(onEvent);
          resolve();
        });
      }),
    agent,
    // As the Pond's VoiceAgent::patched: a field left out stays, empty text is the shipped text again.
    updateAgent: async (patch) => {
      const errors: RecipeFieldError[] = [];
      const was = edits ?? UNEDITED;
      const next: MockVoiceEdit = { ...was, examples: was.examples.map((e) => ({ ...e })), off: [...was.off] };
      if (patch.instructions !== undefined) {
        const count = [...patch.instructions].length;
        if (count > MAX_INSTRUCTIONS_CHARS) {
          errors.push({ path: 'instructions', message: `is ${count} characters; the most is ${MAX_INSTRUCTIONS_CHARS}, since every spoken turn carries it` });
        }
        next.instructions = patch.instructions.trim() ? patch.instructions : null;
      }
      if (patch.examples !== undefined) {
        if (patch.examples.length > MAX_EXAMPLES) {
          errors.push({ path: 'examples', message: `has ${patch.examples.length} examples; the most is ${MAX_EXAMPLES}, since every spoken turn carries them` });
        }
        patch.examples.forEach((e, i) => {
          for (const field of ['brief', 'answer'] as const) {
            const count = [...e[field]].length;
            if (!e[field].trim()) errors.push({ path: `examples[${i}].${field}`, message: 'is empty' });
            else if (count > MAX_EXAMPLE_CHARS) errors.push({ path: `examples[${i}].${field}`, message: `is ${count} characters; the most is ${MAX_EXAMPLE_CHARS}` });
          }
        });
        next.examples = patch.examples.map((e) => ({ ...e }));
      }
      if (patch.tool_groups_off !== undefined) {
        const known = GROUPS.map((g) => g.group);
        patch.tool_groups_off.forEach((g, i) => {
          if (!known.includes(g)) errors.push({ path: `tool_groups_off[${i}]`, message: `\`${g}\` is not a tool group; the groups are ${JSON.stringify(known)}` });
        });
        next.off = [...new Set(patch.tool_groups_off)];
      }
      if (patch.max_turns !== undefined) {
        const n = patch.max_turns;
        if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= MAX_TURNS)) {
          errors.push({ path: 'max_turns', message: `is ${n}; it must be from 1 to ${MAX_TURNS}` });
        }
        next.maxTurns = n;
      }
      if (patch.thinking !== undefined) {
        const thinking = patch.thinking ?? 'auto';
        if (!THINKING.includes(thinking)) errors.push({ path: 'thinking', message: `is \`${String(thinking)}\`; it must be off, auto or on` });
        next.thinking = thinking === 'auto' ? null : thinking;
      }
      if (errors.length > 0) throw new ApiError('mock PUT /agents/voice → 422', 422, null, null, { errors });
      const edited =
        next.instructions !== null || next.examples.length > 0 || next.off.length > 0 || next.maxTurns !== null || next.thinking !== null;
      const changed = JSON.stringify(next) !== JSON.stringify(was);
      edits = edited ? next : null;
      if (changed) await rebuild();
      return agent();
    },
    resetAgent: async () => {
      if (edits !== null) {
        edits = null;
        await rebuild();
      }
      return agent();
    },
    prints: async () => ({ model: model(), members: members.map((m) => ({ ...m })) }),
    retryModel: async () => {
      modelFailed = false;
      modelFrom = now();
    },
    take: async ({ prompt, profileId, voiceMatch }) => {
      const m = voiceMatch ? member(profileId ?? '') : null;
      if (m && model().state !== 'ready') throw new ApiError('mock take → 409', 409, null, null, { error: 'model_not_ready' });
      if (run.taken >= VOICE_PRINT_TAKES) run = { taken: 0, tries: 0 };
      run.tries += 1;
      if (run.taken === 1 && run.tries === 2) {
        throw new ApiError('mock take → 422', 422, null, null, { error: 'no_wake_phrase', heard_as: 'hey ghost' });
      }
      run.taken += 1;
      // The detector misses the third sentence, and hears only "hey goose", as the Pond's own does.
      const heyGoose = /^hey goose\b/i.test(prompt.trim());
      const fired = heyGoose && run.taken !== 3;
      const heard = detector.heard + (fired ? 1 : 0);
      const of = detector.of + 1;
      detector = {
        kind: heyGoose && heard * 5 >= of * 4 ? 'hey_goose' : 'whisper',
        heard,
        of,
        reason: !heyGoose ? 'custom_phrase' : heard * 5 >= of * 4 ? 'calibrated' : 'not_calibrated',
      };
      let match: VoiceTakeResult['voice_match'] = null;
      if (m) {
        m.takes = Math.min(m.takes + 1, m.needed);
        m.enrolled = m.takes >= m.needed;
        m.consistency = m.takes >= 2 ? 0.7 + 0.03 * m.takes : null;
        m.updated_at = new Date(now()).toISOString();
        match = { stored: true, enrolled: m.enrolled, consistency: m.consistency };
      }
      return {
        take: run.taken,
        of: VOICE_PRINT_TAKES,
        wake: { heard: true, heard_as: prompt.split(',')[0], new_detector: fired },
        voice_match: match,
        wake_detector: { ...detector },
      };
    },
    resetCalibration: async () => {
      run = { taken: 0, tries: 0 };
      detector = { kind: 'whisper', heard: 0, of: 0, reason: 'not_calibrated' };
    },
    forget: async (profileId) => {
      const m = member(profileId);
      m.takes = 0;
      m.enrolled = false;
      m.consistency = null;
      m.updated_at = null;
    },
  };
}
