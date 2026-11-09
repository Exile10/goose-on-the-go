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
import { DATA_RIGHTS, PRIVACY_DOCUMENTS, PRIVACY_GROUPS } from '../privacy';

// i18next returns the key itself for a key it does not have, so a typo would render as
// `privacy.storageBody` on the screen and still "work".
it('resolves every key the screen shows to real copy', () => {
  const keys = [
    ...PRIVACY_GROUPS.flatMap((g) => [g.headingKey, ...g.sections.flatMap((s) => [s.titleKey, s.bodyKey])]),
    ...DATA_RIGHTS.map((r) => r.key),
    ...PRIVACY_DOCUMENTS.flatMap((d) => [d.titleKey, d.hintKey]),
  ];
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.filter((k) => i18n.t(k) === k)).toEqual([]);
});

// The screen is read by people who were told "sign out" in one place and "Unpair" on the button.
it('calls releasing this phone unpairing, as the button does', () => {
  const copy = [
    ...PRIVACY_GROUPS.flatMap((g) => g.sections.map((s) => i18n.t(s.bodyKey))),
    ...DATA_RIGHTS.map((r) => i18n.t(r.key)),
    i18n.t('legal.privacyPolicy'),
    i18n.t('legal.terms'),
  ];
  expect(copy.filter((text) => /sign(ing|s)? out/i.test(text))).toEqual([]);
});

it('gives every section an id of its own', () => {
  const ids = PRIVACY_GROUPS.flatMap((g) => g.sections.map((s) => s.id));
  expect(new Set(ids).size).toBe(ids.length);
});
