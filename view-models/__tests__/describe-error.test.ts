/**
 * Who gets to say that the Pond has stopped accepting this phone.
 *
 * The answer is: the connection banner, once. A screen that repeats it prints
 * the same fact twice, one line apart, which is what the devices screen did.
 */

import { ApiError } from '@/services/api-client';
import { describeApiError } from '@/view-models/describe-error';

it('says nothing about a refusal the banner is already showing', () => {
  // A 401 or 403 that reaches a screen has already survived the client's one
  // refresh attempt, which puts the banner into its revoked state. There is
  // nothing left for the screen to add.
  expect(describeApiError(new ApiError('x', 401, null))).toBeNull();
  expect(describeApiError(new ApiError('x', 403, null))).toBeNull();
});

it('still speaks for everything the banner does not cover', () => {
  expect(describeApiError(new ApiError('x', 500, null))).toBeTruthy();
  expect(describeApiError(new ApiError('x', 429, 30))).toMatch(/busy/i);
  expect(describeApiError(new Error('offline'))).toMatch(/[Cc]ould not reach/);
});

it('never puts a status code in front of a reader', () => {
  for (const status of [400, 404, 418, 429, 500, 503]) {
    const said = describeApiError(new ApiError(`GET /api/v1/devices → ${status}`, status, null));
    expect(said).not.toMatch(/\d{3}/);
    expect(said).not.toMatch(/\/api\//);
  }
});
