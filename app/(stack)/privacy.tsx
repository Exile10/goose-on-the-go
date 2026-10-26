/**
 * PrivacyScreen — what happens to a household's data, what can be done from here, and what
 * this app is built from. The content is in `constants/privacy.ts`, verified against the Pond;
 * `docs/PRIVACY-SCREEN.md` keeps the evidence for each statement.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InkTitle } from '@jarida/ink/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { Grey, JaridaPurple } from '@/constants/colors';
import { FontSize, face } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { APP_LICENSES, DATA_RIGHT_KEYS, PRIVACY_SECTIONS, type PrivacySection } from '@/constants/privacy';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';

/** Expandable section */
function ExpandableSection({ section }: { section: PrivacySection }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <GPressable feedback="lift"
      style={styles.section}
      onPress={() => setExpanded(!expanded)}
    >
      <View style={styles.sectionHeader}>
        <View style={{ marginRight: Spacing.md }}>
          <GIcon name={section.icon} size={16} color={JaridaPurple[500]} />
        </View>
        <Text style={styles.sectionTitle}>{t(section.titleKey)}</Text>
        <View style={expanded ? { transform: [{ rotate: '180deg' }] } : undefined}>
          <GIcon name="chevron" size={16} color={Grey[400]} />
        </View>
      </View>
      {expanded && (
        <Text style={styles.sectionContent}>{t(section.bodyKey)}</Text>
      )}
    </GPressable>
  );
}

export default function PrivacyScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {/* Privacy sections */}
      <InkTitle level={3}>{t('privacy.policyHeading')}</InkTitle>
      {PRIVACY_SECTIONS.map((s) => (
        <ExpandableSection key={s.id} section={s} />
      ))}

      {/* Data rights */}
      <InkTitle level={3}>{t('privacy.rightsHeading')}</InkTitle>
      <View style={styles.rightsCard}>
        {/* Statements, not buttons. These rows used to be Pressables with a chevron and no
            handler, offering five rights of which none worked. */}
        {DATA_RIGHT_KEYS.map((key) => (
          <View key={key} style={styles.rightRow}>
            <Text style={styles.rightText}>{t(key)}</Text>
          </View>
        ))}
      </View>

      {/* Licenses */}
      <InkTitle level={3}>{t('privacy.licensesHeading')}</InkTitle>
      <View style={styles.licensesCard}>
        {APP_LICENSES.map((l, i) => (
          <View key={l.pkg} style={[styles.licenseRow, i < APP_LICENSES.length - 1 && styles.licenseDivider]}>
            <Text style={styles.licenseName}>{l.name}</Text>
            <View style={styles.licenseBadge}>
              <Text style={styles.licenseText}>{l.license}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },

    /* Expandable sections */
    section: {
      backgroundColor: c.card,
      borderRadius: Radii.xl,
      padding: Spacing.lg,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: Spacing.sm,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    sectionTitle: {
      flex: 1,
      ...face('display', 'semibold'),
      fontSize: FontSize.base,
      color: c.text,
    },
    sectionContent: {
      ...face('body', 'regular'),
      fontSize: FontSize.sm,
      color: c.textTertiary,
      lineHeight: FontSize.sm * 1.6,
      marginTop: Spacing.md,
      paddingTop: Spacing.md,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },

    /* Rights */
    rightsCard: {
      backgroundColor: c.card,
      borderRadius: Radii.xl,
      borderWidth: 1,
      borderColor: c.border,
      overflow: 'hidden',
    },
    rightRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    rightText: {
      flex: 1,
      ...face('body', 'regular'),
      fontSize: FontSize.base,
      color: c.text,
    },

    /* Licenses */
    licensesCard: {
      backgroundColor: c.card,
      borderRadius: Radii.xl,
      padding: Spacing.lg,
      borderWidth: 1,
      borderColor: c.border,
    },
    licenseRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: Spacing.sm,
    },
    licenseDivider: {
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      paddingBottom: Spacing.sm,
    },
    licenseName: {
      ...face('body', 'regular'),
      fontSize: FontSize.base,
      color: c.text,
    },
    licenseBadge: {
      backgroundColor: c.backgroundSecondary,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: Radii.pill,
    },
    licenseText: {
      ...face('mono', 'regular'),
      fontSize: FontSize.xs,
      color: c.textTertiary,
    },
  });
