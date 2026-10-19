/**
 * The proposal wrappers, shown in the app as Suggestions.
 *
 * Routes and bodies are checked against `list_proposals` and `decide_proposal`
 * in `pond-api/src/routes.rs`: `session_id` is required in both, and the decision
 * is `approve` or `reject` with no default. A live Pond is still the real test.
 */

import { ApiError, PondApiClient } from '@/services/api-client';
import type { Proposal } from '@/services/types';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

function setFetch(impl: unknown) {
  Object.defineProperty(globalThis, 'fetch', { value: impl, configurable: true, writable: true });
}

/** A `Response` stand-in carrying only what `request()` reads. */
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

/** The wire shape `proposal_json` builds, field for field. */
const PROPOSAL: Proposal = {
  id: 'p1',
  summary: 'Close the garage door',
  rationale: 'It has been open for an hour and nobody is home.',
  confidence: 0.8,
  profile_id: 'm1',
  created_at: '2026-10-19T09:00:00+00:00',
  expires_at: '2026-10-19T13:00:00+00:00',
  proposed_action: { type: 'agent_prompt', prompt: 'Close the garage door' },
  trigger: { kind: 'sensor', source_id: 'garage', signal: 'open', observed_at: '2026-10-19T08:00:00+00:00' },
};

describe('listProposals', () => {
  it('asks for this caller with the session escaped, and unwraps the list', async () => {
    const seen: Seen[] = [];
    recordInto(seen, JSON.stringify({ profile_id: 'm1', proposals: [PROPOSAL] }));
    const api = new PondApiClient('https://pond.test:4000');

    const list = await api.listProposals('a b&c');

    expect(seen[0].method ?? 'GET').toBe('GET');
    expect(seen[0].url).toBe('https://pond.test:4000/api/v1/proposals?session_id=a%20b%26c');
    expect(list).toEqual([PROPOSAL]);
  });

  it('passes the 403 through, for a caller the Pond cannot address', async () => {
    recordInto([], JSON.stringify({ error: 'this pond has more than one member and nobody said who is asking' }), 403);
    const api = new PondApiClient('https://pond.test:4000');

    const failure = await api.listProposals('s').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(403);
  });
});

describe('decideProposal', () => {
  it.each(['approve', 'reject'] as const)('posts %s with the session in the body', async (decision) => {
    const seen: Seen[] = [];
    recordInto(seen, JSON.stringify({ id: 'a/b', status: decision === 'approve' ? 'approved' : 'rejected', executed: false }));
    const api = new PondApiClient('https://pond.test:4000');

    const result = await api.decideProposal('a/b', 's1', decision);

    expect(seen[0].method).toBe('POST');
    expect(seen[0].url).toBe('https://pond.test:4000/api/v1/proposals/a%2Fb/decide');
    // `deny_unknown_fields` on the Pond: exactly these two keys, nothing else.
    expect(seen[0].body).toEqual({ session_id: 's1', decision });
    expect(result.executed).toBe(false);
  });
});
