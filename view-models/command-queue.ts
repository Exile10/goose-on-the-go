/**
 * Device commands tapped while the Pond could not be reached, waiting to be sent when it can.
 *
 * Only a Pond that honours idempotency keys gets a queue. Each tap carries one key on every
 * attempt, so a command that did reach the Pond before the link dropped is not run a second
 * time when it is sent again. A Pond without keys gets no queue at all: a failed command is
 * reported, as before, because sending it again could run it twice.
 *
 * A command waits for at most `COMMAND_MAX_WAIT_MS`. After that it is dropped and the person
 * is told, rather than sent: the kettle someone asked for at 6:30 is not wanted at noon. That
 * is the same rule as a routine missed while the Pond was off.
 *
 * Pure, so the rules can be tested without a screen.
 */

import { bytesToHex } from '@noble/hashes/utils.js';

import { randomBytes } from '@/services/secure-random';
import type { DeviceStatePatch } from '@/services/types';

export const COMMAND_MAX_WAIT_MS = 10 * 60_000;

export interface WaitingCommand {
  deviceId: string;
  patch: DeviceStatePatch;
  /** Sent with every attempt at this tap. */
  key: string;
  queuedAt: number;
}

/** A fresh key for one tap. */
export function commandKey(): string {
  return bytesToHex(randomBytes(16));
}

/** Add a command, replacing any still waiting for the same device: the latest tap is what was meant. */
export function enqueue(queue: WaitingCommand[], command: WaitingCommand): WaitingCommand[] {
  return [...queue.filter((c) => c.deviceId !== command.deviceId), command];
}

/** Those still worth sending, and those that have waited too long to send without asking. */
export function sortWaiting(queue: WaitingCommand[], now: number): { send: WaitingCommand[]; stale: WaitingCommand[] } {
  const stale = queue.filter((c) => now - c.queuedAt >= COMMAND_MAX_WAIT_MS);
  return { send: queue.filter((c) => !stale.includes(c)), stale };
}
