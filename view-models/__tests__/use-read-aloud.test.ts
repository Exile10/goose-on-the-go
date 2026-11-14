// Reading a reply aloud: its parts in order, each asked for while the one before plays, one reply at
// a time, stopped on a second press, and every part's file dropped once it is done with.

import { api } from '@/services/api-client';
import { showSnackbar } from '@/services/snackbar';
import { cacheFile, discardFile, playFile } from '@/services/voice-io';

import { toggleReadAloud } from '../use-read-aloud';

jest.mock('@/services/api-client', () => ({ api: { speak: jest.fn() } }));
jest.mock('@/services/snackbar', () => ({ showSnackbar: jest.fn() }));
jest.mock('@/services/voice-io', () => ({ cacheFile: jest.fn(), discardFile: jest.fn(), playFile: jest.fn() }));

const speak = jest.mocked(api.speak);
const play = jest.mocked(playFile);

// Two sentences, each past half of what the Pond's voice says in one pass, so they are two parts.
const FIRST = `${'The first part is a long sentence about the hills near the plaza and the wineries close by'.repeat(1)}, read slowly.`;
const SECOND = 'The second part tells the reader what to bring, which is a layer, since the weather check did not finish in time.';
const REPLY = `${FIRST} ${SECOND}`;

/** Lets every promise already settled run its continuations. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let finishPlaying: (() => void)[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  finishPlaying = [];
  speak.mockImplementation(async (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer);
  jest.mocked(cacheFile).mockImplementation((_prefix, bytes) => `file://${new TextDecoder().decode(bytes).slice(0, 10)}`);
  play.mockImplementation(() => {
    let end!: () => void;
    const done = new Promise<void>((resolve) => (end = resolve));
    finishPlaying.push(end);
    return { done, stop: () => end() };
  });
});

it('plays the parts in order, asking for the next while one plays', async () => {
  toggleReadAloud('a', REPLY);
  await flush();
  expect(play).toHaveBeenCalledTimes(1);
  expect(speak).toHaveBeenCalledTimes(2);
  expect(speak.mock.calls[0][2]).toBe(false);
  expect(speak.mock.calls[1][2]).toBe(true);

  finishPlaying[0]();
  await flush();
  expect(play).toHaveBeenCalledTimes(2);
  finishPlaying[1]();
  await flush();
  expect(discardFile).toHaveBeenCalledTimes(2);
});

it('stops on a second press, and starting another reply stops the first', async () => {
  toggleReadAloud('a', REPLY);
  await flush();
  toggleReadAloud('a', REPLY);
  await flush();
  expect(play).toHaveBeenCalledTimes(1);

  toggleReadAloud('a', REPLY);
  await flush();
  toggleReadAloud('b', 'Something else to say.');
  await flush();
  expect(play).toHaveBeenCalledTimes(3);
  expect(speak.mock.calls.at(-1)?.[0]).toBe('Something else to say.');
  finishPlaying.forEach((end) => end());
  await flush();
});

it('says so when the Pond cannot read it, and not when it was stopped', async () => {
  speak.mockRejectedValueOnce(new Error('503'));
  toggleReadAloud('c', 'Short.');
  await flush();
  expect(showSnackbar).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }));
  expect(play).not.toHaveBeenCalled();
});
