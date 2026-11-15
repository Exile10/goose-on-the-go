/**
 * The JavaScript side of the wake-word module: a no-op wherever there is no bridge or no detector,
 * and every failure logged rather than thrown into a screen.
 */
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

import {
  answerWakeSegments,
  choosePhoneWake,
  configurePhoneWake,
  normalizePhrase,
  phoneWakeState,
  phoneWakeSupported,
  resumePhoneWake,
  wakeMode,
} from '@/services/phone-wake';

const bridge = {
  available: jest.fn(),
  state: jest.fn(),
  choose: jest.fn(),
  resume: jest.fn(),
};
const words = { title: 'Listening', body: 'Say it', stop: 'Stop', channel: 'Wake' };

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

describe('on Android with the module', () => {
  it('is supported only where the detector loads', () => {
    bridge.available.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(phoneWakeSupported()).toBe(true);
    expect(phoneWakeSupported()).toBe(false);
  });

  it('passes the state through, and reads a failed read as unknown, logged', async () => {
    bridge.state.mockResolvedValueOnce({ chosen: true, active: false, refusal: 'not_assistant' });
    await expect(phoneWakeState()).resolves.toEqual({ chosen: true, active: false, refusal: 'not_assistant' });
    bridge.state.mockRejectedValueOnce(new Error('gone'));
    await expect(phoneWakeState()).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith('[wake] could not read the wake word state', expect.objectContaining({ kind: 'phone_wake' }));
  });

  it('hands the notification its words when turning on, and none when turning off', async () => {
    bridge.choose.mockResolvedValue(true);
    await expect(choosePhoneWake(true, words)).resolves.toBe(true);
    expect(bridge.choose).toHaveBeenLastCalledWith(true, words);
    await choosePhoneWake(false, words);
    expect(bridge.choose).toHaveBeenLastCalledWith(false, {});
  });

  it('reports a failed choice as not accepted, logged', async () => {
    bridge.choose.mockRejectedValue(new Error('E'));
    await expect(choosePhoneWake(true, words)).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalledWith('[wake] could not change the wake word', expect.objectContaining({ on: true }));
  });

  it('resumes at launch, and logs a resume that failed', async () => {
    bridge.resume.mockRejectedValue(new Error('E'));
    await resumePhoneWake();
    expect(bridge.resume).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith('[wake] could not resume listening', expect.objectContaining({ kind: 'phone_wake' }));
  });
});

describe('without the module', () => {
  it('does nothing on iOS', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    expect(phoneWakeSupported()).toBe(false);
    await expect(phoneWakeState()).resolves.toBeNull();
    await expect(choosePhoneWake(true, words)).resolves.toBe(false);
    await resumePhoneWake();
    expect(bridge.resume).not.toHaveBeenCalled();
  });

  it('does nothing on an Android build that predates the plugin', async () => {
    delete NativeModules.PondWake;
    expect(phoneWakeSupported()).toBe(false);
    await expect(choosePhoneWake(true, words)).resolves.toBe(false);
  });
});

describe('the household phrase', () => {
  it('reads "hey goose" in any case or punctuation as the phone\'s own detector, anything else as the Pond\'s', () => {
    expect(normalizePhrase('  Hey, Goose!  ')).toBe('hey goose');
    expect(wakeMode('Hey Goose')).toBe('hey_goose');
    expect(wakeMode('hey goose.')).toBe('hey_goose');
    expect(wakeMode('Goose')).toBe('pond');
    expect(wakeMode('Hey Jarvis')).toBe('pond');
  });

  it('tells the service the mode with the words that name the phrase', () => {
    const native = { ...bridge, configure: jest.fn() };
    NativeModules.PondWake = native;
    configurePhoneWake('Hey Jarvis', words);
    expect(native.configure).toHaveBeenCalledWith('pond', words);
  });
});

describe('segments the service hands over', () => {
  let emit: (path: string) => void;
  const native = { ...bridge, done: jest.fn(), heard: jest.fn().mockResolvedValue(true) };

  beforeEach(() => {
    NativeModules.PondWake = native;
    jest.spyOn(DeviceEventEmitter, 'addListener').mockImplementation((_event, listener) => {
      emit = listener as (path: string) => void;
      return { remove: jest.fn() } as never;
    });
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('opens the orb when the Pond heard the phrase, passes the phrase on, and deletes the segment', async () => {
    const check = jest.fn().mockResolvedValue({ heard: true, phrase: 'Hey Jarvis' });
    const phrase = jest.fn();
    answerWakeSegments(check, phrase);
    emit('/cache/wake-segments/a.wav');
    await settle();
    expect(check).toHaveBeenCalledWith('file:///cache/wake-segments/a.wav');
    expect(phrase).toHaveBeenCalledWith('Hey Jarvis');
    expect(native.heard).toHaveBeenCalledTimes(1);
    expect(native.done).toHaveBeenCalledWith('/cache/wake-segments/a.wav');
  });

  it('opens nothing for other speech or an unanswered check, and still deletes the segment', async () => {
    const check = jest.fn().mockResolvedValueOnce({ heard: false, phrase: 'Hey Jarvis' }).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('E'));
    answerWakeSegments(check, jest.fn());
    for (const name of ['b', 'c', 'd']) emit(`/cache/wake-segments/${name}.wav`);
    await settle();
    expect(native.heard).not.toHaveBeenCalled();
    expect(native.done).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledWith('[wake] a segment could not be answered', expect.objectContaining({ kind: 'phone_wake' }));
  });
});
