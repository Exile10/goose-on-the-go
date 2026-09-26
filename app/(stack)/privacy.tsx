/**
 * PrivacyScreen — Expandable privacy sections, data rights, licence list.
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
import type { IconName } from '@/constants/icons';
import { Grey, JaridaPurple } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';

interface PrivacySection {
  id: string;
  title: string;
  icon: IconName;
  content: string;
}

const PRIVACY_SECTIONS: PrivacySection[] = [
  { id: 'data', title: 'Data Collection', icon: 'activity', content: 'Goose collects voice commands, device interactions, and usage patterns to improve your experience. All data is processed on-device via Pond when possible. Cloud processing is only used when explicitly enabled.' },
  { id: 'storage', title: 'Data Storage', icon: 'server', content: 'Your data is stored locally on your Pond device with AES-256 encryption. Cloud backups are encrypted end-to-end. We never sell or share your personal data with third parties.' },
  { id: 'sharing', title: 'Third-Party Sharing', icon: 'link', content: 'MCP integrations (Uber, Glovo, Spotify) only receive the minimum data needed to fulfill your requests. API keys are stored encrypted and never leave your device.' },
  { id: 'voice', title: 'Voice Data', icon: 'mic', content: 'Voice recordings are processed locally by default. Recordings are not stored after transcription unless you enable voice history. Wake word detection runs entirely on-device.' },
  { id: 'biometric', title: 'Biometric Data', icon: 'shield', content: 'Face and voice biometric templates are stored only on your Pond device. Biometric data is never uploaded to the cloud and cannot be reverse-engineered into images or audio.' },
];

const DATA_RIGHTS = [
  'Download all your data',
  'Delete all stored memories',
  'Revoke third-party access',
  'Opt out of analytics',
  'Export conversation history',
];

const LICENSES = [
  { name: 'React Native', license: 'MIT' },
  { name: 'Expo', license: 'MIT' },
  { name: 'Whisper', license: 'MIT' },
  { name: 'Piper TTS', license: 'MIT' },
  { name: 'llama.cpp', license: 'MIT' },
  { name: 'react-native-svg', license: 'MIT' },
];

/** Expandable section */
function ExpandableSection({ section }: { section: PrivacySection }) {
  const styles = useThemedStyles(makeStyles);
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
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <View style={expanded ? { transform: [{ rotate: '180deg' }] } : undefined}>
          <GIcon name="chevron" size={16} color={Grey[400]} />
        </View>
      </View>
      {expanded && (
        <Text style={styles.sectionContent}>{section.content}</Text>
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
      <InkTitle level={3}>{t('privacy.policy')}</InkTitle>
      {PRIVACY_SECTIONS.map((s) => (
        <ExpandableSection key={s.id} section={s} />
      ))}

      {/* Data rights */}
      <InkTitle level={3}>{t('privacy.rights')}</InkTitle>
      <View style={styles.rightsCard}>
        {DATA_RIGHTS.map((right, i) => (
          <GPressable key={i} style={styles.rightRow}>
            <Text style={styles.rightText}>{right}</Text>
            <GIcon name="chevron" size={16} color={Grey[400]} />
          </GPressable>
        ))}
      </View>

      {/* Licenses */}
      <InkTitle level={3}>{t('privacy.licenses')}</InkTitle>
      <View style={styles.licensesCard}>
        {LICENSES.map((l, i) => (
          <View key={i} style={[styles.licenseRow, i < LICENSES.length - 1 && styles.licenseDivider]}>
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
      fontFamily: FontFamily.heading,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: c.text,
    },
    sectionContent: {
      fontFamily: FontFamily.body,
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
      fontFamily: FontFamily.body,
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
      fontFamily: FontFamily.body,
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
      fontFamily: FontFamily.mono,
      fontSize: FontSize.xs,
      color: c.textTertiary,
    },
  });
