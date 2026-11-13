/**
 * The sums behind voice mode: what the Pond is sent, and what it is asked to say.
 */

import {
  downsample,
  encodeWav,
  envelope,
  holdSeconds,
  orbLevel,
  rms,
  speakable,
  takeSpeechUnits,
  wavSeconds,
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

describe('speakable list lines', () => {
  it('keeps the lines of a list apart with a comma when they have no mark of their own', () => {
    expect(speakable('You will need\n- 3 cups of flour\n- 1 teaspoon of salt\n- water')).toBe(
      'You will need, 3 cups of flour, 1 teaspoon of salt, water',
    );
    expect(speakable('A long line the model\nwrapped here.')).toBe('A long line the model wrapped here.');
  });
});

describe('wavSeconds', () => {
  it('measures how long a WAV plays', () => {
    expect(wavSeconds(encodeWav(new Int16Array(24_000 * 3), 24_000))).toBeCloseTo(3, 1);
    expect(wavSeconds(new Uint8Array([1, 2, 3]))).toBe(0);
  });
});

describe('holdSeconds', () => {
  it('covers the unit that would be latest', () => {
    expect(holdSeconds(10, [])).toBe(0);
    expect(holdSeconds(10, [[4, 10]])).toBe(0);
    expect(holdSeconds(10, [[14, 10]])).toBe(4);
    expect(holdSeconds(10, [[14, 10], [14, 10]])).toBe(8);
    expect(holdSeconds(10, [[14, 10], [2, 1]])).toBe(4);
  });
});

describe('takeSpeechUnits', () => {
  /** Feed a reply to the splitter a token at a time, as the chat stream does. */
  const stream = (reply: string) => {
    const units = [];
    let text = '';
    let cursor = 0;
    for (const token of reply.match(/\S+|\s+/g) ?? []) {
      text += token;
      const taken = takeSpeechUnits(text, cursor);
      units.push(...taken.units);
      cursor = taken.next;
    }
    units.push(...takeSpeechUnits(text, cursor, true).units);
    return units;
  };

  const SHORT =
    'Sure, I can help with that. It is 23 degrees in Nairobi, with light rain after four; ' +
    'take a jacket. Shall I remind you?';

  const LONG =
    'Bread needs four things: flour, water, salt and yeast. Mix them, then leave the dough to ' +
    'rest for an hour, or longer if the kitchen is cold. Shape it gently, so the air stays in. ' +
    'Bake it hot, at 230 degrees, until the crust is dark and the loaf sounds hollow when you ' +
    'tap it. Let it cool before you cut it, however good it smells.';

  it('says a reply one pass holds whole, and nothing while it is still being written', () => {
    expect(takeSpeechUnits(SHORT, 0)).toEqual({ units: [], next: 0 });
    expect(takeSpeechUnits(SHORT, 0, true)).toEqual({ units: [{ text: SHORT, last: true }], next: SHORT.length });
    expect(stream(SHORT)).toEqual([{ text: SHORT, last: true }]);
  });

  it('hands over the longest start that fits once a reply has grown past one pass', () => {
    const early = takeSpeechUnits(LONG, 0);
    expect(early.units).toEqual([
      {
        text:
          'Bread needs four things: flour, water, salt and yeast. Mix them, then leave the dough ' +
          'to rest for an hour, or longer if the kitchen is cold. Shape it gently, so the air stays in.',
        last: false,
      },
    ]);
    expect(takeSpeechUnits(LONG, early.next, true).units).toEqual([
      {
        text:
          'Bake it hot, at 230 degrees, until the crust is dark and the loaf sounds hollow when ' +
          'you tap it. Let it cool before you cut it, however good it smells.',
        last: true,
      },
    ]);
  });

  it('cuts a reply streamed a token at a time where it would cut the whole reply', () => {
    const reply = [LONG, SHORT, LONG].join(' ');
    const whole = takeSpeechUnits(reply, 0, true).units;
    expect(whole.length).toBeGreaterThanOrEqual(4);
    expect(whole.map((u) => u.last)).toEqual(whole.map((_, k) => k === whole.length - 1));
    for (const u of whole.slice(0, -1)) expect(u.text).toMatch(/[.?]$/);
    expect(stream(reply)).toEqual(whole);
  });

  it('does not end a unit at a number, and cuts at a space when no sentence ends in reach', () => {
    const numbered = `${'word '.repeat(30)} It costs 3. 5 or so, ${'more '.repeat(20)}`;
    expect(takeSpeechUnits(numbered, 0, true).units[0].text.endsWith('3.')).toBe(false);
    const run = takeSpeechUnits('word '.repeat(80), 0, true).units;
    expect(run.length).toBeGreaterThan(1);
    for (const u of run) expect(u.text.split(' ').every((w) => w === 'word')).toBe(true);
  });

  it('keeps a list together, its lines apart', () => {
    const { units } = takeSpeechUnits('You will need:\n- 3 cups of flour\n- 1 teaspoon of salt', 0, true);
    expect(units).toEqual([{ text: 'You will need: 3 cups of flour, 1 teaspoon of salt', last: true }]);
  });

  it('speaks the words and not the markdown, and drops units with nothing to say', () => {
    expect(takeSpeechUnits('**Yes**, see [the docs](https://x.y).', 0, true).units).toEqual([
      { text: 'Yes, see the docs.', last: true },
    ]);
    expect(takeSpeechUnits('***\n\n', 0, true).units).toEqual([]);
    expect(takeSpeechUnits('', 0, true).units).toEqual([]);
  });

  it('picks up after what was already said', () => {
    const said = 'Let me check. ';
    const full = `${said}It is dry until six.`;
    expect(takeSpeechUnits(full, said.length, true).units).toEqual([{ text: 'It is dry until six.', last: true }]);
  });
});
