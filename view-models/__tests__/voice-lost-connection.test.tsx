/**
 * A recording the Pond never received because nothing answered is said to be a lost connection,
 * not mishearing, and Try again sends that same recording once a route answers.
 */
import '@/services/i18n';
import React from 'react';
import { act, create } from 'react-test-renderer';

import { ApiError } from '@/services/api-client';
import type { MicBuffer } from '@/services/voice-io';
import { useVoice, type UseVoice } from '@/view-models/use-voice';

const mockTranscribe = jest.fn();
const mockRetryNow = jest.fn();
let mockOnBuffer: (b: MicBuffer) => void = () => {};

jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { transcribe: (...a: unknown[]) => mockTranscribe(...a), speak: jest.fn() } };
});
/** The app's server context, or null as in the assistant overlay, which renders outside it. */
let mockServer: { retryNow: () => Promise<string | null> } | null = { retryNow: () => mockRetryNow() };
jest.mock('@/providers/server-provider', () => ({ useOptionalServer: () => mockServer }));
jest.mock('@/services/voice-io', () => ({
  requestMicrophone: async () => ({ granted: true, canAskAgain: true }),
  beginVoiceSession: async () => undefined,
  endVoiceSession: async () => undefined,
  cacheFile: () => 'file:///speech.wav',
  discardFile: () => undefined,
  playFile: () => ({ stop: () => undefined, done: Promise.resolve() }),
  voiceSupported: () => true,
  useMicStream: (onBuffer: (b: MicBuffer) => void) => {
    mockOnBuffer = onBuffer;
    return { start: async () => undefined, stop: () => undefined };
  },
}));

let voice!: UseVoice;
const send = jest.fn().mockResolvedValue('');

function Harness({ onVoice }: { onVoice: (next: UseVoice) => void }) {
  onVoice(useVoice({ send, stop: jest.fn() }));
  return null;
}

const keep = (next: UseVoice) => {
  voice = next;
};

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** Speaks long enough to start a recording, then taps the orb to finish it. */
async function sayAndFinish() {
  const loud = { samples: new Int16Array(1600).fill(8000), sampleRate: 16_000 };
  let now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  act(() => mockOnBuffer(loud));
  now += 200;
  act(() => mockOnBuffer(loud));
  clock.mockRestore();
  expect(voice.data.state).toBe('recording');
  act(() => voice.actions.tap());
  await flush();
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockServer = { retryNow: () => mockRetryNow() };
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  act(() => {
    create(<Harness onVoice={keep} />);
  });
  await flush();
  expect(voice.data.state).toBe('wait');
});

describe('a recording nobody received', () => {
  it('says the connection dropped, and sends the same recording once a route answers', async () => {
    mockTranscribe.mockRejectedValueOnce(new TypeError('Network request failed')).mockResolvedValueOnce('hello there');
    await sayAndFinish();
    expect(voice.data.state).toBe('error');
    expect(voice.data.error).toMatch(/connection to your Pond dropped/);

    mockRetryNow.mockResolvedValueOnce('https://pond.example:4443');
    act(() => voice.actions.tap());
    await flush();
    await flush();

    expect(mockRetryNow).toHaveBeenCalledTimes(1);
    expect(mockTranscribe).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith('hello there', [], expect.objectContaining({ voice: true }));
  });

  it('keeps the recording and says so while still nothing answers', async () => {
    mockTranscribe.mockRejectedValueOnce(new TypeError('Network request failed'));
    await sayAndFinish();
    mockRetryNow.mockResolvedValueOnce(null);
    act(() => voice.actions.tap());
    await flush();

    expect(voice.data.state).toBe('error');
    expect(voice.data.error).toMatch(/still isn.t answering/);
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
  });

  it('still says the Pond could not make it out when the Pond answered and refused', async () => {
    mockTranscribe.mockRejectedValueOnce(new ApiError('POST /api/v1/transcribe → 500', 500, null));
    await sayAndFinish();
    expect(voice.data.error).toMatch(/could not make that out/);

    act(() => voice.actions.tap());
    await flush();
    expect(mockRetryNow).not.toHaveBeenCalled();
    expect(voice.data.state).toBe('wait');
  });

  it('works in the assistant overlay, which has no server context, and resends straight away', async () => {
    mockServer = null;
    act(() => {
      create(<Harness onVoice={keep} />);
    });
    await flush();
    mockTranscribe.mockRejectedValueOnce(new TypeError('Network request failed')).mockResolvedValueOnce('hello again');
    await sayAndFinish();
    expect(voice.data.error).toMatch(/connection to your Pond dropped/);

    act(() => voice.actions.tap());
    await flush();
    await flush();
    expect(mockRetryNow).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('hello again', [], expect.objectContaining({ voice: true }));
  });
});
