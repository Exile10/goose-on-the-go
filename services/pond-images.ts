/**
 * Pictures the Pond serves, each loaded once and kept while a list scrolls past it.
 *
 * An event's picture is the same picture whether it is a thumbnail or fills the sheet, and it never
 * changes, so one read serves both. They are kept as the data URIs the image view draws, a few
 * dozen at most, newest use last, and at most three are read at once so a screenful of rows does
 * not become a screenful of requests against the Pond's per-phone budget.
 */

import { api } from './api-client';

/** How many pictures stay in memory. Past this the least recently used is dropped. */
const KEEP = 40;
const AT_ONCE = 3;

const kept = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const waiting: (() => void)[] = [];
let active = 0;

async function takeTurn(): Promise<void> {
  if (active < AT_ONCE) {
    active += 1;
    return;
  }
  // The slot is handed over by `release`, so `active` stays as it was.
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function release(): void {
  const next = waiting.shift();
  if (next) next();
  else active -= 1;
}

const keyOf = (path: string, version: string) => `${path}#${version}`;

/** A picture already in memory, so a row that has been seen draws at once. */
export function peekPondImage(path: string, version = ''): string | null {
  return kept.get(keyOf(path, version)) ?? null;
}

/**
 * The picture at a Pond path, as a data URI. `version` tells two pictures at one path apart, such
 * as events on different Ponds numbered alike: pass something that never repeats, like the time.
 */
export function loadPondImage(path: string, version = ''): Promise<string> {
  const key = keyOf(path, version);
  const hit = kept.get(key);
  if (hit) {
    kept.delete(key);
    kept.set(key, hit);
    return Promise.resolve(hit);
  }
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const job = (async () => {
    await takeTurn();
    try {
      const uri = await api.fetchImage(path);
      kept.set(key, uri);
      for (const oldest of kept.keys()) {
        if (kept.size <= KEEP) break;
        kept.delete(oldest);
      }
      return uri;
    } finally {
      release();
    }
  })();
  pending.set(key, job);
  const settled = () => void pending.delete(key);
  job.then(settled, settled);
  return job;
}

/** Drop every picture held: on sign-out, so a household's cameras are not left in memory. */
export function forgetPondImages(): void {
  kept.clear();
}
