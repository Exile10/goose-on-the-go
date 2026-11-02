/**
 * A spoken reply's clauses on their way to the speaker: the Pond is kept busy, the speaker hears them
 * in order, and an interrupt stops everything the Pond is still rendering.
 */

import { TTS_LIMITS, createSpeechLine, type Render } from '@/services/speech-line';

interface Call {
  text: string;
  signal: AbortSignal;
  answer: () => void;
  fail: () => void;
}

/** A Pond that answers each `/tts` request only when the test says so. */
function slowPond() {
  const calls: Call[] = [];
  const render: Render = (text, signal) =>
    new Promise<ArrayBuffer>((resolve, reject) => {
      calls.push({ text, signal, answer: () => resolve(new TextEncoder().encode(text).buffer as ArrayBuffer), fail: () => reject(new Error('tts')) });
    });
  return { calls, render };
}

const said = async (audio: Promise<ArrayBuffer> | null) => new TextDecoder().decode((await audio) ?? undefined);
const settle = () => new Promise((r) => setTimeout(r, 0));

it('keeps two requests in flight, sending the next as soon as the Pond answers one', async () => {
  const pond = slowPond();
  const line = createSpeechLine(pond.render, TTS_LIMITS);
  line.push(['one', 'two', 'three', 'four', 'five']);
  expect(pond.calls.map((c) => c.text)).toEqual(['one', 'two']);

  pond.calls[0].answer();
  await settle();
  // Nothing has been played yet: the Pond moves on without waiting for the speaker.
  expect(pond.calls.map((c) => c.text)).toEqual(['one', 'two', 'three']);
  expect(line.pending).toBe(5);
});

it('hands the speaker each clause in the order it was queued, whatever order the renders finish in', async () => {
  const pond = slowPond();
  const line = createSpeechLine(pond.render, TTS_LIMITS);
  line.push(['first', 'second']);
  pond.calls[1].answer();
  pond.calls[0].answer();
  expect(await said(line.next())).toBe('first');
  expect(await said(line.next())).toBe('second');
  expect(line.next()).toBeNull();
  expect(line.pending).toBe(0);
});

it('holds at most four rendered clauses waiting for the speaker', async () => {
  const pond = slowPond();
  const line = createSpeechLine(pond.render, TTS_LIMITS);
  line.push(['a', 'b', 'c', 'd', 'e', 'f']);
  for (let i = 0; i < 4; i += 1) {
    pond.calls[i].answer();
    await settle();
  }
  expect(pond.calls).toHaveLength(4);
  await line.next();
  expect(pond.calls.map((c) => c.text)).toEqual(['a', 'b', 'c', 'd', 'e']);
});

it('cancels every request in flight on an interrupt, and a new reply starts clean', async () => {
  const pond = slowPond();
  const line = createSpeechLine(pond.render, TTS_LIMITS);
  line.push(['old one', 'old two', 'old three']);
  const playing = line.next();
  line.clear();
  expect(pond.calls.map((c) => c.signal.aborted)).toEqual([true, true]);
  expect(line.pending).toBe(0);
  expect(line.next()).toBeNull();

  line.push(['new one', 'new two']);
  // The cancelled requests settle late; they must not hold the new reply's slots.
  pond.calls[0].fail();
  pond.calls[1].fail();
  await settle();
  await expect(playing).rejects.toThrow('tts');
  expect(pond.calls.slice(2).map((c) => [c.text, c.signal.aborted])).toEqual([
    ['new one', false],
    ['new two', false],
  ]);
  pond.calls[2].answer();
  await settle();
  expect(await said(line.next())).toBe('new one');
});

it('lets the speaker see a clause the Pond could not render', async () => {
  const pond = slowPond();
  const line = createSpeechLine(pond.render, TTS_LIMITS);
  line.push(['broken']);
  pond.calls[0].fail();
  await expect(line.next()).rejects.toThrow('tts');
});
