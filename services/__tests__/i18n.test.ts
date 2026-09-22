/**
 * Guards the catalogue against the one failure it cannot survive: a key the app asks for
 * that does not exist.
 *
 * i18next answers a missing key with the key itself, so the failure is silent and ships as
 * copy -- a user sees "pairing.codeTitle" where a sentence should be. Nothing caught that.
 * The two i18n assertions in remote-access.test.ts resolve both sides through this same
 * catalogue, so they pin the key and pass whatever the copy says, including when it says
 * nothing at all.
 *
 * This reads the call sites out of the source rather than listing keys by hand, because a
 * hand-written list is a second thing to keep in step and would rot in the same way.
 */
import fs from 'fs';
import path from 'path';

import i18n from '../i18n';

const ROOT = path.resolve(__dirname, '..', '..');
const SEARCHED = ['app', 'components', 'view-models', 'providers', 'services', 'models'];

/** `i18n.t('a.b')` and `t('a.b')`. Requires a dot, so `t('x')` in unrelated code is ignored. */
const CALL = /\bt\(\s*'([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)'/g;

function sources(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function referencedKeys(): Map<string, string> {
  const found = new Map<string, string>();
  for (const dir of SEARCHED) {
    for (const file of sources(path.join(ROOT, dir))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(CALL)) {
        if (!found.has(match[1])) found.set(match[1], path.relative(ROOT, file));
      }
    }
  }
  return found;
}

it('resolves every key the app actually asks for', () => {
  const keys = referencedKeys();
  // If this trips, the scan stopped finding call sites and the rest of the test is vacuous.
  expect(keys.size).toBeGreaterThan(20);

  const missing = [...keys].filter(([key]) => i18n.t(key) === key).map(([key, file]) => `${key} (${file})`);
  expect(missing).toEqual([]);
});

// The check above reads keys out of the source, so it can only see the ones
// written there. A key assembled at runtime is invisible to it, and the failure
// it hides is the same one: the raw key rendered where a sentence should be.
// Banning the construct is what keeps the check above meaningful.
it('refuses keys assembled at runtime, which the check above cannot see', () => {
  const offenders: string[] = [];
  for (const dir of SEARCHED) {
    for (const file of sources(path.join(ROOT, dir))) {
      if (/\bt\(\s*`/.test(fs.readFileSync(file, 'utf8'))) offenders.push(path.relative(ROOT, file));
    }
  }
  expect(offenders).toEqual([]);
});

it('returns the key itself for a key that does not exist, which is why the test above exists', () => {
  expect(i18n.t('pairing.notAKeyAnybodyDefined')).toBe('pairing.notAKeyAnybodyDefined');
});
