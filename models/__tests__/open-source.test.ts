/**
 * The open-source notices the app shows: complete for what it ships, every component with a
 * licence, and not stale against the installed packages.
 */
import * as fs from 'fs';
import * as path from 'path';

import { componentCount, componentGroups } from '@/models/open-source';

const groups = componentGroups();
const byKind = Object.fromEntries(groups.map((g) => [g.kind, g.components]));

function installed(pkg: string): string {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../node_modules', pkg, 'package.json'), 'utf8')).version;
}

it('lists the app components, Android libraries and built-in libraries it ships', () => {
  expect(byKind.javascript.length).toBeGreaterThan(50);
  expect(byKind.android.length).toBeGreaterThan(50);
  expect(byKind.embedded.length).toBeGreaterThanOrEqual(1);
  expect(componentCount(groups)).toBe(groups.reduce((n, g) => n + g.components.length, 0));
});

it('gives every component a licence, and every app component its licence text', () => {
  for (const c of [...byKind.javascript, ...byKind.android]) expect(c.license).toBeTruthy();
  expect(byKind.javascript.filter((c) => !c.text).map((c) => c.name)).toEqual([]);
});

// Upgrading React Native or Expo without regenerating would leave the notices for older code.
it('matches the installed React Native and Expo: regenerate the notices after an upgrade (docs/LICENSES.md)', () => {
  for (const pkg of ['react-native', 'expo']) {
    const listed = byKind.javascript.find((c) => c.name === pkg);
    expect(listed?.version).toBe(installed(pkg));
  }
});
