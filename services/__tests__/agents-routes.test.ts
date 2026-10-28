// The agents and long-task routes as the pond's feat/long-running-tasks serves them: each path and
// method, names as one encoded segment, and a body of the wrong shape refused rather than read as empty.

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
  authorization: string | null;
}

function recordInto(seen: Seen[], body: string, status = 200) {
  setFetch(async (url: string, init?: { method?: string; body?: string; headers?: Headers }) => {
    seen.push({
      url,
      method: init?.method,
      body: init?.body ? JSON.parse(init.body) : undefined,
      authorization: init?.headers?.get('Authorization') ?? null,
    });
    return reply(body, status);
  });
}

afterEach(() => {
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
  else delete (globalThis as { fetch?: unknown }).fetch;
});

function paired() {
  const client = new PondApiClient('https://pond.test:4000');
  client.setToken('session-token');
  return client;
}

const BASE = 'https://pond.test:4000/api/v1';

describe('recipes', () => {
  it('lists every recipe with the paired token, dropping rows that are not one', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '[{"id":"r1","name":"brief","yaml":"giap_role: {}\\n"},{"name":"no-id"},null]');
    const recipes = await paired().listRecipes();
    expect(seen[0]).toMatchObject({ url: `${BASE}/recipes`, method: undefined, authorization: 'Bearer session-token' });
    expect(recipes.map((r) => r.id)).toEqual(['r1']);
  });

  it('refuses a listing that is not a list, rather than reading it as no agents', async () => {
    recordInto([], '{"error":"Recipe repository not configured"}');
    await expect(paired().listRecipes()).rejects.toThrow('unexpected');
  });

  it('creates, updates and deletes by the right key', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"id":"r 1","name":"brief","yaml":""}');
    const client = paired();
    await client.createRecipe({ name: 'brief', description: 'Short.', yaml: 'giap_role: {}\n' });
    await client.updateRecipe('r 1', { yaml: 'x: 1\n' });
    await client.deleteRecipe('r 1');
    expect(seen.map((s) => [s.method, s.url, s.body])).toEqual([
      ['POST', `${BASE}/recipes`, { name: 'brief', description: 'Short.', yaml: 'giap_role: {}\n' }],
      ['PUT', `${BASE}/recipes/r%201`, { yaml: 'x: 1\n' }],
      ['DELETE', `${BASE}/recipes/r%201`, undefined],
    ]);
  });

  it('validates with the name when there is one', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"ok":false,"role":null,"errors":[{"path":"giap_role.instructions","message":"is empty"}]}');
    const check = await paired().validateRecipe('giap_role: {}\n', 'brief');
    expect(seen[0]).toMatchObject({ method: 'POST', url: `${BASE}/recipes/validate`, body: { yaml: 'giap_role: {}\n', name: 'brief' } });
    expect(check.errors).toEqual([{ path: 'giap_role.instructions', message: 'is empty' }]);

    await paired().validateRecipe('giap_role: {}\n');
    expect(seen[1].body).toEqual({ yaml: 'giap_role: {}\n' });
  });
});

describe('suggestions', () => {
  it('reads the list bare or wrapped', async () => {
    recordInto([], '[{"template":"a","title":"A","description":"","why":"","needs":[],"activations_summary":""}]');
    expect((await paired().listAgentSuggestions()).map((s) => s.template)).toEqual(['a']);
    recordInto([], '{"suggestions":[{"template":"b"}]}');
    expect((await paired().listAgentSuggestions()).map((s) => s.template)).toEqual(['b']);
  });

  it('turns one on and reads the recipe the 201 carries', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"id":"r9","name":"morning-brief","yaml":""}', 201);
    const recipe = await paired().enableAgentSuggestion('morning brief');
    expect(seen[0]).toMatchObject({ method: 'POST', url: `${BASE}/agents/suggestions/morning%20brief/enable` });
    expect(recipe.id).toBe('r9');
  });

  it('reaches the caller with a 409 when it is already on', async () => {
    recordInto([], '{"error":"you already have this agent"}', 409);
    await expect(paired().enableAgentSuggestion('brief')).rejects.toMatchObject({ status: 409 });
  });

  it('dismisses one, a 204', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '', 204);
    await paired().dismissAgentSuggestion('brief');
    expect(seen[0]).toMatchObject({ method: 'POST', url: `${BASE}/agents/suggestions/brief/dismiss` });
  });
});

describe('prefills', () => {
  it('reads the listing and the pass running now', async () => {
    const seen: Seen[] = [];
    recordInto(
      seen,
      JSON.stringify({
        building: { active: true, current: 'planner', done: 0, total: 3 },
        retention_days: 14,
        agents: [{ agent: 'planner', kind: 'default', status: 'building', compiled_at: null, last_used_at: null }],
      }),
    );
    const listing = await paired().agentPrefills();
    expect(seen[0]).toMatchObject({ url: `${BASE}/agents/prefills`, method: undefined, authorization: 'Bearer session-token' });
    expect(listing.building.current).toBe('planner');
    expect(listing.agents[0].status).toBe('building');
  });

  it('refuses a body that is not the listing', async () => {
    recordInto([], '{"status":"ok"}');
    await expect(paired().agentPrefills()).rejects.toThrow('unexpected');
  });

  it('reaches the caller with the 404 of a Pond that predates the route', async () => {
    recordInto([], '', 404);
    await expect(paired().agentPrefills()).rejects.toBeInstanceOf(ApiError);
  });

  it('rebuilds one by name, or all of them, each a 202', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '', 202);
    const client = paired();
    await client.rebuildAgentPrefill('trip/planner');
    await client.rebuildAllPrefills();
    expect(seen.map((s) => [s.method, s.url])).toEqual([
      ['POST', `${BASE}/agents/trip%2Fplanner/prefill/rebuild`],
      ['POST', `${BASE}/agents/prefills/rebuild`],
    ]);
  });
});

describe('long tasks', () => {
  const TASK = {
    id: 't 1',
    goal: 'Plan a weekend away',
    state: 'running',
    origin_session_id: 's1',
    created_at: '2026-10-28T09:00:00Z',
    updated_at: '2026-10-28T09:01:00Z',
    finished_at: null,
    steps: [{ key: 'a', role: 'long-task-worker', state: 'running', attempts: 1, summary: null, failure: null }],
    artifacts: [],
    result_artifact_id: null,
  };

  it('reads one task by id with the paired token', async () => {
    const seen: Seen[] = [];
    recordInto(seen, JSON.stringify(TASK));
    const task = await paired().longTask('t 1');
    expect(seen[0]).toMatchObject({ url: `${BASE}/long-tasks/t%201`, method: undefined, authorization: 'Bearer session-token' });
    expect(task.steps[0].role).toBe('long-task-worker');
  });

  it('refuses a body that is not a task', async () => {
    recordInto([], '{"error":"there is no such task"}');
    await expect(paired().longTask('t1')).rejects.toThrow('unexpected');
  });

  it('reads one artifact body, and stops a task, each by its own path', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"id":"a1","title":"Plan","kind":"draft","summary":"S","body":"## Plan"}');
    const body = await paired().longTaskArtifact('t1', 'a/1');
    expect(body.body).toBe('## Plan');
    await paired().cancelLongTask('t1');
    expect(seen.map((s) => [s.method, s.url])).toEqual([
      [undefined, `${BASE}/long-tasks/t1/artifacts/a%2F1`],
      ['POST', `${BASE}/long-tasks/t1/cancel`],
    ]);
  });

  it('reaches the caller with the 409 of a task that has already ended', async () => {
    recordInto([], '{"error":"the task has already completed"}', 409);
    await expect(paired().cancelLongTask('t1')).rejects.toMatchObject({ status: 409 });
  });
});

describe('deep research', () => {
  it('asks whether this member may ask for research, and reads the answer', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"available":false,"reason":"unidentified"}');
    expect(await paired().deepResearchAvailability()).toEqual({ available: false, reason: 'unidentified' });
    expect(seen[0]).toMatchObject({ url: `${BASE}/long-tasks/deep-research`, method: undefined, authorization: 'Bearer session-token' });
  });

  it('refuses an answer it cannot read, and passes on the 404 of an older Pond', async () => {
    recordInto([], '{"status":"ok"}');
    await expect(paired().deepResearchAvailability()).rejects.toThrow('unexpected');
    recordInto([], '', 404);
    await expect(paired().deepResearchAvailability()).rejects.toMatchObject({ status: 404 });
  });
});
