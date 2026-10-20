/**
 * What the app does when the Pond's push wake-up arrives.
 *
 * The Pond sends FCM a data-only message at high priority carrying
 * `{ notification_id, category, wake: "1" }` and nothing a person could read:
 * the text never transits Google or Apple. The phone wakes, reaches the Pond
 * over its own pinned channel, fetches what is pending, shows it, and
 * acknowledges it. Android may run this headless, with the app closed, and gives
 * it seconds rather than minutes, so the whole pass is bounded and it never
 * throws -- a background task that throws is retried by nobody.
 *
 * Kept free of expo-task-manager so it can be tested; the task itself is
 * registered in `services/background-notifications.ts`.
 */

import { drainPending, type DeliveryClient, type DrainResult } from './notification-delivery';

/** Longer than a pass needs on a reachable Pond; well inside what Android allows a high-priority message. */
export const WAKE_BUDGET_MS = 20_000;

export interface WakeDependencies {
  /** Restore the pairing onto the client when the app is not running. False when there is none. */
  ensureSession: () => Promise<boolean>;
  client: DeliveryClient;
  budgetMs?: number;
}

export type WakeOutcome = 'ignored' | 'unpaired' | 'delivered' | 'failed';

/**
 * The FCM data fields, wherever this platform's payload put them.
 *
 * Android hands the message's data map over as `data` (each value a string).
 * iOS puts custom keys at the top of the payload beside `aps`. expo-notifications
 * also carries a `dataString` copy of a `body` field; it is read when present.
 */
export function wakeFields(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const top = payload as Record<string, unknown>;
  const data = top.data && typeof top.data === 'object' ? (top.data as Record<string, unknown>) : {};
  let parsed: Record<string, unknown> = {};
  if (typeof data.dataString === 'string') {
    try {
      const value: unknown = JSON.parse(data.dataString);
      if (value && typeof value === 'object') parsed = value as Record<string, unknown>;
    } catch {
      // Not JSON: the plain fields beside it still count.
    }
  }
  return { ...top, ...parsed, ...data };
}

/** Whether this payload is the Pond asking the phone to come and fetch. */
export function isWake(payload: unknown): boolean {
  return wakeFields(payload).wake === '1';
}

function withinBudget<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`wake pass exceeded ${ms} ms`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => { if (timer) clearTimeout(timer); });
}

/** Handle one background notification payload. Resolves with what happened; never rejects. */
export async function handleWake(payload: unknown, deps: WakeDependencies): Promise<WakeOutcome> {
  if (!isWake(payload)) return 'ignored';
  const started = Date.now();
  const id = wakeFields(payload).notification_id;
  console.info('[wake] received', { kind: 'notification_wake', id });
  try {
    const result = await withinBudget((async (): Promise<DrainResult | null> => {
      if (!(await deps.ensureSession())) return null;
      return drainPending(deps.client, 'wake');
    })(), deps.budgetMs ?? WAKE_BUDGET_MS);
    if (!result) {
      console.warn('[wake] no Pond session; nothing fetched', { kind: 'notification_wake', id });
      return 'unpaired';
    }
    console.info('[wake] done', { kind: 'notification_wake', id, ms: Date.now() - started, ...result });
    return 'delivered';
  } catch (e) {
    console.warn('[wake] failed', { kind: 'notification_wake', id, ms: Date.now() - started, error: String(e) });
    return 'failed';
  }
}
