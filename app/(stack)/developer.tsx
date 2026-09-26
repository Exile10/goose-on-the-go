/**
 * DeveloperScreen — dev-only mock/real backend toggle (issue #21).
 *
 * Lets each migratable screen be flipped between its mock data and the real
 * PondApiClient independently, so backend-wiring work (#9–#15) can land and
 * be tested screen by screen against a live Pond server instead of one
 * coordinated cutover.
 */

import { useTranslation } from 'react-i18next';
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Redirect } from 'expo-router';

import { InkInput, InkSwitch, InkNotice } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { ServerStatus } from '@/components/patterns/server-status';
import { useServer, MIGRATION_SCREENS, type MigrationScreen } from '@/providers/server-provider';
import { JaridaPurple, Brand } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { Shadows } from '@/constants/shadows';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';

const SCREEN_LABELS: Record<MigrationScreen, string> = {
  chat: 'Chat',
  memory: 'Memories',
  integrations: 'App Integrations & MCP Servers',
  schedule: 'Schedule',
  logs: 'Activity Logs',
};

export default function DeveloperScreen() {
  // Not linked from the You-tab menu in production (see constants/navigation.ts),
  // but the route itself still exists — refuse to render it outside dev builds
  // too, so a direct link/deep link can't reach it either. Kept in a separate
  // component (rather than an early return here) so the hooks below always
  // run in a consistent order for whichever component actually renders.
  if (!__DEV__) {
    return <Redirect href="/(tabs)" />;
  }
  return <DeveloperScreenContent />;
}

function DeveloperScreenContent() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { serverUrl, setServerUrl, online, checkHealth, isScreenReal, setScreenMode } = useServer();
  const [urlDraft, setUrlDraft] = useState(serverUrl);
  const [checking, setChecking] = useState(false);

  const handleTestConnection = useCallback(async () => {
    // Mirrors the trailing-slash cleanup setServerUrl applies internally, so
    // this comparison (and the draft resync below) line up with what actually
    // ends up in `serverUrl` instead of drifting after the first change.
    const clean = urlDraft.replace(/\/+$/, '');
    setChecking(true);
    // setServerUrl already performs and awaits its own health check when the
    // URL actually changes; only fire a separate one to retest the same URL.
    if (clean !== serverUrl) {
      setServerUrl(clean);
      setUrlDraft(clean);
    }
    // `setServerUrl` here only records the address; the probe is always ours.
    await checkHealth();
    setChecking(false);
  }, [urlDraft, serverUrl, setServerUrl, checkHealth]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>{t('dev.connection')}</Text>
      <View style={styles.card}>
        <InkInput
          label="Pond server URL"
          value={urlDraft}
          onChange={setUrlDraft}
          placeholder={t('dev.addressPlaceholder')}
        />
        <View style={styles.connectionRow}>
          <ServerStatus online={online} />
          <GPressable
            feedback="lift"
            style={styles.testButton}
            onPress={handleTestConnection}
            disabled={checking}
          >
            <GIcon name="refresh" size={14} color={Brand.white} />
            <Text style={styles.testButtonText}>
              {checking ? 'Checking\u2026' : 'Test connection'}
            </Text>
          </GPressable>
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t('dev.screenMode')}</Text>
      <Text style={styles.sectionHint}>
        Flip a screen to “Real” once its backend wiring lands (#9–#15). Mock and real
        code paths coexist — nothing needs to be deleted to test either one.
      </Text>
      <View style={styles.card}>
        {MIGRATION_SCREENS.map((screen, i) => (
          <View
            key={screen}
            style={[styles.screenRow, i < MIGRATION_SCREENS.length - 1 && styles.screenRowDivider]}
          >
            <View style={styles.screenRowLeft}>
              <Text style={styles.screenLabel}>{SCREEN_LABELS[screen]}</Text>
              <Text style={styles.screenModeText}>
                {isScreenReal(screen) ? 'Real backend' : 'Mock data'}
              </Text>
            </View>
            <InkSwitch
              checked={isScreenReal(screen)}
              onChange={(value) => setScreenMode(screen, value)}
            />
          </View>
        ))}
      </View>

      <View style={styles.notice}>
        <InkNotice tone="warning">
          This screen is dev-only. It is not linked from the You tab in production builds.
        </InkNotice>
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    content: { padding: Spacing.lg, paddingBottom: Spacing['3xl'] },

    sectionTitle: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: c.text,
      marginBottom: Spacing.sm,
      marginTop: Spacing.lg,
    },
    sectionHint: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.sm,
      color: c.textTertiary,
      marginBottom: Spacing.md,
      marginTop: -Spacing.xs,
      lineHeight: FontSize.sm * 1.5,
    },

    card: {
      backgroundColor: c.card,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: Spacing.md,
      ...Shadows.sm,
    },

    connectionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: Spacing.md,
    },
    testButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      backgroundColor: JaridaPurple[500],
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: Radii.md,
    },
    testButtonText: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      color: Brand.white,
    },

    screenRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: Spacing.md,
    },
    screenRowDivider: {
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    screenRowLeft: { flex: 1, marginRight: Spacing.md },
    screenLabel: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
      color: c.text,
    },
    screenModeText: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.xs,
      color: c.textTertiary,
      marginTop: 2,
    },

    notice: { marginTop: Spacing.xl },
  });
