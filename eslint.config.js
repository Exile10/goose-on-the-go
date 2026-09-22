// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const i18next = require('eslint-plugin-i18next');

/**
 * Every file that renders user-facing copy.
 *
 * i18n used to cover about a fifth of the app, and the rule demanding more lived only in an
 * untracked agent-guidance file -- so it was resolved ad hoc each time somebody added a
 * line of copy. The copy has now been migrated and the rule applies everywhere, which is
 * what makes it a rule rather than an intention: a bare user-facing string in any of these
 * files fails the build.
 *
 * Literals that are not copy carry a targeted disable naming what they are -- placeholder
 * data awaiting a real Pond response, or a product name. Those disables are the list of
 * things still to do on each screen, and they go when the screen is wired.
 *
 * See docs/I18N.md.
 */
const TRANSLATED_SURFACE = ['app/**/*.tsx', 'components/**/*.tsx', 'view-models/**/*.ts'];

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
