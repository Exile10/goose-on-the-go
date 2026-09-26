/**
 * A resumable turn keeps generating on the Pond after the phone lets go of it,
 * so stopping one has to cancel it there. The server names the run in its first
 * frame; a stop that lands before that frame used to cancel nothing and forget
 * the run, leaving it running with nothing that knew about it.
 */
type Handlers = { onFrame: (frame: unknown) => void; onNetworkError?: (message: string) => void };

const streams: { handlers: Handlers; close: jest.Mock }[] = [];

jest.mock('@/services/api-client', () => ({
  ApiError: class extends Error {},
  api: {
    streamChat: jest.fn((_req: unknown, handlers: Handlers) => {
      const stream = { handlers, close: jest.fn() };
      streams.push(stream);
      return { close: stream.close };
    }),
    cancelRun: jest.fn(async () => undefined),
    listSessionMessages: jest.fn(async () => []),
  },
}));
jest.mock('@/services/storage', () => ({
  Storage: { setJSON: jest.fn(async () => undefined), remove: jest.fn(async () => undefined), getJSON: jest.fn(async () => null) },
}));

import { api } from '@/services/api-client';
import { abortRun, newConversation, send } from '@/view-models/chat-run-store';

beforeEach(() => {
  newConversation();
  streams.length = 0;
  jest.mocked(api.cancelRun).mockClear();
});

it('cancels a run that starts after the user stopped it', () => {
  send('hello');
  const [stream] = streams;
  abortRun();
  expect(api.cancelRun).not.toHaveBeenCalled();
  expect(stream.close).not.toHaveBeenCalled();

  stream.handlers.onFrame({ type: 'run_started', run_id: 'run-1', epoch: 'e1', session_id: 's1' });

  expect(api.cancelRun).toHaveBeenCalledWith('run-1');
  expect(stream.close).toHaveBeenCalledTimes(1);
});

it('cancels a started run straight away and closes its stream', () => {
  send('hello');
  const [stream] = streams;
  stream.handlers.onFrame({ type: 'run_started', run_id: 'run-2', epoch: 'e1', session_id: 's1' });
  abortRun();
  expect(api.cancelRun).toHaveBeenCalledWith('run-2');
  expect(stream.close).toHaveBeenCalledTimes(1);
});

it('stops waiting when an unstarted, stopped stream fails', () => {
  send('hello');
  const [stream] = streams;
  abortRun();
  stream.handlers.onNetworkError?.('gone');
  expect(stream.close).toHaveBeenCalledTimes(1);
  expect(api.cancelRun).not.toHaveBeenCalled();
});
