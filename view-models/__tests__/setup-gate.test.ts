/**
 * The gate asks the Pond once per pairing. A rate-limited Pond on the LAN is the reason the count is
 * pinned: every tab screen mounting at once must not each ask.
 */

import { api } from '@/services/api-client';
import { checkSetup, markSetupNeeded, resetSetupGate, setupNeededNow } from '@/view-models/use-setup-gate';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { onboardStatus: jest.fn() } };
});
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({}) }));

const pond = jest.mocked(api);
const answer = (onboarded: boolean) => ({ onboarded, current_step: 'Welcome', steps_completed: 1, total_steps: 10 });

beforeEach(() => {
  jest.clearAllMocks();
  resetSetupGate();
});

it('asks once while a question for the same pairing is out', async () => {
  pond.onboardStatus.mockResolvedValue(answer(false));
  const [a, b, c] = await Promise.all([checkSetup('p1'), checkSetup('p1'), checkSetup('p1')]);
  expect([a, b, c]).toEqual(['needed', 'needed', 'needed']);
  expect(pond.onboardStatus).toHaveBeenCalledTimes(1);
});

it('asks again for a different pairing', async () => {
  pond.onboardStatus.mockResolvedValueOnce(answer(false)).mockResolvedValueOnce(answer(true));
  await expect(checkSetup('p1')).resolves.toBe('needed');
  await expect(checkSetup('p2')).resolves.toBe('done');
  expect(pond.onboardStatus).toHaveBeenCalledTimes(2);
});

it('does not decide anything when the Pond cannot be reached', async () => {
  pond.onboardStatus.mockRejectedValue(new Error('offline'));
  await expect(checkSetup('p1')).resolves.toBe('unknown');
  await expect(setupNeededNow()).resolves.toBe(false);
});

it('takes a refusal as needing setup without asking', () => {
  markSetupNeeded('p1');
  markSetupNeeded('p1');
  expect(pond.onboardStatus).not.toHaveBeenCalled();
});
