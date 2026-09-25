/**
 * PrivacyScreen — what happens to a household's data, what can be done from here, and what
 * this app is built from. The content is in `constants/privacy.ts`, verified against the Pond.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';

import { GIcon } from '@/components/ui/g-icon';
import { Grey, JaridaPurple, Brand } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import i18n from '@/services/i18n';
import { APP_LICENSES, DATA_RIGHT_KEYS, PRIVACY_SECTIONS, type PrivacySection } from '@/constants/privacy';

/** Expandable section */
function ExpandableSection({ section }: { section: PrivacySection }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable
      style={styles.section}
      onPress={() => setExpanded(!expanded)}
    >
      <View style={styles.sectionHeader}>
        <View style={{ marginRight: Spacing.md }}>
          <GIcon name={section.icon} size={16} color={JaridaPurple[500]} />
        </View>
        <Text style={styles.sectionTitle}>{i18n.t(section.titleKey)}</Text>
        <View style={expanded ? { transform: [{ rotate: '180deg' }] } : undefined}>
          <GIcon name="chevron" size={16} color="#B5B5B5" />
        </View>
      </View>
      {expanded && (
        <Text style={styles.sectionContent}>{i18n.t(section.bodyKey)}</Text>
      )}
    </Pressable>
  );
}

export default function PrivacyScreen() {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {/* Privacy sections */}
      <Text style={styles.label}>{i18n.t('privacy.policyLabel')}</Text>
      {PRIVACY_SECTIONS.map((s) => (
        <ExpandableSection key={s.id} section={s} />
      ))}

      {/* Data rights */}
      <Text style={styles.label}>{i18n.t('privacy.rightsLabel')}</Text>
      <View style={styles.rightsCard}>
        {/* Statements, not buttons. These rows used to be Pressables with a chevron and no
            handler, offering five rights of which none worked. */}
        {DATA_RIGHT_KEYS.map((key) => (
          <View key={key} style={styles.rightRow}>
            <Text style={styles.rightText}>{i18n.t(key)}</Text>
          </View>
        ))}
      </View>

      {/* Licenses */}
      <Text style={styles.label}>{i18n.t('privacy.licensesLabel')}</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Grey[50] },
  scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },

  label: {
    fontFamily: FontFamily.body,
    fontSize: 11,
    fontWeight: FontWeight.bold,
    color: Grey[500],
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: Spacing.md,
    marginTop: Spacing.lg,
  },

  /* Expandable sections */
  section: {
    backgroundColor: Brand.white,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Grey[200],
    marginBottom: Spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    flex: 1,
    fontFamily: FontFamily.heading,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Brand.charcoal,
  },
  sectionContent: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[600],
    lineHeight: FontSize.sm * 1.6,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Grey[100],
  },

  /* Rights */
  rightsCard: {
    backgroundColor: Brand.white,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Grey[200],
    overflow: 'hidden',
  },
  rightRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Grey[100],
  },
  rightText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: Brand.charcoal,
  },

  /* Licenses */
  licensesCard: {
    backgroundColor: Brand.white,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Grey[200],
  },
  licenseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  licenseDivider: {
    borderBottomWidth: 1,
    borderBottomColor: Grey[100],
    paddingBottom: Spacing.sm,
  },
  licenseName: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: Brand.charcoal,
  },
  licenseBadge: {
    backgroundColor: Grey[100],
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radii.pill,
  },
  licenseText: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    color: Grey[600],
  },
});
