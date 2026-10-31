/**
 * Which of the five states a screen is in. The user-visible defect this pins: with the Pond
 * unreachable the conversation wall said it could not load, said it needed the Pond, and said
 * "Nothing here yet" -- and the devices tab said "No devices yet" -- under a banner that had
 * already said the Pond was unavailable. Each case below is one of those readings, decided once.
 */

import { contentState, isUnavailable, type ContentStateInputs } from '../content-state';

const base: ContentStateInputs = { loading: false, failed: false, hasContent: false, disconnected: false };
const state = (over: Partial<ContentStateInputs>) => contentState({ ...base, ...over });

describe('contentState', () => {
  it('is ready whenever there is something to show, whatever else is true', () => {
    expect(state({ hasContent: true })).toBe('ready');
    // A refresh that failed keeps the list; the view-model logs it.
    expect(state({ hasContent: true, failed: true })).toBe('ready');
    // The banner says the Pond is gone; the last list is still worth reading.
    expect(state({ hasContent: true, disconnected: true, failed: true })).toBe('ready');
    expect(state({ hasContent: true, loading: true })).toBe('ready');
  });

  it('is loading while a first read is in flight, even with the connection down', () => {
    // A cold start brings the connection up while the first read waits on it. Claiming the Pond
    // is gone during that is reporting a race.
    expect(state({ loading: true })).toBe('loading');
    expect(state({ loading: true, disconnected: true })).toBe('loading');
  });

  it('is unreachable, not failed and not empty, when the connection is down and nothing arrived', () => {
    expect(state({ disconnected: true, failed: true })).toBe('unreachable');
    // A view-model that skipped its read because there was nothing to read from has no failure on
    // record, and "nothing here yet" would still be a claim nobody made.
    expect(state({ disconnected: true })).toBe('unreachable');
  });

  it('is failed when the connection is fine and the read failed anyway', () => {
    expect(state({ failed: true })).toBe('failed');
  });

  it('is empty only after a read that worked and found nothing', () => {
    expect(state({})).toBe('empty');
  });

  it('names the two states the shared view draws', () => {
    expect(isUnavailable('unreachable')).toBe(true);
    expect(isUnavailable('failed')).toBe(true);
    for (const own of ['loading', 'empty', 'ready'] as const) expect(isUnavailable(own)).toBe(false);
  });
});
