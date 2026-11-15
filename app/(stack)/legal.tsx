/**
 * LegalScreen: the privacy policy or the terms of use, in full, in the app's own type.
 *
 * The text is `legal.privacyPolicy` or `legal.terms` in the translations, copied from
 * `docs/PRIVACY.md` and `docs/TERMS.md` by `scripts/legal-copy.cjs`, so the app shows the reviewed
 * document word for word. `?doc=privacy` or `?doc=terms`; anything else is the privacy policy.
 */

import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';

import { Markdown } from '@/components/patterns/markdown';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';

export type LegalDocument = 'privacy' | 'terms';

export default function LegalScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const terms = doc === 'terms';
  return (
    <>
      <Stack.Screen options={{ title: t(terms ? 'screens.legalTerms' : 'screens.legalPrivacy') }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.page}>
        <Markdown source={t(terms ? 'legal.terms' : 'legal.privacyPolicy')} />
      </ScrollView>
    </>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.xl * 2 },
  });
