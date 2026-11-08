/**
 * The JavaScript side of the assistant module: a no-op wherever there is no bridge, and every
 * failure logged rather than thrown into a screen.
 */
import { NativeModules, Platform } from 'react-native';

import { assistantSupported, choosePhoneAssistant, closeAssist, isPhoneAssistant } from '@/services/phone-assistant';

const bridge = {
  isAssistant: jest.fn(),
  chooseAssistant: jest.fn(),
  close: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.replaceProperty(Platform, 'OS', 'android');
  NativeModules.PondAssist = bridge;
});

afterEach(() => {
  jest.restoreAllMocks();
  delete NativeModules.PondAssist;
});

describe('on Android with the module', () => {
  it('passes the role through', async () => {
    bridge.isAssistant.mockResolvedValue(true);
    expect(assistantSupported()).toBe(true);
    await expect(isPhoneAssistant()).resolves.toBe(true);
  });

  it('reads a failed role question as unknown, and says so in the log', async () => {
    bridge.isAssistant.mockRejectedValue(new Error('E_ASSIST_ROLE'));
    await expect(isPhoneAssistant()).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith('[assistant] could not read the assistant role', expect.objectContaining({ kind: 'phone_assistant' }));
  });

  it('reports whether a settings screen opened, logging when none did', async () => {
    bridge.chooseAssistant.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(choosePhoneAssistant()).resolves.toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
    await expect(choosePhoneAssistant()).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('closes the overlay, and logs a close with no overlay in front', async () => {
    bridge.close.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await closeAssist();
    expect(console.warn).not.toHaveBeenCalled();
    await closeAssist();
    expect(console.warn).toHaveBeenCalledWith('[assistant] close asked with no overlay in front', expect.anything());
  });
});

describe('without the module', () => {
  it.each(['ios', 'android'] as const)('does nothing on %s', async (os) => {
    jest.replaceProperty(Platform, 'OS', os);
    if (os === 'android') delete NativeModules.PondAssist;
    expect(assistantSupported()).toBe(false);
    await expect(isPhoneAssistant()).resolves.toBeNull();
    await expect(choosePhoneAssistant()).resolves.toBe(false);
    await closeAssist();
    expect(bridge.isAssistant).not.toHaveBeenCalled();
    expect(bridge.chooseAssistant).not.toHaveBeenCalled();
    expect(bridge.close).not.toHaveBeenCalled();
  });
});
