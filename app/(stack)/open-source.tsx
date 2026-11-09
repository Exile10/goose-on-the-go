/**
 * OpenSourceScreen: every open-source component this app ships, grouped as the app's own
 * components, its Android libraries and its built-in libraries, each with its licence. Tap one to
 * read the licence in full; where the licence text is not included, its address is given instead.
 * The list is `models/open-source.ts`, generated from a release build.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList, StyleSheet, Text, View } from 'react-native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { Grey } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { Radii } from '@/constants/radii';
import { Spacing } from '@/constants/spacing';
import { FontSize, face } from '@/constants/typography';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { componentGroups, type Component, type ComponentKind } from '@/models/open-source';

const HEADINGS: Record<ComponentKind, 'openSource.javascript' | 'openSource.android' | 'openSource.embedded'> = {
  javascript: 'openSource.javascript',
  android: 'openSource.android',
  embedded: 'openSource.embedded',
};

function ComponentRow({ component, open, onToggle }: { component: Component; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  return (
    <GPressable
      style={styles.row}
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={[component.name, component.license].filter(Boolean).join(', ')}
    >
      <View style={styles.rowHeader}>
        <View style={styles.rowTitle}>
          <Text style={styles.name}>{component.name}</Text>
          {component.version ? <Text style={styles.version}>{t('openSource.version', { version: component.version })}</Text> : null}
        </View>
        {component.license ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText} numberOfLines={1}>
              {component.license}
            </Text>
          </View>
        ) : null}
        <View style={open ? styles.flipped : undefined}>
          <GIcon name="chevron" size={14} color={Grey[400]} />
        </View>
      </View>
      {open ? (
        <Text style={styles.text} selectable>
          {component.text ?? (component.url ? t('openSource.readAt', { url: component.url }) : t('openSource.noText'))}
        </Text>
      ) : null}
    </GPressable>
  );
}

export default function OpenSourceScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const sections = useMemo(
    () => componentGroups().map((g) => ({ kind: g.kind, data: g.components })),
    [],
  );
  const [open, setOpen] = useState<string | null>(null);
  const keyOf = useCallback((c: Component) => `${c.name}@${c.version}`, []);

  return (
    <SectionList
      style={styles.container}
      contentContainerStyle={styles.page}
      sections={sections}
      keyExtractor={keyOf}
      ListHeaderComponent={<Text style={styles.intro}>{t('openSource.intro')}</Text>}
      renderSectionHeader={({ section }) => <Text style={styles.heading}>{t(HEADINGS[section.kind])}</Text>}
      renderItem={({ item }) => {
        const key = keyOf(item);
        return <ComponentRow component={item} open={open === key} onToggle={() => setOpen(open === key ? null : key)} />;
      }}
      initialNumToRender={24}
      stickySectionHeadersEnabled={false}
    />
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing['2xl'] * 2 },
    intro: { ...face('body', 'regular'), fontSize: FontSize.sm, color: c.textSecondary, marginBottom: Spacing.md },
    heading: {
      ...face('display', 'bold'),
      fontSize: FontSize.lg,
      color: c.text,
      marginTop: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    row: {
      backgroundColor: c.card,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: Spacing.md,
      marginBottom: Spacing.xs,
    },
    rowHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    rowTitle: { flex: 1 },
    name: { ...face('body', 'regular'), fontSize: FontSize.base, color: c.text },
    version: { ...face('mono', 'regular'), fontSize: FontSize.xs, color: c.textTertiary, marginTop: 2 },
    badge: {
      backgroundColor: c.backgroundSecondary,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: Radii.pill,
      maxWidth: '45%',
    },
    badgeText: { ...face('mono', 'regular'), fontSize: FontSize.xs, color: c.textTertiary },
    flipped: { transform: [{ rotate: '180deg' }] },
    text: {
      ...face('mono', 'regular'),
      fontSize: FontSize.xs,
      lineHeight: FontSize.xs * 1.5,
      color: c.textSecondary,
      marginTop: Spacing.md,
    },
  });
