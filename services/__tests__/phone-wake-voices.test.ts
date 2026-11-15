// The voice check's JavaScript side: the model fetched once, takes kept without failing a take, and
// the wake test's candidates sent to the Pond and their files deleted.

import { NativeModules, Platform } from 'react-native';

const mockDownload = jest.fn();
const mockCheck = jest.fn();
jest.mock('@/services/api-client', () => ({
  api: {
    downloadSpeakerModel: (...a: unknown[]) => mockDownload(...a),
    checkWakeSegment: (...a: unknown[]) => mockCheck(...a),
  },
}));
const mockDiscard = jest.fn();
jest.mock('@/services/voice-io', () => ({ discardFile: (uri: string) => mockDiscard(uri) }));

import { enrolPhoneTake, ensureSpeakerModel, forgetPhoneVoice, phoneVoices, runWakeTest } from '@/services/phone-wake-voices';

const bridge = {
  voices: jest.fn(),
  installSpeakerModel: jest.fn(),
  enrolTake: jest.fn(),
  forgetVoice: jest.fn(),
  testWake: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.replaceProperty(Platform, 'OS', 'android');
  NativeModules.PondWake = bridge;
});

afterEach(() => {
  jest.restoreAllMocks();
  delete NativeModules.PondWake;
});

it('does nothing where the phone cannot listen', async () => {
  delete NativeModules.PondWake;
  await expect(phoneVoices()).resolves.toBeNull();
  await expect(ensureSpeakerModel()).resolves.toBe(false);
  await expect(enrolPhoneTake('file:///take.wav', 'me')).resolves.toBe(false);
  await forgetPhoneVoice('me');
  expect(mockDownload).not.toHaveBeenCalled();
});

it('fetches the speaker model only when it is not here, once for calls at the same time', async () => {
  bridge.voices.mockResolvedValue({ model: false });
  mockDownload.mockResolvedValue('file:///cache/speaker.onnx');
  bridge.installSpeakerModel.mockResolvedValue(true);
  await expect(Promise.all([ensureSpeakerModel(), ensureSpeakerModel()])).resolves.toEqual([true, true]);
  expect(mockDownload).toHaveBeenCalledTimes(1);
  expect(bridge.installSpeakerModel).toHaveBeenCalledWith('file:///cache/speaker.onnx');

  bridge.voices.mockResolvedValue({ model: true });
  await expect(ensureSpeakerModel()).resolves.toBe(true);
  expect(mockDownload).toHaveBeenCalledTimes(1);
});

it('reports a model the Pond would not give, or the phone would not keep, as missing', async () => {
  bridge.voices.mockResolvedValue({ model: false });
  mockDownload.mockRejectedValueOnce(new Error('409'));
  await expect(ensureSpeakerModel()).resolves.toBe(false);
  mockDownload.mockResolvedValueOnce('file:///cache/speaker.onnx');
  bridge.installSpeakerModel.mockResolvedValueOnce(false);
  await expect(ensureSpeakerModel()).resolves.toBe(false);
});

it('keeps a take once the model is here, and a failure never throws into the teach flow', async () => {
  bridge.voices.mockResolvedValue({ model: true });
  bridge.enrolTake.mockResolvedValueOnce({ peak: 0.8, takes: 1 });
  await expect(enrolPhoneTake('file:///take.wav', 'me')).resolves.toBe(true);
  expect(bridge.enrolTake).toHaveBeenCalledWith('file:///take.wav', 'me');
  bridge.enrolTake.mockRejectedValueOnce(new Error('take too short'));
  await expect(enrolPhoneTake('file:///take.wav', 'me')).resolves.toBe(false);
  expect(console.warn).toHaveBeenCalledWith('[wake] a take was not kept for the voice check', expect.objectContaining({ kind: 'phone_wake_voices' }));
});

it('runs the test, asks the Pond about what the phone would ask, and deletes each file sent', async () => {
  bridge.testWake.mockResolvedValue({
    cnn: 0.6,
    taught: true,
    candidates: [
      { t: 1, p: 0.98, voice: 0.8, decision: 'wake', segment: null },
      { t: 3, p: 0.7, voice: 0.6, decision: 'ask_pond', segment: 'file:///cache/wake-test/a.wav' },
      { t: 5, p: 0.7, voice: 0.6, decision: 'ask_pond', segment: 'file:///cache/wake-test/b.wav' },
    ],
  });
  mockCheck.mockResolvedValueOnce({ heard: true, phrase: 'hey goose' }).mockRejectedValueOnce(new Error('offline'));
  const run = await runWakeTest('file:///cache/wake-test.wav');
  expect(run.map((c) => c.pond)).toEqual([null, true, null]);
  expect(mockDiscard.mock.calls).toEqual([['file:///cache/wake-test/a.wav'], ['file:///cache/wake-test/b.wav']]);
});
