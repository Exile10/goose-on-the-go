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

// Only a 401 is a dead token. A 403 is the Pond declining to serve the stream yet --
// before onboarding, for one -- and treating it as a dead token refreshed and
// reconnected loudly about ten times a second.
it('treats 401 as a dead token and 403 as a refusal to retry with backoff', async () => {
  jest.useFakeTimers();
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const authFailure = jest.fn(); const disconnected = jest.fn();
    const make = () => new NotificationStream({ baseUrl: 'https://pond.local:4443', token: 'secret', deviceId: 'phone', onNotification: jest.fn(), onDisconnect: disconnected, onAuthFailure: authFailure });

    const refused = make(); refused.start(); await Promise.resolve();
    const first = FakeXHR.instances[FakeXHR.instances.length - 1];
    first.status = 403; first.responseText = '{"error":"onboarding_required"}'; first.onload();
    expect(authFailure).not.toHaveBeenCalled();
    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('refused the stream (403)'), expect.stringContaining('onboarding_required'));
    // Back off: nothing before a second, then one attempt, then two seconds before the next.
    const before = FakeXHR.instances.length;
    jest.advanceTimersByTime(999); await Promise.resolve();
    expect(FakeXHR.instances.length).toBe(before);
    jest.advanceTimersByTime(1); await Promise.resolve(); await Promise.resolve();
    expect(FakeXHR.instances.length).toBe(before + 1);
    refused.stop();

    const dead = make(); dead.start(); await Promise.resolve();
    const last = FakeXHR.instances[FakeXHR.instances.length - 1];
    last.status = 401; last.onload();
    expect(authFailure).toHaveBeenCalledTimes(1);
    const after = FakeXHR.instances.length;
    jest.advanceTimersByTime(60_000); await Promise.resolve();
    expect(FakeXHR.instances.length).toBe(after);
  } finally {
    warn.mockRestore();
    jest.useRealTimers();
  }
});

// The background notice says "connected" on this signal, so it must mean the Pond accepted
// the stream: a 200 with headers in, once per connection, and never for a refusal.
it('reports a connection once the Pond accepts the stream, and never for a refusal', async () => {
  const connected = jest.fn();
  const stream = new NotificationStream({ baseUrl: 'https://pond.local:4443', token: 'secret', deviceId: 'phone', onNotification: jest.fn(), onConnect: connected });
  stream.start(); await Promise.resolve();
  const xhr = FakeXHR.instances[FakeXHR.instances.length - 1] as FakeXHR & { readyState: number; onreadystatechange: () => void };
  xhr.readyState = 1; xhr.onreadystatechange();
  expect(connected).not.toHaveBeenCalled();
  xhr.readyState = 2; xhr.onreadystatechange();
  expect(connected).toHaveBeenCalledTimes(1);
  xhr.responseText = ': keep-alive\n\n'; xhr.onprogress();
  expect(connected).toHaveBeenCalledTimes(1);
  stream.stop();

  const refused = new NotificationStream({ baseUrl: 'https://pond.local:4443', token: 'secret', deviceId: 'phone', onNotification: jest.fn(), onConnect: connected, onAuthFailure: jest.fn() });
  refused.start(); await Promise.resolve();
  const denied = FakeXHR.instances[FakeXHR.instances.length - 1] as FakeXHR & { readyState: number; onreadystatechange: () => void };
  denied.status = 401; denied.readyState = 2; denied.onreadystatechange(); denied.onprogress();
  expect(connected).toHaveBeenCalledTimes(1);
  refused.stop();
});

it('reports a connection on the first read where no header event came', async () => {
  const connected = jest.fn();
  const stream = new NotificationStream({ baseUrl: 'https://pond.local:4443', token: 'secret', deviceId: 'phone', onNotification: jest.fn(), onConnect: connected });
  stream.start(); await Promise.resolve();
  const xhr = FakeXHR.instances[FakeXHR.instances.length - 1];
  xhr.responseText = ': keep-alive\n\n'; xhr.onprogress();
  expect(connected).toHaveBeenCalledTimes(1);
  stream.stop();
});

// Each drop doubles the wait from 1 s; the owner's cap decides where it stops. In the background the
// app lets it grow to five minutes, so an unreachable Pond is not retried every 30 s all day.
it('lets the owner cap the wait between reconnects, asked at each drop', async () => {
  jest.useFakeTimers();
  try {
    const waitAfterSixDrops = async (cap?: () => number): Promise<{ at30: boolean; at32: boolean }> => {
      FakeXHR.instances = [];
      const stream = new NotificationStream({ baseUrl: 'https://pond.local:4443', token: 'secret', deviceId: 'phone', onNotification: jest.fn(), maxBackoffMs: cap });
      stream.start(); await Promise.resolve();
      const drop = async (waitMs: number) => {
        FakeXHR.instances[FakeXHR.instances.length - 1].onload();
        jest.advanceTimersByTime(waitMs); await Promise.resolve(); await Promise.resolve();
      };
      for (const wait of [1_000, 2_000, 4_000, 8_000, 16_000]) await drop(wait);
      const before = FakeXHR.instances.length;
      await drop(30_000);
      const at30 = FakeXHR.instances.length > before;
      jest.advanceTimersByTime(2_000); await Promise.resolve(); await Promise.resolve();
      const at32 = FakeXHR.instances.length > before;
      stream.stop();
      return { at30, at32 };
    };
    expect(await waitAfterSixDrops()).toEqual({ at30: true, at32: true });
    expect(await waitAfterSixDrops(() => 300_000)).toEqual({ at30: false, at32: true });
  } finally {
    jest.useRealTimers();
  }
});
