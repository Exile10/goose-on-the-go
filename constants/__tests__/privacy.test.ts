/**
 * The privacy screen may say only what is true, so the parts of it that can go quietly wrong are
 * pinned here.
 *
 * It used to promise AES-256 encryption the Pond does not do, integrations with Uber and Glovo
 * that do not exist, voice biometrics that do not exist, a "voice history" setting that does not
 * exist, and five data rights that were buttons with no handler. The wording is verified against
 * the Pond by review, not by a test; these guard the rest.
 */
import * as fs from 'fs';
import * as path from 'path';

import appPackage from '../../package.json';
import i18n from '@/services/i18n';
import { APP_LICENSES, DATA_RIGHT_KEYS, PRIVACY_SECTIONS } from '../privacy';

// i18next returns the key itself for a key it does not have, so a typo would render as
// `privacy.storageBody` on the screen and still "work".
it('resolves every key the screen shows to real copy', () => {
  const keys = [...PRIVACY_SECTIONS.flatMap((s) => [s.titleKey, s.bodyKey]), ...DATA_RIGHT_KEYS];
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.filter((k) => i18n.t(k) === k)).toEqual([]);
});

// "Piper TTS, MIT" sat in this list after Piper was gone. A list checked against the installed
// packages cannot drift like that.
it('lists only what this app ships, with the licence each package declares', () => {
  const shipped = { ...appPackage.dependencies } as Record<string, string>;
  for (const entry of APP_LICENSES) {
    expect(shipped[entry.pkg]).toBeDefined();
    const manifest = path.resolve(__dirname, '../../node_modules', entry.pkg, 'package.json');
    expect(JSON.parse(fs.readFileSync(manifest, 'utf8')).license).toBe(entry.license);
  }
});
