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
  takeSentences,
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

describe('takeSentences', () => {
  it('hands over each sentence as soon as the next one has begun', () => {
    const first = takeSentences('It is 23 degrees. The humid', 0);
    expect(first.sentences).toEqual(['It is 23 degrees.']);
    const second = takeSentences('It is 23 degrees. The humidity is 34%.', first.next, true);
    expect(second.sentences).toEqual(['The humidity is 34%.']);
  });

  it('does not split a decimal or wait on the last word while it streams', () => {
    expect(takeSentences('Version 3.5 is out', 0).sentences).toEqual([]);
    expect(takeSentences('Done.', 0).sentences).toEqual([]);
    expect(takeSentences('Done.', 0, true).sentences).toEqual(['Done.']);
  });
});
