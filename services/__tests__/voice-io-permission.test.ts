/**
 * A microphone already allowed is read, not asked for: asking goes through the foreground
 * activity, which the assist overlay is not when the app's own screen sits stopped behind it.
 */

const mockGet = jest.fn();
const mockRequest = jest.fn();
jest.mock('expo-audio', () => ({
  AudioModule: { AudioStream: function AudioStream() {} },
  getRecordingPermissionsAsync: () => mockGet(),
  requestRecordingPermissionsAsync: () => mockRequest(),
}));
jest.mock('expo-file-system', () => ({ File: function File() {}, Paths: {} }));
jest.mock('expo-modules-core', () => ({ useReleasingSharedObjectWithLifecycle: jest.fn() }));

import { requestMicrophone } from '@/services/voice-io';

beforeEach(() => {
  mockGet.mockReset();
  mockRequest.mockReset();
});

describe('requestMicrophone', () => {
  it('reads a permission already held without asking for it', async () => {
    mockGet.mockResolvedValue({ granted: true, canAskAgain: true });
    await expect(requestMicrophone()).resolves.toEqual({ granted: true, canAskAgain: true });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('asks when the permission is not held, and reports the answer', async () => {
    mockGet.mockResolvedValue({ granted: false, canAskAgain: true });
    mockRequest.mockResolvedValue({ granted: false, canAskAgain: false });
    await expect(requestMicrophone()).resolves.toEqual({ granted: false, canAskAgain: false });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
