// The mock Pond reaches every state the voice screens draw, on a clock a test moves.

import { ApiError } from '@/services/api-client';
import type { RoomVoiceEvent } from '@/services/types';
import { MOCK_MODEL_MS, MOCK_ROOM_START_MS, createMockVoice } from '../voice-mock';

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

it('starts listening a moment after it is switched back on', async () => {
  const c = clock();
  const pond = createMockVoice(c.now);
  expect((await pond.room()).state).toBe('wait');
  expect((await pond.setRoom(false)).state).toBe('off');
  expect((await pond.setRoom(true)).state).toBe('starting');
  c.advance(MOCK_ROOM_START_MS);
  expect((await pond.room()).state).toBe('wait');
});

it('refuses a bad group and cap at their paths, as the Pond does, and saves and resets the rest', async () => {
  const rebuild = jest.fn().mockResolvedValue(undefined);
  const pond = createMockVoice(clock().now, async () => null, rebuild);
  const refusal = await pond.updateAgent({ tool_groups_off: ['giap-nope'], max_turns: 0, examples: [{ brief: 'Hi', answer: ' ' }] }).catch((e: unknown) => e);
  expect(refusal).toBeInstanceOf(ApiError);
  expect((refusal as ApiError).status).toBe(422);
  expect(((refusal as ApiError).body as { errors: { path: string }[] }).errors.map((e) => e.path)).toEqual([
    'examples[0].answer',
    'tool_groups_off[0]',
    'max_turns',
  ]);
  expect(rebuild).not.toHaveBeenCalled();

  const shipped = await pond.agent();
  expect(shipped).toMatchObject({ edited: false, examples: [], max_turns: null, shipped_max_turns: 0 });
  const capped = await pond.updateAgent({ max_turns: 3 });
  expect(capped).toMatchObject({ edited: true, max_turns: 3 });
  expect(await pond.updateAgent({ max_turns: null })).toMatchObject({ edited: false, max_turns: null });
  expect(await pond.updateAgent({ instructions: ' ' })).toMatchObject({ edited: false, instructions: shipped.shipped_instructions });
  rebuild.mockClear();

  const saved = await pond.updateAgent({ instructions: 'Be brief.', tool_groups_off: ['giap-knowledge'] });
  expect(saved).toMatchObject({ edited: true, instructions: 'Be brief.' });
  expect(saved.tool_groups.find((g) => g.group === 'giap-knowledge')?.on).toBe(false);
  expect(rebuild).toHaveBeenCalledTimes(1);

  const reset = await pond.resetAgent();
  expect(reset.edited).toBe(false);
  expect(reset.instructions).toBe(reset.shipped_instructions);
  expect(rebuild).toHaveBeenCalledTimes(2);
});

it('downloads its speaker model before it learns a voice, refuses one sentence, then learns five', async () => {
  const c = clock();
  const pond = createMockVoice(c.now);
  const first = await pond.prints();
  expect(first.model.state).toBe('downloading');
  expect(first.model.credit).toContain('CC BY 4.0');
  const take = (voiceMatch = true) =>
    pond.take({ fileUri: 'file:///t.wav', prompt: 'Hey goose, set a timer.', profileId: 'mock-zawadi', voiceMatch });
  expect(((await take().catch((e: unknown) => e)) as ApiError).status).toBe(409);

  c.advance(MOCK_MODEL_MS);
  const fired: boolean[] = [];
  const one = await take();
  expect(one.take).toBe(1);
  fired.push(one.wake.new_detector);
  const refused = (await take().catch((e: unknown) => e)) as ApiError;
  expect(refused.status).toBe(422);
  expect(refused.body).toEqual({ error: 'no_wake_phrase', heard_as: 'hey ghost' });
  let last = one;
  for (let i = 0; i < 4; i += 1) {
    last = await take();
    fired.push(last.wake.new_detector);
  }
  expect(fired).toEqual([true, true, false, true, true]);
  expect(last).toMatchObject({ take: 5, of: 5, voice_match: { stored: true, enrolled: true } });
  expect(last.wake_detector).toMatchObject({ kind: 'hey_goose', heard: 4, of: 5 });
  // The next run adds to the household's verdict rather than starting it again.
  expect((await take()).take).toBe(1);

  await pond.forget('mock-zawadi');
  expect((await pond.prints()).members.find((m) => m.profile_id === 'mock-zawadi')).toMatchObject({ takes: 0, enrolled: false });
});

it('tunes the wake phrase alone with Voice Match off, storing no print', async () => {
  const pond = createMockVoice(clock().now);
  const result = await pond.take({ fileUri: 'file:///t.wav', prompt: 'Hey duck, set a timer.', profileId: null, voiceMatch: false });
  expect(result.voice_match).toBeNull();
  expect(result.wake_detector.kind).toBe('whisper');
});

it('plays a turn on an open stream and stops when it is closed', async () => {
  jest.useFakeTimers();
  try {
    const c = clock();
    const pond = createMockVoice(c.now);
    const seen: RoomVoiceEvent[] = [];
    const controller = new AbortController();
    const done = pond.streamRoom((e) => seen.push(e), controller.signal, () => {});
    c.advance(5_000);
    for (let i = 0; i < 20; i += 1) jest.advanceTimersByTime(700);
    expect(seen[0]).toEqual({ event: 'wake', who: { profile_id: 'mock-amina', name: 'Amina' } });
    expect(seen.some((e) => e.event === 'turn_complete')).toBe(true);
    controller.abort();
    await done;
    const count = seen.length;
    jest.advanceTimersByTime(60_000);
    expect(seen).toHaveLength(count);
  } finally {
    jest.useRealTimers();
  }
});

it('pauses the room until the pause runs out or it is resumed, and plays no turn while paused', async () => {
  const c = clock();
  const pond = createMockVoice(c.now);
  await pond.pauseRoom(120);
  const paused = await pond.room();
  expect(paused.state).toBe('paused');
  expect(paused.paused_until).toBe(new Date(c.now() + 120_000).toISOString());
  c.advance(120_000);
  expect(await pond.room()).toMatchObject({ state: 'wait', paused_until: null });

  await pond.pauseRoom(120);
  await pond.resumeRoom();
  expect(await pond.room()).toMatchObject({ state: 'wait', paused_until: null });
});

it('takes thinking first as the Pond does: auto or null is the shipped agent, and a bad value is refused at its path', async () => {
  const pond = createMockVoice(clock().now);
  expect(await pond.agent()).toMatchObject({ edited: false, thinking: 'auto' });
  expect(await pond.updateAgent({ thinking: 'on' })).toMatchObject({ edited: true, thinking: 'on' });
  expect(await pond.updateAgent({ thinking: null })).toMatchObject({ edited: false, thinking: 'auto' });
  const refusal = await pond.updateAgent({ thinking: 'sometimes' as never }).catch((e: unknown) => e);
  expect((refusal as ApiError).status).toBe(422);
  expect(((refusal as ApiError).body as { errors: { path: string }[] }).errors.map((e) => e.path)).toEqual(['thinking']);
});
