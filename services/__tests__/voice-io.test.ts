import { stopStream } from '@/services/voice-io';

describe('stopping the microphone', () => {
  afterEach(() => jest.restoreAllMocks());

  it('stops a live stream', () => {
    const stop = jest.fn();
    stopStream(stop);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  // What closing voice mode does: expo-audio has released the stream by the time the
  // voice hook's cleanup stops it. Throwing here, during unmount, closed the app.
  it('treats a stream expo-audio already released as stopped, quietly', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const released = Object.assign(new Error('Cannot use shared object that was already released'), {
      code: 'ERR_USING_RELEASED_SHARED_OBJECT',
    });
    expect(() => stopStream(() => { throw released; })).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports any other failure without throwing it', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => stopStream(() => { throw new Error('the hardware said no'); })).not.toThrow();
    expect(warn).toHaveBeenCalledWith('[voice] the microphone did not stop:', expect.any(Error));
  });
});
