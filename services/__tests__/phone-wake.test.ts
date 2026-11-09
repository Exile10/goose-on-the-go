/**
 * The JavaScript side of the wake-word module: a no-op wherever there is no bridge or no detector,
 * and every failure logged rather than thrown into a screen.
 */
import { NativeModules, Platform } from 'react-native';

import { choosePhoneWake, phoneWakeState, phoneWakeSupported, resumePhoneWake } from '@/services/phone-wake';

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
