import { PondApiClient } from '@/services/api-client';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));

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

describe('prompt template API routes', () => {
  afterEach(() => {
    if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
  });

  const client = new PondApiClient('https://pond.example:4443');

  it('lists prompt templates from GET /api/v1/prompts', async () => {
    const seen: Seen[] = [];
    recordInto(
      seen,
      JSON.stringify([
        { name: 'soul', content: 'Soul content', is_system: true },
        { name: 'heartbeat', content: 'Heartbeat content', is_system: true },
      ]),
    );

    const list = await client.listPromptTemplates();
    expect(seen).toEqual([{ url: 'https://pond.example:4443/api/v1/prompts', method: undefined, body: undefined }]);
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('soul');
  });

  it('gets a single template from GET /api/v1/prompts/{name}', async () => {
    const seen: Seen[] = [];
    recordInto(seen, JSON.stringify({ name: 'scratchpad', content: 'Memory rules', is_system: true }));

    const tpl = await client.getPromptTemplate('scratchpad');
    expect(seen).toEqual([{ url: 'https://pond.example:4443/api/v1/prompts/scratchpad', method: undefined, body: undefined }]);
    expect(tpl.name).toBe('scratchpad');
  });

  it('updates a template via PUT /api/v1/prompts/{name}', async () => {
    const seen: Seen[] = [];
    recordInto(seen, JSON.stringify({ name: 'soul', content: 'Updated soul', is_system: true, is_customized: true }));

    const updated = await client.updatePromptTemplate('soul', 'Updated soul');
    expect(seen).toEqual([
      {
        url: 'https://pond.example:4443/api/v1/prompts/soul',
        method: 'PUT',
        body: { content: 'Updated soul' },
      },
    ]);
    expect(updated.is_customized).toBe(true);
  });

  it('resets a template via POST /api/v1/prompts/{name}/reset', async () => {
    const seen: Seen[] = [];
    recordInto(seen, JSON.stringify({ name: 'soul', content: 'Original soul', is_system: true, is_customized: false }));

    const reset = await client.resetPromptTemplate('soul');
    expect(seen).toEqual([
      {
        url: 'https://pond.example:4443/api/v1/prompts/soul/reset',
        method: 'POST',
        body: {},
      },
    ]);
    expect(reset.is_customized).toBe(false);
  });
});
