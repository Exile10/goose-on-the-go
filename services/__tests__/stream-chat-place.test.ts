/** `streamChat` sends the phone's place with a turn only when the place source gives one. */

import { PondApiClient } from '@/services/api-client';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
let bodies: unknown[] = [];

beforeEach(() => {
  bodies = [];
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async (_url: string, init?: { body?: string }) => {
      bodies.push(JSON.parse(init?.body ?? '{}'));
      return { ok: true, status: 200, headers: { get: () => null }, body: null, text: async () => '' };
    },
  });
});

afterEach(() => {
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
  else delete (globalThis as { fetch?: unknown }).fetch;
});

async function send(place: string | undefined) {
  const client = new PondApiClient('https://pond.test:4000');
  client.setToken('t');
  client.setTurnPlace(async () => place);
  await client.streamChat({ message: 'where am I' }, () => undefined).catch(() => undefined);
}

it('adds the place while it is shared, and nothing otherwise', async () => {
  await send('Westlands, Nairobi');
  await send(undefined);
  expect(bodies[0]).toEqual({ message: 'where am I', device_place: 'Westlands, Nairobi' });
  expect(bodies[1]).toEqual({ message: 'where am I' });
});
