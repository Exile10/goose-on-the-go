jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
/**
 * The activity, log-export and telemetry wrappers (issue #15).
 *
 * Shapes are the Pond's (`pond-api/src/routes.rs`: `get_activity`,
 * `clear_activity`, `activity_summary`, `export_logs_csv`,
 * `get_telemetry_summary`, `get_telemetry_turns`). A live Pond is still the
 * real test, and is listed in the PR.
 */

import { ApiError, PondApiClient } from '@/services/api-client';

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

function setFetch(impl: unknown) {
  Object.defineProperty(globalThis, 'fetch', { value: impl, configurable: true, writable: true });
}

/** A `Response` stand-in carrying only what `request()` and `open()` read. */
function reply(body: string, init: { status?: number } = {}) {
  const status = init.status ?? 200;
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
}

function recordInto(seen: Seen[], body: string) {
  setFetch(async (url: string, init?: { method?: string }) => {
    seen.push({ url, method: init?.method });
    return reply(body);
  });
}

const BASE = 'https://pond.test:4000';

afterEach(() => {
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
  else delete (globalThis as { fetch?: unknown }).fetch;
});

describe('activity', () => {
  /** There is no cursor: the way back is `until`, the oldest timestamp already seen. */
  it('sends until alongside the other filters', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"count":0,"events":[]}');
    const api = new PondApiClient(BASE);

    await api.listActivity({ limit: 50, until: '2026-10-05T09:00:00+00:00', category: 'device' });

    expect(seen[0].url).toBe(
      `${BASE}/api/v1/activity?limit=50&until=2026-10-05T09%3A00%3A00%2B00%3A00&category=device`,
    );
  });

  it('asks for the summary over the window given, and the Pond default without one', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"window":"day","since":"x","total":0,"by_category":{}}');
    const api = new PondApiClient(BASE);

    await api.activitySummary('week');
    await api.activitySummary();

    expect(seen.map((s) => s.url)).toEqual([
      `${BASE}/api/v1/activity/summary?window=week`,
      `${BASE}/api/v1/activity/summary`,
    ]);
  });

  it('clears with a DELETE that names no filter, and reports how many went', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"purged":42}');
    const api = new PondApiClient(BASE);

    await expect(api.clearActivity()).resolves.toEqual({ purged: 42 });
    expect(seen).toEqual([{ url: `${BASE}/api/v1/activity`, method: 'DELETE' }]);
  });
});

describe('log export', () => {
  it('returns the CSV body as text', async () => {
    const csv = 'id,timestamp,level,source,message,metadata\n2,2026-10-05 09:00:00,WARN,agent,"slow, but fine",\n';
    const seen: Seen[] = [];
    recordInto(seen, csv);
    const api = new PondApiClient(BASE);

    await expect(api.exportLogsCsv()).resolves.toBe(csv);
    expect(seen[0].url).toBe(`${BASE}/api/v1/logs/export`);
  });

  /** 501 is a Pond with no log configured; its body is plain text, not JSON. */
  it('throws an ApiError with the status on a refusal', async () => {
    setFetch(async () => reply('Event log not configured', { status: 501 }));
    const api = new PondApiClient(BASE);

    const error = await api.exportLogsCsv().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(501);
  });
});

describe('telemetry', () => {
  it('escapes the session id into the query', async () => {
    const seen: Seen[] = [];
    recordInto(seen, '{"avg_ttft_ms":0,"avg_completion_tokens":0,"total_turns":0,"avg_context_utilization":0}');
    const api = new PondApiClient(BASE);

    await api.telemetrySummary('a&b=c');

    expect(seen[0].url).toBe(`${BASE}/api/v1/telemetry/summary?session_id=a%26b%3Dc`);
  });

  it('unwraps the turns envelope', async () => {
    setFetch(async () => reply('{"turns":[{"turn_number":1},{"turn_number":2}]}'));
    const api = new PondApiClient(BASE);

    await expect(api.telemetryTurns('s1')).resolves.toEqual([{ turn_number: 1 }, { turn_number: 2 }]);
  });

  /** An envelope with the key missing must not reach a screen as `undefined`. */
  it('reads a turns body with no list as no turns', async () => {
    setFetch(async () => reply('{}'));
    const api = new PondApiClient(BASE);

    await expect(api.telemetryTurns('s1')).resolves.toEqual([]);
  });
});
