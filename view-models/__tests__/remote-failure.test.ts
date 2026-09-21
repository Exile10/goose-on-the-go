/**
 * What the remote-access screen is allowed to say when setup fails.
 *
 * The screen showed `POST /api/v1/remote-access/enrollment -> 503` verbatim.
 * That string is an `ApiError` message, built to be readable in a log, and it
 * reached a user who can do nothing with a method and a status code.
 *
 * Its own test file, deliberately: `services/__tests__/remote-access.test.ts`
 * replaces the whole api-client module with a stub, so `ApiError` does not
 * exist there and every `instanceof` against it would be answering a question
 * about the mock rather than about the code.
 */

import { ApiError } from '@/services/api-client';
import {
  RemoteInfrastructureUnavailableError,
  RemoteReplacementUnavailableError,
} from '@/services/remote-access';
import { describeRemoteFailure } from '@/view-models/use-remote-access';

it('never shows the raw text of an API error', () => {
  const raw = 'POST /api/v1/remote-access/enrollment → 503';
  const { message } = describeRemoteFailure(new ApiError(raw, 503, null));
  expect(message).not.toBe(raw);
  expect(message).not.toMatch(/\/api\/v1\//);
  expect(message).not.toMatch(/\b503\b/);
});

// A 503 is the Pond saying it cannot reach coordination at all. Offering
// "Recover" for that invites the user to retry something that cannot work.
it('treats a 503 as infrastructure that is not there, and hides recovery', () => {
  expect(describeRemoteFailure(new ApiError('x', 503, null))).toEqual({
    message: expect.stringContaining('not set up'),
    unavailable: true,
  });
});

it('points a refused enrollment at local approval', () => {
  for (const status of [401, 403]) {
    expect(describeRemoteFailure(new ApiError('x', status, null)).message).toMatch(/[Aa]pprove/);
  }
});

// Everything remote-access.ts raises deliberately is already worded for a
// person, so those keep their message rather than being flattened to a generic
// failure that says less than the code already knew.
it('keeps the wording of errors that were written for a reader', () => {
  const own = new RemoteInfrastructureUnavailableError();
  expect(describeRemoteFailure(own)).toEqual({ message: own.message, unavailable: true });
  expect(describeRemoteFailure(new Error('Remote access setup was cancelled.')).message).toBe(
    'Remote access setup was cancelled.',
  );
});

it('falls back rather than rendering whatever it was handed', () => {
  for (const cause of [null, undefined, 'a bare string', 42, new Error('')]) {
    const { message } = describeRemoteFailure(cause);
    expect(typeof message).toBe('string');
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toBe('a bare string');
  }
});

// The failure this phone actually hit: the pond reached the coordinator and was
// told the device is already enrolled. Reporting that as "not set up" told a
// household with working remote access that it had none, and hid Recover -- the
// one control that addresses it.
it('sends an already-enrolled phone to recovery, and leaves the button showing', () => {
  const { message, unavailable } = describeRemoteFailure(new ApiError('x', 409, null));
  expect(unavailable).toBe(false);
  expect(message).toMatch(/already set up/i);
  expect(message).toMatch(/Recover/);
  expect(message).not.toMatch(/not set up/i);
});

// Enrollment's 409 and recovery's 409 mean opposite things. Enrollment says
// "already enrolled, use Recover"; recovery says "the pond still calls this
// enrollment live, so it will not be replaced". Sharing one message between
// them told the user to press the button they had just pressed.
it('does not answer a refused recovery by pointing back at recovery', () => {
  const { message, unavailable } = describeRemoteFailure(new RemoteReplacementUnavailableError());
  expect(message).not.toMatch(/use Recover/i);
  // The button is hidden: pressing it again cannot help.
  expect(unavailable).toBe(true);
});

it('still points a refused enrollment at recovery', () => {
  expect(describeRemoteFailure(new ApiError('x', 409, null)).message).toMatch(/Recover/);
});
