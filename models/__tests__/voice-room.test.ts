// The voice routes' readers hold the line between a body that is news and one that is not the route's
// at all; the rest is the words and the form the screens build from them.

import i18n from '@/services/i18n';
import type { VoiceAgent, VoicePrintMember } from '@/services/types';
import {
  QUIET_ROOM,
  consistencyWords,
  draftOf,
  foldRoomEvent,
  interruptWords,
  maxTurnsNote,
  orderMembers,
  patchFrom,
  readRoomVoiceEvent,
  readVoiceAgent,
  readVoicePrints,
  readVoiceRoom,
  readVoiceTake,
  roomStateWords,
  shownMaxTurns,
  teachSentences,
  voiceAgentExampleField,
  voiceAgentField,
  voiceAgentProblem,
  wakeReasonWords,
} from '../voice-room';

const ROOM = {
  enabled: true,
  available: true,
  unavailable_reason: null,
  state: 'wait',
  wake: { phrase: 'hey goose', detector: 'hey_goose', reason: 'calibrated' },
  interrupts: 'enrolled_or_wake',
  last_heard: { profile_id: 'p1', name: 'Amina', at: '2026-11-02T10:00:00Z' },
  session_id: 's1',
  paused_until: null,
};

describe('reading the room', () => {
  it('reads a room paused while a voice is taught, and says so', () => {
    const paused = readVoiceRoom({ ...ROOM, state: 'paused', paused_until: '2026-11-03T10:02:00Z' });
    expect(paused).toMatchObject({ state: 'paused', paused_until: '2026-11-03T10:02:00Z' });
    expect(readVoiceRoom({ ...ROOM, paused_until: '' })?.paused_until).toBeNull();
    expect(roomStateWords('paused')).toBe('Paused while you teach Goose your voice.');
    expect(readRoomVoiceEvent({ event: 'state', state: 'paused' })).toEqual({ event: 'state', state: 'paused' });
  });

  it('reads a status as the contract writes it', () => {
    expect(readVoiceRoom(ROOM)).toEqual(ROOM);
  });

  it('refuses a body with no state it knows, and keeps an unavailable room unavailable', () => {
    expect(readVoiceRoom({ ...ROOM, state: 'dancing' })).toBeNull();
    expect(readVoiceRoom(null)).toBeNull();
    const down = readVoiceRoom({ ...ROOM, available: false, unavailable_reason: 'something new', last_heard: null, session_id: '' });
    expect(down).toMatchObject({ available: false, unavailable_reason: null, last_heard: null, session_id: null });
  });

  it('takes an unknown detector or interrupt rule as the cautious one', () => {
    const odd = readVoiceRoom({ ...ROOM, wake: { phrase: 'hey goose', detector: 'cnn2' }, interrupts: 'anyone' });
    expect(odd?.wake.detector).toBe('whisper');
    expect(odd?.interrupts).toBe('wake_only');
  });

  it('says why the Pond listens with its detector in words, and nothing for a reason it does not know', () => {
    const nano = readVoiceRoom({ ...ROOM, wake: { phrase: 'goose', detector: 'whisper', reason: 'custom_phrase' }, interrupts: 'wake_only', last_heard: null });
    expect(nano?.wake).toEqual({ phrase: 'goose', detector: 'whisper', reason: 'custom_phrase' });
    expect(wakeReasonWords(nano?.wake.reason ?? null)).toMatch(/hey goose/);
    expect(readVoiceRoom({ ...ROOM, wake: { ...ROOM.wake, reason: 'a new reason' } })?.wake.reason).toBeNull();
    expect(wakeReasonWords(null)).toBeNull();
  });

  it('reads each event the stream sends, and drops the ones the phone has no use for', () => {
    expect(readRoomVoiceEvent({ event: 'state', state: 'listen' })).toEqual({ event: 'state', state: 'listen' });
    expect(readRoomVoiceEvent({ event: 'wake', who: { profile_id: 'p1', name: 'Amina' } })).toEqual({
      event: 'wake',
      who: { profile_id: 'p1', name: 'Amina' },
    });
    expect(readRoomVoiceEvent({ event: 'wake', who: null })).toEqual({ event: 'wake', who: null });
    expect(readRoomVoiceEvent({ event: 'interrupt', why: 'voice' })).toEqual({ event: 'interrupt', why: 'voice' });
    expect(readRoomVoiceEvent({ event: 'audio_level', rms: 0.4 })).toBeNull();
    expect(readRoomVoiceEvent({ event: 'state', state: 'nope' })).toBeNull();
  });
});

describe('the room, live', () => {
  it('follows a turn from the wake to the answer', () => {
    const events = [
      { event: 'wake', who: { profile_id: 'p1', name: 'Amina' } },
      { event: 'state', state: 'listen' },
      { event: 'transcript', text: ' What time is it? ' },
      { event: 'state', state: 'thinking' },
      { event: 'token', content: 'It is ' },
      { event: 'state', state: 'speak' },
      { event: 'token', content: 'ten.' },
    ] as const;
    const live = events.reduce((acc, e) => foldRoomEvent(acc, e), QUIET_ROOM);
    expect(live).toMatchObject({ state: 'speak', heard: 'What time is it?', reply: 'It is ten.', woke: { name: 'Amina' } });
  });

  it('keeps why a reply stopped until the next turn starts listening', () => {
    let live = foldRoomEvent({ ...QUIET_ROOM, state: 'speak', reply: 'Long answer' }, { event: 'interrupt', why: 'wake_word' });
    live = foldRoomEvent(live, { event: 'state', state: 'wait' });
    expect(live.interrupted).toBe('wake_word');
    live = foldRoomEvent(live, { event: 'state', state: 'listen' });
    expect(live).toMatchObject({ interrupted: null, reply: '' });
  });

  it('names how to stop it by the rule in use', () => {
    expect(interruptWords('wake_only', 'hey goose')).toContain('hey goose');
    expect(interruptWords('enrolled_or_wake', '')).toContain('Voice Match');
  });
});

const AGENT = {
  name: 'voice',
  title: 'Voice',
  edited: false,
  instructions: 'Answer out loud.',
  shipped_instructions: 'Answer out loud.',
  examples: [{ brief: 'Weather?', answer: 'Sunny.' }],
  tool_groups: [
    { group: 'giap-weather', label: 'Weather', on: true },
    { group: 'giap-memory', label: 'Memory', on: false },
  ],
  max_turns: 4,
  shipped_max_turns: 0,
  thinking: 'auto',
  prefill: { agent: 'voice', kind: 'default', status: 'ready', compiled_at: '2026-11-02T09:00:00Z', last_used_at: null },
};

describe('the Voice agent', () => {
  it('reads whether it thinks first, and sends a change of it alone', () => {
    expect(readVoiceAgent({ ...AGENT, thinking: 'on' })?.thinking).toBe('on');
    expect(readVoiceAgent({ ...AGENT, thinking: 'sometimes' })?.thinking).toBeNull();
    const { thinking: _, ...older } = AGENT;
    const old = readVoiceAgent(older) as VoiceAgent;
    expect(old.thinking).toBeNull();
    expect(patchFrom(old, draftOf(old))).toBeNull();

    const agent = readVoiceAgent(AGENT) as VoiceAgent;
    expect(patchFrom(agent, { ...draftOf(agent), thinking: 'off' })).toEqual({ thinking: 'off' });
    expect(patchFrom(agent, { ...draftOf(agent), thinking: 'auto' })).toBeNull();
    expect(voiceAgentField('thinking')).toBe('thinking');
    expect(voiceAgentProblem('thinking', 'is `sometimes`; it must be off, auto or on')).toBe('Thinking is `sometimes`; it must be off, auto or on.');
  });

  it('reads the agent, and gives a prefill row it cannot read a status it can', () => {
    expect(readVoiceAgent(AGENT)).toEqual(AGENT);
    expect(readVoiceAgent({ ...AGENT, prefill: null })?.prefill).toMatchObject({ agent: 'voice', status: 'not_built' });
    expect(readVoiceAgent({ title: 'Voice' })).toBeNull();
  });

  it('shows the Pond\'s own cap while the household has set none, and 0 hands it back', () => {
    const unset = readVoiceAgent({ ...AGENT, max_turns: null, shipped_max_turns: 8 }) as VoiceAgent;
    expect(unset).toMatchObject({ max_turns: null, shipped_max_turns: 8 });
    const draft = draftOf(unset);
    expect(shownMaxTurns(unset, draft)).toBe(8);
    expect(maxTurnsNote(unset, draft)).toBe(i18n.t('voiceAgent.uses.maxTurnsShipped'));
    expect(maxTurnsNote({ ...unset, shipped_max_turns: 0 }, draft)).toBe(i18n.t('voiceAgent.uses.maxTurnsNone'));
    expect(patchFrom(unset, { ...draft, maxTurns: 3 })).toEqual({ max_turns: 3 });

    const own = readVoiceAgent(AGENT) as VoiceAgent;
    expect(maxTurnsNote(own, draftOf(own))).toBeNull();
    expect(patchFrom(own, { ...draftOf(own), maxTurns: null })).toEqual({ max_turns: null });
    expect(readVoiceAgent({ ...AGENT, max_turns: 0, shipped_max_turns: 'eight' })).toMatchObject({ max_turns: null, shipped_max_turns: null });
  });

  it('sends only what changed, and nothing when nothing did', () => {
    const agent = readVoiceAgent(AGENT) as VoiceAgent;
    const draft = draftOf(agent);
    expect(draft.off).toEqual(['giap-memory']);
    expect(patchFrom(agent, draft)).toBeNull();
    expect(patchFrom(agent, { ...draft, instructions: 'Be brief.' })).toEqual({ instructions: 'Be brief.' });
    expect(patchFrom(agent, { ...draft, off: ['giap-memory', 'giap-weather'] })).toEqual({ tool_groups_off: ['giap-memory', 'giap-weather'] });
    expect(patchFrom(agent, { ...draft, off: [] })).toEqual({ tool_groups_off: [] });
    expect(patchFrom(agent, { ...draft, maxTurns: 2 })).toEqual({ max_turns: 2 });
  });

  it('leaves an empty example out, so adding one and typing nothing changes nothing', () => {
    const agent = readVoiceAgent(AGENT) as VoiceAgent;
    const draft = draftOf(agent);
    expect(patchFrom(agent, { ...draft, examples: [...draft.examples, { brief: ' ', answer: '' }] })).toBeNull();
    expect(patchFrom(agent, { ...draft, examples: [] })).toEqual({ examples: [] });
  });

  it('puts a refusal under the field its path names', () => {
    expect(voiceAgentField('instructions')).toBe('instructions');
    expect(voiceAgentField('examples[2].brief')).toBe('examples');
    expect(voiceAgentField('tool_groups_off[0]')).toBe('tools');
    expect(voiceAgentField('max_turns')).toBe('maxTurns');
    expect(voiceAgentField('')).toBeNull();
    expect(voiceAgentField('giap_role.instructions')).toBe('instructions');
    expect(voiceAgentField('giap_role.context.examples[0].answer')).toBe('examples');
    expect(voiceAgentField('giap_role.tool_groups[1]')).toBe('tools');
    expect(voiceAgentField('giap_role.max_turns')).toBe('maxTurns');
    expect(voiceAgentField('giap_role.activations')).toBeNull();
  });

  it('puts an example refusal under that example field', () => {
    expect(voiceAgentExampleField('examples[0].answer')).toBe('0.answer');
    expect(voiceAgentExampleField('giap_role.context.examples[3].brief')).toBe('3.brief');
    expect(voiceAgentExampleField('examples[1]')).toBeNull();
    expect(voiceAgentExampleField('examples')).toBeNull();
  });

  it('says a refusal as a sentence that names its field', () => {
    expect(voiceAgentProblem('examples[0].answer', 'is empty')).toBe('Answer 1 is empty.');
    expect(voiceAgentProblem('examples[2].brief', 'is 2100 characters; the most is 2000')).toBe(
      'Question 3 is 2100 characters; the most is 2000.',
    );
    expect(voiceAgentProblem('instructions', 'is 4100 characters; the most is 4000, since every spoken turn carries it')).toBe(
      'The text is 4100 characters; the most is 4000, since every spoken turn carries it.',
    );
    expect(voiceAgentProblem('examples', 'has 9 examples; the most is 8, since every spoken turn carries them')).toBe(
      'This agent has 9 examples; the most is 8, since every spoken turn carries them.',
    );
    expect(voiceAgentProblem('max_turns', 'is 13; it must be from 1 to 12')).toBe('The number is 13; it must be from 1 to 12.');
    expect(voiceAgentProblem('tool_groups_off[0]', '`giap-nope` is never part of a spoken turn')).toBe(
      '`giap-nope` is never part of a spoken turn.',
    );
    expect(voiceAgentProblem('colour', 'is not a field of the Voice agent')).toBe('`colour` is not a field of the Voice agent.');
    expect(voiceAgentProblem('', 'the body must be a JSON object')).toBe('The body must be a JSON object.');
  });
});

describe('Voice Match', () => {
  const member = (over: Partial<VoicePrintMember>): VoicePrintMember => ({
    profile_id: 'p',
    name: 'P',
    takes: 0,
    needed: 5,
    enrolled: false,
    consistency: null,
    updated_at: null,
    ...over,
  });

  it('reads the listing, and refuses one with no members', () => {
    const prints = readVoicePrints({
      model: { state: 'downloading', progress: 1.4, credit: 'CC BY 4.0' },
      members: [{ profile_id: 'p1', name: 'Amina', takes: 2, needed: 5, enrolled: false, consistency: 0.6 }, { name: 'nobody' }],
    });
    expect(prints?.model).toEqual({ state: 'downloading', progress: 1, credit: 'CC BY 4.0' });
    expect(prints?.members).toHaveLength(1);
    expect(readVoicePrints({ model: { state: 'ready' } })).toBeNull();
  });

  it('lists known voices first, then those part-way, then by name', () => {
    const order = orderMembers([
      member({ profile_id: 'z', name: 'Zawadi' }),
      member({ profile_id: 'b', name: 'Baraka', takes: 2 }),
      member({ profile_id: 'a', name: 'Amina', takes: 5, enrolled: true }),
      member({ profile_id: 'c', name: 'Chege' }),
    ]);
    expect(order.map((m) => m.name)).toEqual(['Amina', 'Baraka', 'Chege', 'Zawadi']);
  });

  it('says nothing about consistency before there is any', () => {
    expect(consistencyWords(null)).toBeNull();
    expect(consistencyWords(0.9)).not.toBe(consistencyWords(0.3));
  });
});

describe('teaching Goose a voice', () => {
  it('starts every sentence with the household phrase, a custom one too, and never asks for music', () => {
    const sentences = teachSentences('hey goose');
    expect(sentences).toHaveLength(5);
    expect(sentences.every((s) => s.startsWith('Hey goose, '))).toBe(true);
    expect(teachSentences('jambo bata').every((s) => s.startsWith('Jambo bata, '))).toBe(true);
    expect(sentences.join(' ')).not.toMatch(/music|song|play|spotify/i);
  });

  it('reads a take, and refuses a body without the detector verdict', () => {
    const take = {
      take: 2,
      of: 5,
      wake: { heard: true, heard_as: 'hey goose', new_detector: true },
      voice_match: { stored: true, enrolled: false, consistency: null },
      wake_detector: { kind: 'hey_goose', heard: 2, of: 2, reason: 'calibrated' },
    };
    expect(readVoiceTake(take)).toEqual(take);
    expect(readVoiceTake({ ...take, voice_match: null })?.voice_match).toBeNull();
    expect(readVoiceTake({ ...take, wake: { heard: false, heard_as: null } })?.wake.new_detector).toBe(false);
    expect(readVoiceTake({ ...take, wake_detector: undefined })).toBeNull();
  });
});
