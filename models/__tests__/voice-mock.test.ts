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

it('refuses an empty instruction by its path, and saves and resets the rest', async () => {
  const rebuild = jest.fn().mockResolvedValue(undefined);
  const pond = createMockVoice(clock().now, async () => null, rebuild);
  const refusal = await pond.updateAgent({ instructions: ' ' }).catch((e: unknown) => e);
  expect(refusal).toBeInstanceOf(ApiError);
  expect((refusal as ApiError).status).toBe(422);
  expect((refusal as ApiError).body).toEqual({ errors: [expect.objectContaining({ path: 'giap_role.instructions' })] });

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
  await pond.resetCalibration();
  expect((await take()).take).toBe(1);
  const refused = (await take().catch((e: unknown) => e)) as ApiError;
  expect(refused.status).toBe(422);
  expect(refused.body).toEqual({ error: 'no_wake_phrase', heard_as: 'hey ghost' });
  let last = await take();
  for (let i = 0; i < 3; i += 1) last = await take();
  expect(last).toMatchObject({ take: 5, of: 5, voice_match: { stored: true, enrolled: true } });
  expect(last.wake_detector).toMatchObject({ kind: 'hey_goose', heard: 4, of: 5 });

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
