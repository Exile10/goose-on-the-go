import {
  DEFAULT_VAD_CONFIG,
  advanceVad,
  calculateRms,
  createVadState,
  downsampleTo16k,
  encodeWav,
} from '@/services/voice-dsp';

describe('calculateRms', () => {
  it('is 0 for silence', () => {
    expect(calculateRms(new Float32Array([0, 0, 0, 0]))).toBe(0);
  });

  it('is 0 for an empty buffer', () => {
    expect(calculateRms(new Float32Array([]))).toBe(0);
  });

  it('is 1 for a full-scale constant signal', () => {
    expect(calculateRms(new Float32Array([1, 1, 1, 1]))).toBe(1);
  });

  it('matches the RMS formula for a mixed-sign buffer', () => {
    // sqrt((0.5^2 + 0.5^2) / 2) = 0.5
    expect(calculateRms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
  });
});

describe('advanceVad — phase transitions', () => {
  const config = DEFAULT_VAD_CONFIG;
  const LOUD = config.speechOnsetThreshold + 0.01;
  const QUIET = config.silenceThreshold - 0.001;

  it('stays in waiting on silence', () => {
    const state = createVadState();
    const stop = advanceVad(state, QUIET, 0, config);
    expect(stop).toBe(false);
    expect(state.phase).toBe('waiting');
  });

  it('does not confirm speech onset before the onset duration elapses', () => {
    const state = createVadState();
    advanceVad(state, LOUD, 0, config);
    advanceVad(state, LOUD, config.speechOnsetDurationMs - 1, config);
    expect(state.phase).toBe('waiting');
  });

  it('confirms speech onset once sustained past the onset duration', () => {
    const state = createVadState();
    advanceVad(state, LOUD, 0, config);
    advanceVad(state, LOUD, config.speechOnsetDurationMs, config);
    expect(state.phase).toBe('speech');
    expect(state.speechConfirmed).toBe(true);
  });

  it('resets the onset timer if loudness drops before confirmation', () => {
    const state = createVadState();
    advanceVad(state, LOUD, 0, config);
    advanceVad(state, QUIET, 10, config); // drops before onset duration — resets
    advanceVad(state, LOUD, 20, config); // a fresh onset timer starts here
    expect(state.phase).toBe('waiting');
    advanceVad(state, LOUD, 20 + config.speechOnsetDurationMs, config);
    expect(state.phase).toBe('speech');
  });

  it('enters trailing_silence when speech drops below the silence threshold', () => {
    const state = createVadState();
    advanceVad(state, LOUD, 0, config);
    advanceVad(state, LOUD, config.speechOnsetDurationMs, config);
    advanceVad(state, QUIET, config.speechOnsetDurationMs + 1, config);
    expect(state.phase).toBe('trailing_silence');
  });

  it('returns to speech if loudness resumes during trailing silence', () => {
    const state = createVadState();
    advanceVad(state, LOUD, 0, config);
    advanceVad(state, LOUD, config.speechOnsetDurationMs, config);
    advanceVad(state, QUIET, config.speechOnsetDurationMs + 1, config);
    const stop = advanceVad(state, LOUD, config.speechOnsetDurationMs + 2, config);
    expect(stop).toBe(false);
    expect(state.phase).toBe('speech');
  });

  it('signals stop once trailing silence exceeds the timeout', () => {
    const state = createVadState();
    const onsetAt = 0;
    advanceVad(state, LOUD, onsetAt, config);
    advanceVad(state, LOUD, onsetAt + config.speechOnsetDurationMs, config);
    const silenceStart = onsetAt + config.speechOnsetDurationMs + 1;
    advanceVad(state, QUIET, silenceStart, config);
    const stop = advanceVad(state, QUIET, silenceStart + config.silenceTimeoutMs, config);
    expect(stop).toBe(true);
  });

  it('does not signal stop before the silence timeout elapses', () => {
    const state = createVadState();
    advanceVad(state, LOUD, 0, config);
    advanceVad(state, LOUD, config.speechOnsetDurationMs, config);
    const silenceStart = config.speechOnsetDurationMs + 1;
    advanceVad(state, QUIET, silenceStart, config);
    const stop = advanceVad(state, QUIET, silenceStart + config.silenceTimeoutMs - 1, config);
    expect(stop).toBe(false);
  });
});

describe('downsampleTo16k', () => {
  it('is an identity no-op when already at 16kHz', () => {
    const buf = new Float32Array([0.1, 0.2, 0.3]);
    expect(downsampleTo16k(buf, 16000)).toBe(buf); // same reference, not just equal values
  });

  it('halves the sample count when downsampling from 32kHz', () => {
    const buf = new Float32Array(32000).fill(0.5);
    const out = downsampleTo16k(buf, 32000);
    expect(out.length).toBe(16000);
  });

  it('interpolates linearly between samples', () => {
    // fromRate 32000 -> 16000 is a ratio of 2: output[i] samples input at i*2.
    const buf = new Float32Array([0, 1, 0, -1]);
    const out = downsampleTo16k(buf, 32000);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(0);
  });
});

describe('encodeWav', () => {
  it('writes a valid 44-byte RIFF/WAVE header', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const buf = encodeWav(samples, 16000);
    const view = new DataView(buf);

    const readStr = (offset: number, len: number) =>
      String.fromCharCode(...new Uint8Array(buf, offset, len));

    expect(readStr(0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2);
    expect(readStr(8, 4)).toBe('WAVE');
    expect(readStr(12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16); // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(readStr(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });

  it('produces the expected total byte length', () => {
    const samples = new Float32Array(100);
    const buf = encodeWav(samples, 16000);
    expect(buf.byteLength).toBe(44 + 100 * 2);
  });

  it('clamps and scales samples into 16-bit signed range', () => {
    const buf = encodeWav(new Float32Array([1, -1, 2, -2, 0]), 16000);
    const view = new DataView(buf);
    expect(view.getInt16(44, true)).toBe(0x7fff); // +1 -> max positive
    expect(view.getInt16(46, true)).toBe(-0x8000); // -1 -> max negative
    expect(view.getInt16(48, true)).toBe(0x7fff); // clamped from 2
    expect(view.getInt16(50, true)).toBe(-0x8000); // clamped from -2
    expect(view.getInt16(52, true)).toBe(0);
  });
});
