/**
 * The privacy screen may say only what is true, so the parts of it that can go quietly wrong are
 * pinned here.
 *
 * It used to promise AES-256 encryption the Pond does not do, integrations with Uber and Glovo
 * that do not exist, voice biometrics that do not exist, a "voice history" setting that does not
 * exist, and five data rights that were buttons with no handler. The wording is verified against
 * the Pond by review, not by a test; these guard the rest.
 */
import i18n from '@/services/i18n';
import { DATA_RIGHT_KEYS, PRIVACY_DOCUMENTS, PRIVACY_SECTIONS } from '../privacy';

// i18next returns the key itself for a key it does not have, so a typo would render as
// `privacy.storageBody` on the screen and still "work".
it('resolves every key the screen shows to real copy', () => {
  const keys = [
    ...PRIVACY_SECTIONS.flatMap((s) => [s.titleKey, s.bodyKey]),
    ...DATA_RIGHT_KEYS,
    ...PRIVACY_DOCUMENTS.flatMap((d) => [d.titleKey, d.hintKey]),
  ];
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.filter((k) => i18n.t(k) === k)).toEqual([]);
});
