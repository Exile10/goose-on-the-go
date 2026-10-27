/**
 * `contentState`, with the connection read from the provider. See `models/content-state.ts` for
 * the states and why they are chosen in that order.
 */

import { connectionNeedsAttention } from '@/models/connection';
import { contentState, type ContentState, type ContentStateInputs } from '@/models/content-state';
import { useServer } from '@/providers/server-provider';

export function useContentState(inputs: Omit<ContentStateInputs, 'disconnected'>): ContentState {
  const { hydrated, connectionState } = useServer();
  // Before the saved pairing is read back the state is a placeholder, not news.
  return contentState({ ...inputs, disconnected: hydrated && connectionNeedsAttention(connectionState) });
}
