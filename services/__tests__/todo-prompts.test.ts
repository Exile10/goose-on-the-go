/**
 * Goose's questions answered from the notification: the right button sends the right answer, once,
 * a malformed payload sends nothing, and a failed send can be tried again.
 */

import { answerFrom, categoryFor, handleTodoResponse, promptData, resetAnsweredPrompts, sendAnswer, TODO_ACTIONS, type TodoPromptClient } from '@/services/todo-prompts';
import { openRouteFromData, screenPath, todoPromptFromData } from '@/services/notification-link';

const checkin = { action: 'todo_checkin', todo_id: 't-1', text: 'Send the slides' };
const offer = { action: 'todo_offer', reminder_id: 'r-1', text: 'Call the garage', when_said: 'on Friday' };

function client(): TodoPromptClient & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    answerTodo: jest.fn(async (...args: unknown[]) => void calls.push(['answer', ...args])),
    acceptTodoOffer: jest.fn(async (...args: unknown[]) => void calls.push(['accept', ...args])),
    declineTodoOffer: jest.fn(async (...args: unknown[]) => void calls.push(['decline', ...args])),
  };
}

const response = (actionIdentifier: string, data: unknown, identifier = 'n-1') => ({ actionIdentifier, notification: { request: { identifier, content: { data } } } });

beforeEach(() => resetAnsweredPrompts());

describe('what a notification carries', () => {
  it('shows a check-in and an offer with their own buttons, and keeps their fields', () => {
    expect(categoryFor(checkin)).toBe('todo_checkin');
    expect(categoryFor(offer)).toBe('todo_offer');
    expect(categoryFor({ action: 'open_url' })).toBeNull();
    expect(promptData(offer)).toEqual({ action: 'todo_offer', reminder_id: 'r-1', text: 'Call the garage', when_said: 'on Friday' });
  });

  it('refuses an id that could be a path', () => {
    expect(todoPromptFromData({ ...checkin, todo_id: '../admin' })).toBeNull();
  });

  it('opens the to-dos, the news or a story, and the cart or one link', () => {
    expect(screenPath(openRouteFromData({ open: 'todos' })!)).toBe('/(stack)/goose-todos');
    expect(screenPath(openRouteFromData({ open: 'news', story_id: 's-1' })!)).toEqual({ pathname: '/(stack)/goose-story', params: { id: 's-1' } });
    expect(screenPath(openRouteFromData({ open: 'cart', cart_id: 'c-1' })!)).toEqual({ pathname: '/(stack)/goose-cart-item', params: { id: 'c-1' } });
    expect(screenPath(openRouteFromData({ open: 'cart', cart_id: 'a/b' })!)).toBe('/(stack)/goose-cart');
  });
});

describe('answering', () => {
  it('sends Done and Not yet to the to-do, Not yet with a snooze', async () => {
    const c = client();
    await sendAnswer('n-1', answerFrom(TODO_ACTIONS.done, checkin)!, c);
    await sendAnswer('n-2', answerFrom(TODO_ACTIONS.notYet, checkin)!, c);
    expect(c.calls).toEqual([
      ['answer', 't-1', 'done', undefined],
      ['answer', 't-1', 'not_yet', 120],
    ]);
  });

  it('sends Add and No to the offer', async () => {
    const c = client();
    await sendAnswer('n-1', answerFrom(TODO_ACTIONS.add, offer)!, c);
    await sendAnswer('n-2', answerFrom(TODO_ACTIONS.no, offer)!, c);
    expect(c.calls).toEqual([
      ['accept', 'r-1'],
      ['decline', 'r-1'],
    ]);
  });

  it('answers a press delivered twice only once, and dismisses the question', async () => {
    const c = client();
    const dismiss = jest.fn(async () => undefined);
    await handleTodoResponse(response(TODO_ACTIONS.done, checkin), c, { dismissNotificationAsync: dismiss });
    await handleTodoResponse(response(TODO_ACTIONS.done, checkin), c, { dismissNotificationAsync: dismiss });
    expect(c.calls).toHaveLength(1);
    expect(dismiss).toHaveBeenCalledWith('n-1');
  });

  it('ignores a button that does not fit the question, a tap, and a malformed payload', async () => {
    const c = client();
    expect(answerFrom(TODO_ACTIONS.add, checkin)).toBeNull();
    expect(answerFrom('expo.modules.notifications.actions.DEFAULT', checkin)).toBeNull();
    expect(await handleTodoResponse({ actionIdentifier: TODO_ACTIONS.done } as never, c, null)).toBe(false);
    expect(c.calls).toEqual([]);
  });

  it('lets a failed answer be sent again', async () => {
    const c = client();
    (c.answerTodo as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    expect(await sendAnswer('n-1', answerFrom(TODO_ACTIONS.done, checkin)!, c)).toBe(false);
    expect(await sendAnswer('n-1', answerFrom(TODO_ACTIONS.done, checkin)!, c)).toBe(true);
  });
});
