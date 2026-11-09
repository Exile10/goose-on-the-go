# Licenses, notices and the legal documents in the app

Settings, Privacy and licenses has three documents under "The full documents": the privacy
policy, the terms of use, and the open-source licenses. This file says where each comes from and
when to regenerate it.

## The privacy policy and the terms of use

- **Source:** `docs/PRIVACY.md` and `docs/TERMS.md`. These are the texts a lawyer reviews, and the
  ones to host for the stores. Every statement in the privacy policy is backed by
  `docs/DATA-SAFETY.md`; change one only with the same kind of evidence.
- **In the app:** `legal.privacyPolicy` and `legal.terms` in `services/i18n/locales/en.json`,
  shown by `app/(stack)/legal.tsx` in the app's Markdown renderer. They hold each document's "Last
  updated" line and everything after its `---` separator.
- **After editing a document,** run `node scripts/legal-copy.cjs`.
  `constants/__tests__/legal-copy.test.ts` fails while the app's copy differs from the documents.
- **Before publishing:** both documents carry `[NEEDS ANSWER: ...]` placeholders for facts the
  code cannot settle (the legal entity, contact address, retention, age, governing law, dates).
  Neither may be published, linked, or submitted to a store until each is filled in, and the terms
  should be reviewed by a lawyer for the countries the app is offered in.

## The open-source licenses

- **In the app:** `app/(stack)/open-source.tsx`, from `assets/legal/open-source.json` through
  `models/open-source.ts`.
- **Generated, not written:** `scripts/open-source-notices.cjs` reads a release build, so the list
  holds exactly what ships:
  - **App components:** the packages the release JavaScript bundle contains, read from its source
    map, each with its version, declared license and license text. A package from a monorepo
    that ships no license file of its own takes its project's (React Native's or Expo's), and one
    declaring MIT without a text gets the MIT license with its declared author.
  - **Android libraries:** Gradle's release runtime classpath, each with the license its published
    POM declares (fetched from Google's Maven, Maven Central or JitPack, and cached in
    `~/.cache/gotg-notices`). The Apache License 2.0 is included once in full, as section 4 of it
    asks. React Native's and Expo's own native modules are covered by their packages' licenses.
  - **Built-in libraries:** each `native/*/THIRD_PARTY_NOTICES.txt`, verbatim.
- **Regenerate before each release,** and after adding, removing or upgrading a dependency:

  ```bash
  npx expo prebuild --platform android --no-install
  (cd android && ./gradlew assembleRelease)
  node scripts/open-source-notices.cjs \
    --sourcemap android/app/build/generated/sourcemaps/react/release/index.android.bundle.map \
    --android android
  ```

  `models/__tests__/open-source.test.ts` fails when React Native's or Expo's listed version no
  longer matches the installed one, which is the usual sign the file is stale.
