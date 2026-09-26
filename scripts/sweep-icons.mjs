#!/usr/bin/env node
/**
 * CI gate for icon-name typos (issue #19).
 *
 * `InkIconName` stays an open string type on purpose (see constants/icon-
 * registry.ts and @jarida/ink's own docs), so a misspelled `name="serach"`
 * is not a type error — `sweepIconNames` is what catches it, by reading the
 * source for icon-name literals and checking them against the registered set.
 *
 * Registers the same names constants/icon-registry.ts does (geometry isn't
 * needed here, only the keys), then scans the repo.
 *
 * Usage: node scripts/sweep-icons.mjs
 */
import { registerIcons, registeredIconNames } from '@jarida/ink';
import { sweepIconNames } from '@jarida/ink/sweep';

import { IconPaths } from '../constants/icons.ts';

registerIcons(Object.fromEntries(Object.keys(IconPaths).map((name) => [name, []])));

const misses = sweepIconNames('.', registeredIconNames());

if (misses.length) {
  for (const m of misses) {
    console.error(`${m.file}:${m.line}  ${m.detail}`);
  }
  console.error(`\n${misses.length} unregistered icon name(s) found.`);
  process.exit(1);
}

console.log(`sweep-icons: ${registeredIconNames().length} names registered, no unresolved icon names found.`);
