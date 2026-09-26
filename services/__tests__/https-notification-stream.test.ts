jest.mock('../pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
import { NotificationStream, NotificationDeduplicator } from '../notification-stream';
import { assertPondTrust } from '../pond-trust';
class FakeXHR {
  static instances: FakeXHR[] = [];
  headers: Record<string, string> = {}; responseText = ''; status = 200;
  onprogress = () => {}; onerror = () => {}; onload = () => {}; ontimeout = () => {};
  open = jest.fn(); send = jest.fn(); abort = jest.fn();
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  constructor() { FakeXHR.instances.push(this); }
}
beforeEach(() => { FakeXHR.instances = []; jest.clearAllMocks(); global.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest; });
it('waits for trust and shares deduplication across endpoint changes', async () => {
  const emitted = jest.fn(); const deduplicator = new NotificationDeduplicator();
  const make = (baseUrl: string) => new NotificationStream({ baseUrl, token: 'session', deviceId: 'phone', onNotification: emitted, deduplicator });
  const local = make('https://pond.local:4443'); local.start();
  expect(FakeXHR.instances).toHaveLength(0); await Promise.resolve();
  const a = FakeXHR.instances[0]; expect(a.headers['X-Pond-Transport']).toBe('1');
  a.responseText = 'data: {"id":"once"}\n\n'; a.onprogress(); local.stop();
  const remote = make('https://100.64.0.2:4443'); remote.start(); await Promise.resolve();
  const b = FakeXHR.instances[1]; b.responseText = a.responseText; b.onprogress();
  expect(emitted).toHaveBeenCalledTimes(1); remote.stop();
});
it('never creates XHR when native trust is unavailable', async () => {
  jest.mocked(assertPondTrust).mockRejectedValueOnce(new Error('untrusted'));
  const disconnected = jest.fn();
  const stream = new NotificationStream({ baseUrl: 'https://pond.local:4443', token: 'secret', deviceId: 'phone', onNotification: jest.fn(), onDisconnect: disconnected });
  stream.start(); await Promise.resolve(); expect(FakeXHR.instances).toHaveLength(0); expect(disconnected).toHaveBeenCalledTimes(1); stream.stop();
});

// A dropped stream reports the drop and comes back on its own. The owner's
// recovery finding the same endpoint changes nothing it reacts to, so a stream
// that only reported and stopped stayed silent until the app was backgrounded.
it('reconnects after a drop even when an owner is told about it', async () => {
  jest.useFakeTimers();
  try {
    const disconnected = jest.fn();
    const stream = new NotificationStream({ baseUrl: 'https://pond.local:4443', token: 'secret', deviceId: 'phone', onNotification: jest.fn(), onDisconnect: disconnected });
    stream.start(); await Promise.resolve();
    const first = FakeXHR.instances[FakeXHR.instances.length - 1];
    first.status = 200; first.onload();
    expect(disconnected).toHaveBeenCalledTimes(1);
    const before = FakeXHR.instances.length;
    jest.advanceTimersByTime(1_000); await Promise.resolve(); await Promise.resolve();
    expect(FakeXHR.instances.length).toBe(before + 1);
    stream.stop();
  } finally {
    jest.useRealTimers();
  }
});

it('does not reconnect after the owner stops it', async () => {
  jest.useFakeTimers();
  try {
    const stream = new NotificationStream({ baseUrl: 'https://pond.local:4443', token: 'secret', deviceId: 'phone', onNotification: jest.fn(), onDisconnect: () => stream.stop() });
    stream.start(); await Promise.resolve();
    const first = FakeXHR.instances[FakeXHR.instances.length - 1];
    first.status = 200; first.onload();
    const before = FakeXHR.instances.length;
    jest.advanceTimersByTime(60_000); await Promise.resolve();
    expect(FakeXHR.instances.length).toBe(before);
  } finally {
    jest.useRealTimers();
  }
});
