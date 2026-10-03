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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { registerIcons, registeredIconNames } from '@jarida/ink';
import { sweepIconNames } from '@jarida/ink/sweep';

/**
 * The names are read out of constants/icons.ts as text rather than imported.
 *
 * This script used to `import { IconPaths }`, which broke twice in one commit:
 * the conversation-wall rebuild (55dccf9) renamed that export to `ICONS`, and
 * gave the module an import of `lucide-react-native`. The rename alone was a
 * one-word fix; the second change is not, because pulling that package in drags
 * react-native's index.js with it, and that is Flow-typed --
 * `import typeof * as ReactNativePublicAPI` -- which plain Node cannot parse at
 * any --experimental-strip-types setting.
 *
 * So the gate has thrown at import since that commit, and an icon typo has gone
 * uncaught the whole time. Reading the keys keeps this file as the single source
 * of truth, which was the point of importing it, without executing a module
 * that now belongs to the app's runtime rather than to a script's.
 */
function iconNamesFromSource() {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '..', 'constants', 'icons.ts'), 'utf8');

  const start = src.indexOf('export const ICONS = {');
  if (start === -1) {
    throw new Error('constants/icons.ts: no `export const ICONS = {` — has it been renamed again?');
  }
  const body = src.slice(start);
  const end = body.indexOf('\n};');
  if (end === -1) {
    throw new Error('constants/icons.ts: ICONS has no closing `};` on its own line.');
  }

  // Both key styles: bare identifiers (`chat: MessageCircle`) and quoted keys,
  // which is how any name containing a hyphen has to be written
  // (`'list-filter': ListFilter`). Matching only the first kind silently drops
  // every hyphenated icon and then reports its uses as unregistered -- a check
  // that invents failures is worse than one that is switched off.
  const names = [...body.slice(0, end).matchAll(/^\s{2}(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/gm)]
    .map((m) => m[1] ?? m[2] ?? m[3]);
  if (names.length === 0) {
    throw new Error('constants/icons.ts: ICONS parsed to zero names, which cannot be right.');
  }
  return names;
}

registerIcons(Object.fromEntries(iconNamesFromSource().map((name) => [name, []])));

/*
 * The app's own source, rather than '.'.
 *
 * The sweep already skips node_modules and dist, but not ios/ and android/ --
 * both gitignored, both present on any machine that has run `expo prebuild`,
 * and ios/Pods carries symlinked CocoaPods headers that make the walk throw
 * ENOENT. CI never had them, so this was a gate that worked in CI and could not
 * be run by the person whose branch it was about to fail.
 *
 * Naming the roots also means a new top-level source directory has to be added
 * here deliberately, which is the failure worth having: an unswept directory
 * that nobody notices is exactly what this check exists to prevent.
 */
const ROOTS = ['app', 'components', 'hooks', 'providers', 'view-models', 'services', 'constants', 'models'];

const known = registeredIconNames();
const misses = ROOTS.flatMap((root) => sweepIconNames(root, known));

if (misses.length) {
  for (const m of misses) {
    console.error(`${m.file}:${m.line}  ${m.detail}`);
  }
  console.error(`\n${misses.length} unregistered icon name(s) found.`);
  process.exit(1);
}

console.log(`sweep-icons: ${known.length} names registered, ${ROOTS.length} source roots swept, no unresolved icon names found.`);
