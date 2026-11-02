// The mock Pond has to behave as the contract says the real one will, or the screens are built
// against a Pond that does not exist.

import { createMockAgents, MOCK_COMPILE_MS, MOCK_QUIET_MS } from '@/models/agents-mock';
import { ApiError } from '@/services/api-client';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));

function clock() {
  let t = Date.parse('2026-10-28T09:00:00Z');
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const statusOf = async (pond: ReturnType<typeof createMockAgents>, agent: string) =>
  (await pond.prefills()).agents.find((p) => p.agent === agent)?.status;

it('starts with agents, built-in helpers and suggestions to show, and nothing compiling', async () => {
  const pond = createMockAgents(clock().now);
  expect((await pond.listRecipes()).map((r) => r.name)).toEqual(['morning-brief', 'trip-planner', 'welcome-back']);
  const listing = await pond.prefills();
  expect(listing.building.active).toBe(false);
  expect(listing.agents.filter((p) => p.kind === 'default').map((p) => p.agent)).toEqual(['long-task-planner', 'long-task-worker', 'long-task-verifier', 'long-task-composer', 'voice']);
  expect((await pond.listSuggestions()).length).toBeGreaterThan(0);
});

it('queues a rebuild, waits for a quiet moment, then compiles it', async () => {
  const c = clock();
  const pond = createMockAgents(c.now);
  await pond.rebuild('trip-planner');
  expect(await statusOf(pond, 'trip-planner')).toBe('queued');
  expect((await pond.prefills()).building).toEqual({ active: true, current: null, done: 0, total: 1 });

  c.advance(MOCK_QUIET_MS);
  expect(await statusOf(pond, 'trip-planner')).toBe('building');
  expect((await pond.prefills()).building.current).toBe('trip-planner');

  c.advance(MOCK_COMPILE_MS);
  const listing = await pond.prefills();
  expect(listing.building.active).toBe(false);
  expect(listing.agents.find((p) => p.agent === 'trip-planner')).toMatchObject({ status: 'ready', compiled_at: new Date(c.now()).toISOString() });
});

it('compiles every agent once, one at a time, when all are rebuilt', async () => {
  const c = clock();
  const pond = createMockAgents(c.now);
  await pond.rebuildAll();
  const total = (await pond.prefills()).agents.length;
  expect((await pond.prefills()).building).toMatchObject({ active: true, done: 0, total });

  c.advance(MOCK_QUIET_MS + 2 * MOCK_COMPILE_MS);
  const midway = await pond.prefills();
  expect(midway.building.done).toBe(2);
  expect(midway.agents.filter((p) => p.status === 'building')).toHaveLength(1);

  c.advance(total * MOCK_COMPILE_MS);
  const after = await pond.prefills();
  expect(after.building.active).toBe(false);
  expect(after.agents.every((p) => p.status === 'ready')).toBe(true);
});

it('does not queue an agent twice while it is still waiting', async () => {
  const pond = createMockAgents(clock().now);
  await pond.rebuild('morning-brief');
  await pond.rebuild('morning-brief');
  expect((await pond.prefills()).building.total).toBe(1);
});

it('compiles an agent when it is saved, and drops its prefill when it is deleted', async () => {
  const c = clock();
  const pond = createMockAgents(c.now);
  const made = await pond.createRecipe({ name: 'plant-minder', description: '', yaml: 'giap_role:\n  instructions: Water.\n' });
  expect(await statusOf(pond, 'plant-minder')).toBe('queued');

  c.advance(MOCK_QUIET_MS + MOCK_COMPILE_MS);
  expect(await statusOf(pond, 'plant-minder')).toBe('ready');

  await pond.updateRecipe(made.id, { yaml: 'giap_role:\n  instructions: Water them.\n' });
  expect(await statusOf(pond, 'plant-minder')).toBe('queued');

  await pond.deleteRecipe(made.id);
  expect(await statusOf(pond, 'plant-minder')).toBeUndefined();
  expect((await pond.listRecipes()).some((r) => r.name === 'plant-minder')).toBe(false);
});

it('turns a suggestion on once, compiling it, and answers 409 after', async () => {
  const pond = createMockAgents(clock().now);
  const [first] = await pond.listSuggestions();
  const recipe = await pond.enableSuggestion(first.template);
  expect(await statusOf(pond, recipe.name)).toBe('queued');
  expect((await pond.listSuggestions()).some((s) => s.template === first.template)).toBe(false);
  await expect(pond.enableSuggestion(first.template)).rejects.toMatchObject({ status: 409 });
});

it('names a problem by its field path, as the validate route does', async () => {
  const pond = createMockAgents(clock().now);
  const check = await pond.validateRecipe('giap_role:\n  tool_groups: [giap-system]\n  max_turns: 40\n');
  expect(check.ok).toBe(false);
  expect(check.errors.map((e) => e.path)).toEqual(['giap_role.instructions', 'giap_role.tool_groups[0]', 'giap_role.max_turns']);
  expect((await pond.validateRecipe('giap_role:\n  instructions: Fine.\n')).ok).toBe(true);
});

it('answers 404 for an agent it does not have', async () => {
  const pond = createMockAgents(clock().now);
  await expect(pond.rebuild('nobody')).rejects.toBeInstanceOf(ApiError);
  await expect(pond.deleteRecipe('nope')).rejects.toMatchObject({ status: 404 });
});
