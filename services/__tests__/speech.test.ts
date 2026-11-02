/**
 * The sums behind voice mode: what the Pond is sent, and what it is asked to say.
 */

import {
  downsample,
  encodeWav,
  envelope,
  orbLevel,
  rms,
  speakable,
  takeSpeechUnits,
} from '@/services/speech';

describe('encodeWav', () => {
  it('writes the RIFF header the Pond sniffs, 16-bit mono at the given rate', () => {
    const wav = encodeWav(new Int16Array([0, 1000, -1000]), 16000);
    const text = (at: number) => String.fromCharCode(...wav.subarray(at, at + 4));
    const view = new DataView(wav.buffer);
    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(46, true)).toBe(1000);
    expect(wav.length).toBe(50);
  });
});

describe('downsample', () => {
  it('averages 48 kHz down to 16 kHz, three samples to one', () => {
    const out = downsample(new Int16Array([3, 6, 9, 30, 60, 90]), 48000);
    expect(Array.from(out)).toEqual([6, 60]);
  });

  it('leaves audio already at, or under, the target rate alone', () => {
    const same = new Int16Array([1, 2, 3]);
    expect(downsample(same, 16000)).toBe(same);
    expect(downsample(same, 8000)).toBe(same);
  });
});

describe('rms and orbLevel', () => {
  it('reads silence as zero and full scale as nearly one', () => {
    expect(rms(new Int16Array(100))).toBe(0);
    expect(rms(new Int16Array([32767, -32768, 32767, -32768]))).toBeCloseTo(1, 3);
  });

  it('scales a quiet voice up for the orb and caps a loud one', () => {
    expect(orbLevel(0.05)).toBeCloseTo(0.3);
    expect(orbLevel(0.5)).toBe(1);
  });
});

describe('envelope', () => {
  it('measures a WAV in windows, loud where it is loud', () => {
    const quiet = new Int16Array(800);
    const loud = new Int16Array(800).fill(16384);
    const wav = encodeWav(new Int16Array([...quiet, ...loud]), 16000);
    const { levels } = envelope(wav, 50);
    expect(levels).toHaveLength(2);
    expect(levels[0]).toBe(0);
    expect(levels[1]).toBeCloseTo(0.5, 2);
  });

  it('gives up quietly on bytes that are not a 16-bit WAV', () => {
    expect(envelope(new Uint8Array([1, 2, 3])).levels).toEqual([]);
  });
});

describe('speakable', () => {
  it('reads the words and not the markdown', () => {
    expect(speakable('**Yes**, see [the docs](https://x.y) or `run it`.\n- one')).toBe(
      'Yes, see the docs or run it. one',
    );
  });

  it('skips code blocks and bare links entirely', () => {
    expect(speakable('Try:\n```\nrm -rf\n```\nthen https://example.com done')).toBe('Try: then done');
  });
});

describe('takeSpeechUnits', () => {
  /** Feed a reply to the splitter a token at a time, as the chat stream does. */
  const stream = (tokens: string[]) => {
    const units: string[] = [];
    let text = '';
    let cursor = 0;
    for (const token of tokens) {
      text += token;
      const taken = takeSpeechUnits(text, cursor);
      units.push(...taken.units);
      cursor = taken.next;
    }
    units.push(...takeSpeechUnits(text, cursor, true).units);
    return units;
  };

  it('hands over each sentence as soon as it ends, without waiting for the next token', () => {
    const first = takeSpeechUnits('It is 23 degrees.', 0);
    expect(first.units).toEqual(['It is 23 degrees.']);
    const second = takeSpeechUnits('It is 23 degrees. The humidity is 34%.', first.next, true);
    expect(second.units).toEqual(['The humidity is 34%.']);
  });

  it('releases the first clause once it has three words', () => {
    const { units, next } = takeSpeechUnits('It is sunny, and the high is', 0);
    expect(units).toEqual(['It is sunny,']);
    expect(takeSpeechUnits('It is sunny, and the high is 26.', next, true).units).toEqual([
      'and the high is 26.',
    ]);
  });

  it('keeps a clause of fewer than three words with what follows', () => {
    expect(takeSpeechUnits('Sure, it is 23 degrees. The', 0).units).toEqual(['Sure, it is 23 degrees.']);
  });

  it('caps the first unit at six words when no mark comes, and only the first', () => {
    const reply =
      'The weather in Nairobi today is expected to be warm and mostly sunny all afternoon. Then';
    const { units, next } = takeSpeechUnits(reply, 0);
    expect(units).toEqual([
      'The weather in Nairobi today is',
      'expected to be warm and mostly sunny all afternoon.',
    ]);
    expect(reply.slice(next)).toBe(' Then');
    // A word still being written is not yet a word: "is" could become "isn't".
    expect(takeSpeechUnits('The weather in Nairobi today is', 0).units).toEqual([]);
  });

  it('splits later units at clauses as well as sentences', () => {
    const tokens = ['Yes', '.', ' Tomorrow', ' looks', ' warm', ' and', ' sunny', ','];
    expect(stream([...tokens, ' with', ' a', ' high', ' of', ' 26', '.'])).toEqual([
      'Yes.',
      'Tomorrow looks warm and sunny,',
      'with a high of 26.',
    ]);
  });

  it('cuts a reply streamed a token at a time where it would cut the whole reply', () => {
    const reply =
      'Herons hunt by standing still for a long time, then striking fast. ' +
      'They eat fish, frogs and insects, and some even bait the water with bread. ' +
      'Dr. Smith counted 1,000 of them at 7:30 a.m. near the lake.';
    const tokens = reply.match(/\s*\S+/g) ?? [];
    expect(stream(tokens)).toEqual(takeSpeechUnits(reply, 0, true).units);
    expect(stream(tokens)).toEqual([
      'Herons hunt by standing still for',
      'a long time,',
      'then striking fast.',
      'They eat fish,',
      'frogs and insects,',
      'and some even bait the water with bread.',
      'Dr. Smith counted 1,000 of them at 7:30 a.m. near the lake.',
    ]);
  });

  it('waits on a number or a link that the next token may continue', () => {
    expect(takeSpeechUnits('Version 3.5 is out', 0).units).toEqual([]);
    expect(takeSpeechUnits('It is 25.', 0).units).toEqual([]);
    expect(takeSpeechUnits('It is 25.', 0, true).units).toEqual(['It is 25.']);
    expect(takeSpeechUnits('Go to www.example.', 0).units).toEqual([]);
    expect(takeSpeechUnits('There are 1,000 units, and', 0).units).toEqual(['There are 1,000 units,']);
  });

  it('does not cut a link or a code block in half', () => {
    const link = 'See [the forecast for Nairobi, Kenya](https://x.y) for more';
    expect(takeSpeechUnits(link, 0).units).toEqual(['See the forecast for Nairobi, Kenya']);
    const code = 'Run this:\n```\nls -la\ncd /tmp\n```\nThen';
    const { units, next } = takeSpeechUnits(code, 0);
    expect(units).toEqual(['Run this:']);
    expect(code.slice(next)).toBe('Then');
    expect(takeSpeechUnits('Run this:\n```\nls -la, then cd', 0).units).toEqual(['Run this:']);
  });

  it('speaks the words and not the markdown, and drops units with nothing to say', () => {
    expect(takeSpeechUnits('**Yes**, see the docs. More', 0).units).toEqual(['Yes, see the docs.']);
    expect(stream(['Really', '?', '!', ' Yes', '.'])).toEqual(['Really?', 'Yes.']);
  });
});
