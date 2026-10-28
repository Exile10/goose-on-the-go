// Every agents route goes through here, so a route the Pond ships later needs only its method in
// `api-client.ts`, and the Developer toggle can swap in the mock Pond.

import { createMockAgents, type AgentsSource } from '@/models/agents-mock';
import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';

export type { AgentsSource } from '@/models/agents-mock';

/** Calls `api` at call time, so a test's mock of the client is the one used. */
export const POND_AGENTS: AgentsSource = {
  listRecipes: () => api.listRecipes(),
  createRecipe: (req) => api.createRecipe(req),
  updateRecipe: (id, patch) => api.updateRecipe(id, patch),
  deleteRecipe: (id) => api.deleteRecipe(id),
  validateRecipe: (yaml, name) => api.validateRecipe(yaml, name),
  listSuggestions: () => api.listAgentSuggestions(),
  enableSuggestion: (template) => api.enableAgentSuggestion(template),
  dismissSuggestion: (template) => api.dismissAgentSuggestion(template),
  prefills: () => api.agentPrefills(),
  rebuild: (name) => api.rebuildAgentPrefill(name),
  rebuildAll: () => api.rebuildAllPrefills(),
};

// One mock for the whole app, so a rebuild asked for on the Agents screen shows on Home.
let mock: AgentsSource | null = null;

export function mockAgents(): AgentsSource {
  mock ??= createMockAgents();
  return mock;
}

/** For tests: the next `mockAgents()` starts from the samples again. */
export function resetMockAgents(): void {
  mock = null;
}

export function useAgentsSource(): AgentsSource {
  const { isScreenReal } = useServer();
  return isScreenReal('agents') ? POND_AGENTS : mockAgents();
}

/** A Pond built before a route answers 404, 405 or 501: not the same as one that failed to answer. */
export function isMissingRoute(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501);
}
