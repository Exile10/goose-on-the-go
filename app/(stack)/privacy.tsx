/**
 * PrivacyScreen — what happens to a household's data, what can be done from here, and the full
 * privacy policy, terms of use and open-source licenses. The content is in `constants/privacy.ts`, verified against the Pond;
 * `docs/PRIVACY-SCREEN.md` keeps the evidence for each statement. The one live line is the
 * town web search sends, which the Pond reports while Nearby places is on.
 */

import { useRouter } from 'expo-router';
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
import { DATA_RIGHT_KEYS, PRIVACY_DOCUMENTS, PRIVACY_SECTIONS, type PrivacySection } from '@/constants/privacy';
import { componentCount } from '@/models/open-source';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';
import { usePrivacy } from '@/view-models/use-privacy';

/** Expandable section. `extra` is a live sentence after the fixed copy. */
function ExpandableSection({ section, extra }: { section: PrivacySection; extra?: string | null }) {
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
        <Text style={styles.sectionContent}>{extra ? `${t(section.bodyKey)} ${extra}` : t(section.bodyKey)}</Text>
      )}
    </GPressable>
  );
}

export default function PrivacyScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { data } = usePrivacy();
  const router = useRouter();
  const townLine = data.nearbyTown ? t('webSearch.townSentence', { town: data.nearbyTown }) : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {/* Privacy sections */}
      <InkTitle level={3}>{t('privacy.policyHeading')}</InkTitle>
      {PRIVACY_SECTIONS.map((s) => (
        <ExpandableSection key={s.id} section={s} extra={s.id === 'network' ? townLine : null} />
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

      {/* The full documents. The summary above is what a household needs at a glance; these are
          what the stores and the law ask for, in full, and every open-source licence. */}
      <InkTitle level={3}>{t('privacy.documentsHeading')}</InkTitle>
      <View style={styles.licensesCard}>
        {PRIVACY_DOCUMENTS.map((d, i) => (
          <GPressable
            key={d.id}
            feedback="lift"
            style={[styles.documentRow, i < PRIVACY_DOCUMENTS.length - 1 && styles.licenseDivider]}
            onPress={() => router.push(d.route)}
            accessibilityRole="link"
          >
            <View style={{ marginRight: Spacing.md }}>
              <GIcon name={d.icon} size={16} color={JaridaPurple[500]} />
            </View>
            <View style={styles.documentText}>
              <Text style={styles.licenseName}>{t(d.titleKey)}</Text>
              <Text style={styles.documentHint}>{t(d.hintKey, { count: componentCount() })}</Text>
            </View>
            <GIcon name="chevron-right" size={16} color={Grey[400]} />
          </GPressable>
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
    licenseDivider: {
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      paddingBottom: Spacing.sm,
    },
    documentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: Spacing.sm,
    },
    documentText: { flex: 1 },
    documentHint: {
      ...face('body', 'regular'),
      fontSize: FontSize.sm,
      color: c.textSecondary,
      marginTop: 2,
    },
    licenseName: {
      ...face('body', 'regular'),
      fontSize: FontSize.base,
      color: c.text,
    },
  });
