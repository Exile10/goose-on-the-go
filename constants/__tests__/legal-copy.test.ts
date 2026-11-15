/**
 * The privacy policy and terms the app shows are the reviewed documents, word for word: the app's
 * copy (`legal.*` in en.json) is checked against `docs/PRIVACY.md` and `docs/TERMS.md`.
 */

import en from '@/services/i18n/locales/en.json';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { expected } = require('../../scripts/legal-copy.cjs') as { expected: () => Record<string, string> };

it('shows the reviewed documents word for word; run node scripts/legal-copy.cjs after editing them', () => {
  expect(en.legal).toEqual(expected());
});

it('starts each document with the date it was last updated', () => {
  for (const text of Object.values(en.legal)) expect(text.startsWith('Last updated:')).toBe(true);
});
