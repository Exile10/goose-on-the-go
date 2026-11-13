/**
 * A spoken reply's units on their way to the speaker: the Pond is kept busy, the speaker hears them
 * in order, an interrupt stops everything the Pond is still rendering, and a slow Pond is held so it
 * never stops between units.
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
  const render: Render = ({ text }, signal) =>
    new Promise<ArrayBuffer>((resolve, reject) => {
      calls.push({ text, signal, answer: () => resolve(new TextEncoder().encode(text).buffer as ArrayBuffer), fail: () => reject(new Error('tts')) });
    });
  return { calls, render };
}

const units = (...texts: string[]) => texts.map((text, i) => ({ text, last: i === texts.length - 1 }));

const said = async (audio: Promise<ArrayBuffer> | null) => new TextDecoder().decode((await audio) ?? undefined);
const settle = () => new Promise((r) => setTimeout(r, 0));

it('keeps two requests in flight, sending the next as soon as the Pond answers one', async () => {
  const pond = slowPond();
  const line = createSpeechLine(pond.render, TTS_LIMITS);
  line.push(units('one', 'two', 'three', 'four', 'five'));
  expect(pond.calls.map((c) => c.text)).toEqual(['one', 'two']);

  pond.calls[0].answer();
  await settle();
  // Nothing has been played yet: the Pond moves on without waiting for the speaker.
  expect(pond.calls.map((c) => c.text)).toEqual(['one', 'two', 'three']);
  expect(line.pending).toBe(5);
});

it('hands the speaker each unit in the order it was queued, whatever order the renders finish in', async () => {
  const pond = slowPond();
  const line = createSpeechLine(pond.render, TTS_LIMITS);
  line.push(units('first', 'second'));
  pond.calls[1].answer();
  pond.calls[0].answer();
  expect(await said(line.next())).toBe('first');
  expect(await said(line.next())).toBe('second');
  expect(line.next()).toBeNull();
  expect(line.pending).toBe(0);
});

it('holds at most four rendered units waiting for the speaker', async () => {
  const pond = slowPond();
  const line = createSpeechLine(pond.render, TTS_LIMITS);
  line.push(units('a', 'b', 'c', 'd', 'e', 'f'));
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
  line.push(units('old one', 'old two', 'old three'));
  const playing = line.next();
  line.clear();
  expect(pond.calls.map((c) => c.signal.aborted)).toEqual([true, true]);
  expect(line.pending).toBe(0);
  expect(line.next()).toBeNull();

  line.push(units('new one', 'new two'));
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

it('lets the speaker see a unit the Pond could not render', async () => {
  const pond = slowPond();
  const line = createSpeechLine(pond.render, TTS_LIMITS);
  line.push(units('broken'));
  pond.calls[0].fail();
  await expect(line.next()).rejects.toThrow('tts');
});

describe('the hold before sound that starts from silence', () => {
  /** A Pond that takes `work` seconds over ten characters and answers with `speech` seconds of audio. */
  function timedLine(work: number, speech: number) {
    const pond = slowPond();
    let clock = 0;
    const line = createSpeechLine(pond.render, TTS_LIMITS, () => speech, () => clock);
    const answer = async (call: number) => {
      clock += work * 1000;
      pond.calls[call].answer();
      await settle();
    };
    return { line, answer };
  }
  const TEN = 'ten chars.';

  it('holds the first unit by what a slower Pond still owes behind it', async () => {
    const { line, answer } = timedLine(14, 10);
    line.push(units(TEN, TEN, TEN));
    const first = line.next();
    await answer(0);
    await first;
    // Two more units of 14 s work and 10 s speech each: the last is ready 28 s on, after 20 s of audio.
    expect(line.hold(10, true)).toBeCloseTo(8);
  });

  it('does not hold a unit said alone, nor a Pond that keeps ahead', async () => {
    const alone = timedLine(14, 10);
    alone.line.push(units(TEN));
    const only = alone.line.next();
    await alone.answer(0);
    await only;
    expect(alone.line.hold(10, true)).toBe(0);

    const quick = timedLine(2, 10);
    quick.line.push(units(TEN, TEN));
    const first = quick.line.next();
    await quick.answer(0);
    await first;
    expect(quick.line.hold(10, true)).toBe(0);
  });

  it('does not hold a unit that was ready while another played', async () => {
    const { line, answer } = timedLine(14, 10);
    line.push(units(TEN, TEN, TEN));
    const first = line.next();
    await answer(0);
    await first;
    await answer(1);
    await line.next();
    expect(line.hold(10, false)).toBe(0);
  });

  it('holds nothing before any request has timed the Pond', () => {
    const pond = slowPond();
    const line = createSpeechLine(pond.render, TTS_LIMITS);
    line.push(units(TEN, TEN));
    void line.next();
    expect(line.hold(10, true)).toBe(0);
  });
});
