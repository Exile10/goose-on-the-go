// Every My Goose hub route goes through here, so the Developer toggle can swap in the mock Pond and a
// test can swap the client. A route the Pond ships later needs only its method in `api-client.ts`.

import { createMockHub, type HubSource } from '@/models/my-goose-mock';
import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';

export type { HubSource } from '@/models/my-goose-mock';

/** Calls `api` at call time, so a test's mock of the client is the one used. */
export const POND_HUB: HubSource = {
  hub: () => api.meHub(),
  interests: () => api.interests(),
  addInterest: (body) => api.addInterest(body),
  editInterest: (id, body) => api.editInterest(id, body),
  deleteInterest: (id) => api.deleteInterest(id),
  interview: () => api.interestInterview(),
  startInterview: () => api.startInterestInterview(),
  answerInterview: (answer) => api.answerInterestInterview(answer),
  finishInterview: () => api.finishInterestInterview(),
  approveInterview: (body) => api.approveInterestInterview(body),
  portrait: () => api.portrait(),
  newsSettings: () => api.newsSettings(),
  saveNewsSettings: (change) => api.saveNewsSettings(change),
  news: () => api.news(),
  newsFor: (interestId) => api.newsFor(interestId),
  markStoryRead: (id) => api.markStoryRead(id),
  newsHistory: () => api.newsHistory(),
  storyFeedback: (id, vote, note) => api.storyFeedback(id, vote, note),
  story: (id) => api.story(id),
  digests: () => api.digests(),
  digest: (id) => api.digest(id),
  digestAudio: (path, signal) => api.digestAudio(path, signal),
  speakDigest: (id) => api.speakDigest(id),
  refreshNews: () => api.refreshNews(),
  todos: (state) => api.todos(state),
  addTodo: (body) => api.addTodo(body),
  editTodo: (id, body) => api.editTodo(id, body),
  deleteTodo: (id) => api.deleteTodo(id),
  answerTodo: (id, answer, snooze) => api.answerTodo(id, answer, snooze),
  todoOffers: () => api.todoOffers(),
  acceptTodoOffer: (id, dueAt) => api.acceptTodoOffer(id, dueAt),
  declineTodoOffer: (id) => api.declineTodoOffer(id),
  hookSources: () => api.hookSources(),
  addPlace: (body) => api.addPlace(body),
  deletePlace: (id) => api.deletePlace(id),
  cart: () => api.cart(),
  addToCart: (body) => api.addToCart(body),
  cartItem: (id) => api.cartItem(id),
  editCartItem: (id, body) => api.editCartItem(id, body),
  deleteCartItem: (id) => api.deleteCartItem(id),
  checkCartItem: (id) => api.checkCartItem(id),
  connectors: () => api.connectors(),
  connectConnector: (id, fields) => api.connectConnector(id, fields),
  disconnectConnector: (id) => api.disconnectConnector(id),
  makeWebhook: (name) => api.makeWebhook(name),
  ideas: () => api.ideas(),
  ideaGoose: (id) => api.ideaGoose(id),
  ideaMine: (id) => api.ideaMine(id),
  dismissIdea: (id) => api.dismissIdea(id),
  refreshIdeas: () => api.refreshIdeas(),
  catalog: () => api.catalog(),
};

// One mock for the whole app, so a to-do added on one screen shows on My Goose.
let mock: HubSource | null = null;

export function mockHub(): HubSource {
  mock ??= createMockHub();
  return mock;
}

/** For tests: the next `mockHub()` starts from the samples again. */
export function resetMockHub(): void {
  mock = null;
}

export function useHubSource(): HubSource {
  const { isScreenReal } = useServer();
  return isScreenReal('myGoose') ? POND_HUB : mockHub();
}
