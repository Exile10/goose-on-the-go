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
/**
 * `i18next/no-literal-string`, without the exemption that hid a third of the copy.
 *
 * The plugin treats any variable with an all-caps name as a constant and skips every string
 * inside it: its `VariableDeclarator` handler pushes `isUpperCase(name)` onto the stack of scopes
 * it consults, and one "skip" anywhere up that stack wins over everything below. That is exactly
 * where this codebase keeps copy -- `STEP_LABELS`, `SUGGESTED_PROMPTS`, a privacy screen's
 * paragraphs -- so about seventy strings were invisible to a rule this file says covers the whole
 * surface. `{ title: 'Data Collection' }` was flagged in `const sections` and not in
 * `const SECTIONS`, and nothing else differed.
 *
 * The plugin has no option for it, so the handler goes. Its enter and exit are both removed, which
 * keeps that stack balanced; every other rule the plugin applies is unchanged, and the rule keeps
 * its id, so the existing targeted disables still apply.
 */
const literalRule = i18next.rules['no-literal-string'];
const i18nextWithoutUppercaseExemption = {
  ...i18next,
  rules: {
    ...i18next.rules,
    'no-literal-string': {
      ...literalRule,
      create(context) {
        const visitors = literalRule.create(context);
        delete visitors.VariableDeclarator;
        delete visitors['VariableDeclarator:exit'];
        return visitors;
      },
    },
  },
};

/**
 * expo-router carries its own build of React Navigation and mounts only that one. A hook or
 * provider imported from the @react-navigation packages talks to a context nothing provides:
 * usePreventRemove from @react-navigation/native threw "Couldn't find a navigation object"
 * and closed the app as Files opened, and the theme provider set a theme no navigator read.
 */
const NAVIGATION_PATTERNS = [{
  group: ['@react-navigation/*'],
  message: "Import from 'expo-router' or 'expo-router/react-navigation': expo-router mounts its own copy of React Navigation, not this package.",
}];

/**
 * Every press is felt. Ink has no haptics, so its pressable components reach the app through
 * `components/ui/ink.tsx`, which gives each the right feel, and every other press goes through
 * `GPressable`, which taps by default. A direct import of either bypasses that, and a button
 * goes silent under the thumb: the Devices tab's add button and the Home avatar were.
 */
const PRESS_RULE = {
  files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'view-models/**/*.{ts,tsx}', 'providers/**/*.{ts,tsx}', 'hooks/**/*.{ts,tsx}'],
  ignores: ['**/__tests__/**', 'components/ui/ink.tsx', 'components/ui/g-pressable.tsx'],
  rules: {
    // One rule entry for both: a later config's options replace an earlier one's, not add to them.
    'no-restricted-imports': ['error', {
      patterns: NAVIGATION_PATTERNS,
      paths: [
        { name: '@jarida/ink/native', message: "Import Ink from '@/components/ui/ink', which gives its presses their haptic feel." },
        {
          name: 'react-native',
          importNames: ['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback'],
          message: "Use GPressable from '@/components/ui/g-pressable', which gives a press its haptic feel.",
        },
      ],
    }],
  },
};

const TRANSLATED_SURFACE = ['app/**/*.tsx', 'components/**/*.tsx', 'view-models/**/*.ts', 'constants/**/*.ts'];

module.exports = defineConfig([
  expoConfig,
  { rules: { 'no-restricted-imports': ['error', { patterns: NAVIGATION_PATTERNS }] } },
  PRESS_RULE,
  {
    // `._*`: macOS AppleDouble sidecars, which are binary. See metro.config.js.
    ignores: ['dist/*', '**/._*'],
  },
  {
    // Jest runs this before every suite. The Expo config gives test files Jest's globals, not this one.
    files: ['jest.setup.js'],
    languageOptions: { globals: { jest: 'readonly' } },
  },
  {
    files: TRANSLATED_SURFACE,
    // Tests assert on copy; they are not copy.
    ignores: ['**/__tests__/**'],
    plugins: { i18next: i18nextWithoutUppercaseExemption },
    rules: {
      'i18next/no-literal-string': ['error', {
        // `jsx-only` was not enough, and the gap was not subtle: it inspects JSX text and
        // JSX attributes, so copy living in a data structure -- `{ label: '4 Active' }`, a
        // navigation entry, an error string returned from a view-model -- was never looked
        // at. Whole screens read as clean while most of their copy sat in a const above
        // them.
        mode: 'all',
        // `all` means every literal, so the copy-bearing property names have to be named
        // or the rule drowns in style tokens and route ids.
        'object-properties': {
          include: ['label', 'title', 'desc', 'description', 'detail', 'subtitle', 'hint', 'message', 'placeholder', 'headerTitle', 'text'],
        },
        // `logFailure` writes a log line, like `console.*`: its words are for engineers.
        callees: { exclude: ['console.*', 'logFailure', 'require', 'Error', 'i18n.t', 't'] },
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
          exclude: [
            'https?://.*', 'sha256/.*', '[^a-zA-Z]+',
            // A single lowercase token is an identifier in this codebase, never copy:
            // state enums ('idle', 'searching'), capability names ('power'), theme and
            // layout values ('dark', 'window'), route and screen ids. Copy starts with a
            // capital or contains a space, so this separates them without a wordlist that
            // would need maintaining.
            '[a-z][a-zA-Z0-9_.-]*',
            // Route paths and hex colours, for the same reason.
            '/[^ ]*', '#[0-9a-fA-F]{3,8}',
          ],
        },
      }],
    },
  },
]);
