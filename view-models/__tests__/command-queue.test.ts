/**
 * The waiting-command queue's own rules: the latest tap for a device wins, and a
 * command that has waited too long is not sent.
 */

import { COMMAND_MAX_WAIT_MS, commandKey, enqueue, sortWaiting, type WaitingCommand } from '@/view-models/command-queue';

const command = (deviceId: string, on: boolean, queuedAt = 0): WaitingCommand => ({
  deviceId,
  patch: { power: on },
  key: `${deviceId}-${on}-${queuedAt}`,
  queuedAt,
});

describe('the waiting-command queue', () => {
  it('keeps one command per device, the latest', () => {
    const queue = enqueue(enqueue([command('heater', true)], command('lights', true)), command('heater', false, 5));
    expect(queue.map((c) => [c.deviceId, c.patch.power])).toEqual([
      ['lights', true],
      ['heater', false],
    ]);
  });

  it('sends what is fresh and drops what has waited too long', () => {
    const old = command('heater', true, 0);
    const fresh = command('lights', true, 60_000);
    expect(sortWaiting([old, fresh], COMMAND_MAX_WAIT_MS)).toEqual({ send: [fresh], stale: [old] });
    expect(sortWaiting([old], COMMAND_MAX_WAIT_MS - 1)).toEqual({ send: [old], stale: [] });
  });

  it('gives every tap its own key', () => {
    expect(commandKey()).toMatch(/^[0-9a-f]{32}$/);
    expect(commandKey()).not.toBe(commandKey());
  });
});
