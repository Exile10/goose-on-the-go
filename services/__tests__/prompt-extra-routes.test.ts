/**
 * The prompt-extra wrappers.
 *
 * Routes and bodies are checked against `pond-api/src/routes.rs` (`list_prompt_extras`,
 * `upsert_prompt_extra`, `delete_prompt_extra`) and the `PromptExtra` domain type; a live Pond is
 * still the real test.
 */

import { ApiError, PondApiClient } from '@/services/api-client';

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

afterEach(() => {
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
  else delete (globalThis as { fetch?: unknown }).fetch;
});

const api = () => new PondApiClient('https://pond.test:4000');

it('lists the bare array the Pond sends, inactive notes included', async () => {
  const seen: Seen[] = [];
  recordInto(
    seen,
    '[{"key":"language","instruction":"Answer in Swahili.","active":true,"sort_order":0},' +
      '{"key":"quiet","instruction":"Be brief.","active":false,"sort_order":1}]',
  );

  const list = await api().listPromptExtras();

  expect(seen).toEqual([{ url: 'https://pond.test:4000/api/v1/agent/extras', method: undefined, body: undefined }]);
  expect(list.map((e) => [e.key, e.active])).toEqual([
    ['language', true],
    ['quiet', false],
  ]);
});

it('saves with POST and the four fields the Pond reads', async () => {
  const seen: Seen[] = [];
  recordInto(seen, '{"key":"language","status":"ok"}');

  await api().savePromptExtra({ key: 'language', instruction: 'Answer in Swahili.', active: false, sort_order: 3 });

  expect(seen).toEqual([
    {
      url: 'https://pond.test:4000/api/v1/agent/extras',
      method: 'POST',
      body: { key: 'language', instruction: 'Answer in Swahili.', active: false, sort_order: 3 },
    },
  ]);
});

it('deletes by key, escaped, in one request', async () => {
  const seen: Seen[] = [];
  recordInto(seen, '', 204);

  await api().deletePromptExtra('a/b c');

  expect(seen).toEqual([{ url: 'https://pond.test:4000/api/v1/agent/extras/a%2Fb%20c', method: 'DELETE', body: undefined }]);
});

it('surfaces the 501 a Pond without the notes store sends', async () => {
  recordInto([], '{"error":"Prompt extra repository not configured"}', 501);

  const failure = await api().listPromptExtras().catch((e: unknown) => e);

  expect(failure).toBeInstanceOf(ApiError);
  expect((failure as ApiError).status).toBe(501);
});
