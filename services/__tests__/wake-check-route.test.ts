jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-file-system', () => ({
  // A Blob, as Node's FormData accepts nothing else; the app's runtime takes a file by its uri.
  File: class extends Blob {
    uri: string;
    constructor(mockUri: string) {
      super([]);
      this.uri = mockUri;
    }
  },
}));
/**
 * `checkWakeSegment`: one segment to `POST /voice/wake/check` as multipart `audio` with
 * `phrase_only`, behind the session token, and only `{heard, phrase}` read back.
 */

import { ApiError, PondApiClient } from '@/services/api-client';

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
let seen: { url: string; method?: string; body?: unknown; auth?: string | null }[] = [];

function answer(body: string, status = 200) {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async (url: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => {
      seen.push({ url, method: init?.method, body: init?.body, auth: new Headers(init?.headers).get('Authorization') });
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        text: async () => body,
        json: async () => JSON.parse(body),
      };
    },
  });
}

const api = () => {
  const client = new PondApiClient('https://pond.test:4000');
  client.setToken('session-token');
  return client;
};

let appended: [string, string, string | undefined][] = [];

beforeEach(() => {
  seen = [];
  appended = [];
  const append = FormData.prototype.append;
  jest.spyOn(FormData.prototype, 'append').mockImplementation(function (this: FormData, name: string, value: string | Blob, file?: string) {
    appended.push([name, typeof value === 'string' ? value : (value as Blob & { uri: string }).uri, file]);
    if (typeof value === 'string') (append as (this: FormData, n: string, v: string) => void).call(this, name, value);
    else append.call(this, name, value, file);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
  else delete (globalThis as { fetch?: unknown }).fetch;
});

it('sends the segment as audio with the token and reads the verdict', async () => {
  answer('{"heard": true, "phrase": "Hey Jarvis"}');
  await expect(api().checkWakeSegment('file:///cache/wake-segments/segment-1.wav')).resolves.toEqual({ heard: true, phrase: 'Hey Jarvis' });
  expect(seen).toHaveLength(1);
  expect(seen[0].url).toBe('https://pond.test:4000/api/v1/voice/wake/check');
  expect(seen[0].method).toBe('POST');
  expect(seen[0].auth).toBe('Bearer session-token');
  expect(seen[0].body).toBeInstanceOf(FormData);
  // The whole phrase: the phone only sends what was already near it (`phrase_only`).
  expect(appended).toEqual([
    ['audio', 'file:///cache/wake-segments/segment-1.wav', 'segment.wav'],
    ['phrase_only', 'true', undefined],
  ]);
});

it('names a refusal, and rejects an answer of another shape', async () => {
  answer('{"error": "speech_recognition_unavailable"}', 503);
  await expect(api().checkWakeSegment('file:///s.wav')).rejects.toBeInstanceOf(ApiError);
  answer('{"heard": "yes"}');
  await expect(api().checkWakeSegment('file:///s.wav')).rejects.toThrow('unexpected');
});
