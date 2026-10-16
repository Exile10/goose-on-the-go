jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
/**
 * Checked against `pond-api/src/routes.rs`. Activation is pinned because the phone sent no role,
 * which the Pond refuses with a 400, so "Use" on the Models screen did nothing on a real Pond.
 */

import { ApiError, PondApiClient } from '@/services/api-client';

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

function setFetch(impl: unknown) {
  Object.defineProperty(globalThis, 'fetch', { value: impl, configurable: true, writable: true });
}

function reply(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

interface Seen {
  url: string;
  method?: string;
  body?: unknown;
}

function recordInto(seen: Seen[], body = '{}', status = 200) {
  setFetch(async (url: string, init?: { method?: string; body?: string }) => {
    seen.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined });
    return reply(body, status);
  });
}

afterEach(() => {
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
  else delete (globalThis as { fetch?: unknown }).fetch;
});

const api = () => new PondApiClient('https://pond.test:4000');
const BASE = 'https://pond.test:4000/api/v1';

describe('settings', () => {
  it('sends a change as a partial PUT and answers the whole record', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"mic_enabled":false,"network_mode":"open"}');
    const answer = await api().updateSettings({ mic_enabled: false });
    expect(seen[0]).toEqual({ url: `${BASE}/settings`, method: 'PUT', body: { mic_enabled: false } });
    expect(answer.network_mode).toBe('open');
  });

  it('carries the Pond’s reason for a refused value', async () => {
    recordInto([], '{"error":"network_mode must be one of open, allowlist, offline","fields":[]}', 422);
    await expect(api().updateSettings({ network_mode: 'closed' })).rejects.toMatchObject({
      status: 422,
      detail: 'network_mode must be one of open, allowlist, offline',
    });
  });

  it('lists the time zones, and none from a body without them', async () => {
    recordInto([], '{"zones":[{"zone":"Africa/Nairobi","offset":"+03:00","place":"Nairobi"}]}');
    await expect(api().listTimeZones()).resolves.toHaveLength(1);
    recordInto([], '{}');
    await expect(api().listTimeZones()).resolves.toEqual([]);
  });

  it('asks the speaking engine to apply only what changed', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{}');
    await api().applyTts({ speed: 1.25 });
    expect(seen[0]).toEqual({ url: `${BASE}/voice/tts/apply`, method: 'POST', body: { speed: 1.25 } });
  });
});

describe('models', () => {
  it('names the role when it activates a model', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"role":"tts","model_id":"tts_kokoro/af_heart"}');
    await api().activateModel('tts_kokoro', 'af_heart', 'tts');
    expect(seen[0]).toEqual({ url: `${BASE}/models/tts_kokoro/af_heart/activate`, method: 'POST', body: { role: 'tts' } });
  });

  it('asks for picture support with a download only when it is wanted', async () => {
    const seen: Seen[] = [];
    recordInto(seen);
    await api().downloadModel('gguf', 'gemma', false);
    expect(seen[0]).toEqual({ url: `${BASE}/models/gguf/gemma/download`, method: 'POST', body: { pictures: false } });
  });

  it('pauses, resumes and stops a download by its model', async () => {
    const seen: Seen[] = [];
    recordInto(seen);
    await api().controlDownload('gguf/gemma', 'pause');
    expect(seen[0]).toEqual({ url: `${BASE}/models/download/control`, method: 'POST', body: { model_id: 'gguf/gemma', action: 'pause' } });
  });

  it('reads the downloads, and none from a body without them', async () => {
    recordInto([], '{"downloads":[{"filename":"a.gguf","category":"gguf","downloaded_bytes":1,"total_bytes":2,"status":"downloading"}]}');
    await expect(api().downloadProgress()).resolves.toHaveLength(1);
    recordInto([], '{}');
    await expect(api().downloadProgress()).resolves.toEqual([]);
  });

  it('says a model in use cannot be deleted', async () => {
    recordInto([], '{"error":"model is assigned to a role"}', 409);
    await expect(api().deleteModel('gguf', 'gemma')).rejects.toBeInstanceOf(ApiError);
  });

  it('raises a search the Pond refused instead of showing no results', async () => {
    recordInto([], '{"models":[],"error":"network is offline"}');
    await expect(api().searchModels('gemma')).rejects.toThrow('network is offline');
  });

  it('asks for a repository’s files without encoding its slash', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"files":[]}');
    await api().modelFiles('unsloth/gemma-3-4b-it-GGUF');
    expect(seen[0].url).toBe(`${BASE}/models/search/gguf/files?repo=unsloth/gemma-3-4b-it-GGUF`);
  });

  it('downloads a Hugging Face file as a GGUF model', async () => {
    const seen: Seen[] = [];
    recordInto(seen);
    await api().downloadModelFile({ filename: 'm.gguf', url: 'https://huggingface.co/x/m.gguf' }, true);
    expect(seen[0].body).toEqual({ url: 'https://huggingface.co/x/m.gguf', category: 'gguf', filename: 'm.gguf', pictures: true });
  });
});
