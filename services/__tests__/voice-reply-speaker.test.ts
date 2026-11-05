/**
 * A spoken reply is heard on iPhone. expo-audio's microphone stream sets the iOS session to
 * record-only and leaves it there, so a reply played after listening was silent with no error:
 * the text showed and nothing played. Every reply now sets the speaker up again before it plays.
 */

const mockOrder: string[] = [];
const mockSetMode = jest.fn(async (mode: unknown) => {
  mockOrder.push(`mode ${JSON.stringify(mode)}`);
});
const mockPlayer = {
  play: jest.fn(() => mockOrder.push('play')),
  pause: jest.fn(),
  remove: jest.fn(),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
};

// Read lazily: voice-io loads expo-audio as it is imported, before these exist.
jest.mock('expo-audio', () => ({
  AudioModule: { AudioStream: function AudioStream() {} },
  setAudioModeAsync: (mode: unknown) => mockSetMode(mode),
  createAudioPlayer: () => mockPlayer,
}));

import { playFile } from '@/services/voice-io';

beforeEach(() => {
  mockOrder.length = 0;
  jest.clearAllMocks();
});

it('sets the loudspeaker up again before a reply plays', async () => {
  playFile('file:///reply.wav', () => {});
  await new Promise((resolve) => setImmediate(resolve));

  expect(mockOrder).toEqual([
    `mode ${JSON.stringify({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
      interruptionMode: 'doNotMix',
    })}`,
    'play',
  ]);
});

it('still plays when the session could not be set up', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockSetMode.mockRejectedValueOnce(new Error('session busy'));
  playFile('file:///reply.wav', () => {});
  await new Promise((resolve) => setImmediate(resolve));

  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

it('does not start a reply that was stopped before the speaker was ready', async () => {
  const playing = playFile('file:///reply.wav', () => {});
  playing.stop();
  await new Promise((resolve) => setImmediate(resolve));

  expect(mockPlayer.play).not.toHaveBeenCalled();
  await expect(playing.done).resolves.toBeUndefined();
});
