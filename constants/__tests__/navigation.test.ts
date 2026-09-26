/**
 * Every place the app can send someone has to lead to a screen that exists.
 *
 * Removing a placeholder screen is most of the fix for #64 and #65, and removal fails in one
 * particular way: the file goes and a menu row keeps pointing at it. Nothing about that fails a
 * build. expo-router resolves routes at runtime, so `tsc` passes, the menu renders, and the row
 * leads to an unmatched-route screen the first time someone taps it.
 *
 * Checked in both directions for the stack, because the layout can drift from the files either
 * way: a registered screen whose file is gone, and a file nothing registers.
 */
import * as fs from 'fs';
import * as path from 'path';

import { PROFILE_NAV } from '@/constants/navigation';

const APP = path.resolve(__dirname, '../../app');
const STACK = path.join(APP, '(stack)');

/** The screen file a `/(group)/name` route resolves to, if there is one. */
function screenFor(route: string): string | null {
  const rel = route.replace(/^\//, '');
  for (const candidate of [`${rel}.tsx`, path.join(rel, 'index.tsx')]) {
    const full = path.join(APP, candidate);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

/** The names `app/(stack)/_layout.tsx` registers with `<Stack.Screen name="..." />`. */
function registeredStackScreens(): string[] {
  const layout = fs.readFileSync(path.join(STACK, '_layout.tsx'), 'utf8');
  return [...layout.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((m) => m[1]);
}

/** Screen files under `app/(stack)`, by route name. */
function stackScreenFiles(): string[] {
  return fs
    .readdirSync(STACK)
    .filter((f) => f.endsWith('.tsx') && !f.startsWith('_'))
    .map((f) => f.replace(/\.tsx$/, ''));
}

it('sends every profile menu row to a screen that exists', () => {
  const rows = PROFILE_NAV.flatMap((group) => group.items);
  // A guard that reads nothing passes by matching nothing.
  expect(rows.length).toBeGreaterThan(0);

  const dangling = rows.filter((row) => !screenFor(row.route)).map((row) => `${row.id} -> ${row.route}`);
  expect(dangling).toEqual([]);
});

it('registers only stack screens whose files exist', () => {
  const files = new Set(stackScreenFiles());
  const registered = registeredStackScreens();
  expect(registered.length).toBeGreaterThan(0);

  expect(registered.filter((name) => !files.has(name))).toEqual([]);
});

/**
 * Not an expo-router requirement -- it routes to any file in the group whether or not the layout
 * names it. It is this app's: the stack sets `headerShown: true` for every screen, and a screen
 * the layout does not register gets its route name as its header. That is how Remote Access went
 * out headed `remote-access`, lowercase and untranslated, above its own real title.
 */
it('registers every stack screen file it ships', () => {
  const registered = new Set(registeredStackScreens());

  expect(stackScreenFiles().filter((name) => !registered.has(name))).toEqual([]);
});
