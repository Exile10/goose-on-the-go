// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const i18next = require('eslint-plugin-i18next');

/**
 * Screens and components whose copy is covered by `services/i18n.ts`.
 *
 * i18n here is scoped on purpose — see docs/I18N.md. It covers connection, pairing,
 * remote access, trust, and the errors a user meets when something is wrong; it does not
 * cover the rest of the app. This list is the enforced half of that decision, so a bare
 * string added to one of these files fails the build rather than relying on somebody
 * remembering the convention.
 *
 * Files that mix covered and uncovered copy are deliberately absent, because enforcing on
 * them would drag unrelated copy into the rule by accident. docs/I18N.md names them.
 */
const TRANSLATED_SURFACE = [
  '**/pond-pairing.tsx',
  '**/remote-access.tsx',
  '**/connect-desktop.tsx',
  'components/patterns/connection-status.tsx',
  'components/patterns/remote-access-offer.tsx',
];

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    files: TRANSLATED_SURFACE,
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': ['error', {
        // `jsx-text-only` would miss the literal in `{matter ? t('…') : 'Enter the code
        // instead'}`, and copy hides in that shape throughout these screens.
        mode: 'jsx-only',
        // Only attributes that render as copy. Left unrestricted this also flags
        // `variant="primary"` and `name="camera"`, and a rule that cries wolf is a rule
        // somebody switches off.
        'jsx-attributes': {
          include: ['placeholder', 'title', 'label', 'message', 'subtitle', 'description', 'accessibilityLabel', 'accessibilityHint'],
        },
        // Not prose: a URL and a fingerprint prefix are format examples a translator would
        // leave untouched, and a string with no letters at all -- a separator, a digit
        // placeholder -- cannot be copy in any language.
        //
        // These patterns are anchored to a whole match by the plugin, which wraps each in
        // `^…$`. A leading `^` therefore produces `^^…$` and silently matches nothing, so
        // the trailing `.*` is load-bearing rather than decorative.
        words: {
          exclude: ['https?://.*', 'sha256/.*', '[^a-zA-Z]+'],
        },
      }],
    },
  },
]);
