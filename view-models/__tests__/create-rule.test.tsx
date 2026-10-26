/**
 * Adding a rule from a screen that keeps no list of them, such as the sheet of an event.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import type { RuleRequest } from '@/services/types';
import { useCreateRule } from '@/view-models/use-rules';

jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { createRule: jest.fn() } };
});

const server = { real: true };
jest.mock('@/providers/server-provider', () => ({
  useServer: () => ({ hydrated: true, isScreenReal: () => server.real }),
}));

const pond = jest.mocked(api);

const REQUEST: RuleRequest = {
  name: 'Package seen',
  source: { kind: 'camera', signal: 'package' },
  actions: [{ type: 'notify', title: 'A package', body: 'Seen by camera-1.' }],
};

const mounted: ReactTestRenderer[] = [];
async function mount(): Promise<{ readonly create: (req: RuleRequest) => Promise<string | null> }> {
  let latest!: (req: RuleRequest) => Promise<string | null>;
  const Probe = () => {
    latest = useCreateRule();
    return null;
  };
  await act(async () => {
    mounted.push(create(<Probe />));
  });
  return { get create() { return latest; } };
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.resetAllMocks();
  server.real = true;
});

afterEach(async () => {
  for (const tree of mounted.splice(0)) await act(async () => tree.unmount());
});

it('sends the rule to the Pond, and resolves null once it exists', async () => {
  pond.createRule.mockResolvedValue({ id: 'n1' } as never);
  const m = await mount();

  await expect(m.create(REQUEST)).resolves.toBeNull();

  expect(pond.createRule).toHaveBeenCalledWith(REQUEST);
});

it('resolves to why the Pond refused it', async () => {
  pond.createRule.mockRejectedValue(new ApiError('x', 400, null, 'a rule needs at least one action'));
  const m = await mount();

  await expect(m.create(REQUEST)).resolves.toBe('a rule needs at least one action');
});

it('has a sentence for a refusal that carries none', async () => {
  pond.createRule.mockRejectedValue(new TypeError('Network request failed'));
  const m = await mount();

  await expect(m.create(REQUEST)).resolves.toBe('Your Pond could not create it. Try again in a moment.');
});

it('keeps nothing on mock, where there is no Pond to keep it', async () => {
  server.real = false;
  const m = await mount();

  await expect(m.create(REQUEST)).resolves.toBeNull();

  expect(pond.createRule).not.toHaveBeenCalled();
});
