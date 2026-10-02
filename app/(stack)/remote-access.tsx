import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useRemoteAccess } from '@/view-models/use-remote-access';
import type { RemoteProgress } from '@/services/remote-access';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useTheme } from '@/providers/theme-provider';

/**
 * The two alert colours, per scheme. The palette's `Semantic` red and amber each
 * miss 4.5:1 on one of the two grounds (red on dark, amber on white), so light
 * keeps this screen's original deep tones and dark gets lighter ones.
 */
const ALERT = {
  light: { error: '#A02020', warning: '#8A5A00' },
  dark: { error: '#FF8A80', warning: '#E0A82E' },
} as const;
/**
 * One literal key per step, so services/__tests__/i18n.test.ts can see them.
 *
 * Assembling the key from the step reads better and hides a failure: a deleted
 * key leaves the test green and renders "remote.enrolling" to somebody watching
 * a setup they cannot otherwise observe. The switch is exhaustive, so a new step
 * fails the typecheck here rather than at runtime.
 */
function progressLabel(t: TFunction, progress: RemoteProgress): string {
  switch (progress) {
    case 'approval': return t('remote.approval');
    case 'review': return t('remote.review');
    case 'enrolling': return t('remote.enrolling');
    case 'connecting': return t('remote.connecting');
    case 'enabled': return t('remote.enabled');
  }
}

export default function RemoteAccessScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { setupUnavailable, progress, error, busy, enable, recover, reviewId, localOnly, lapse } = useRemoteAccess();
  const styles = useThemedStyles(makeStyles);
  const alert = ALERT[useTheme().isDark ? 'dark' : 'light'];
  return <View style={styles.page}>
    <Text style={styles.title}>{t('remote.title')}</Text>
    <Text style={styles.body}>{t('remote.description')}</Text>
    {progress && !error && <Text accessibilityLiveRegion="polite" style={styles.body}>{progressLabel(t, progress)}</Text>}
    {reviewId && busy && <Text selectable style={styles.body}>{t('remote.reviewCode', { id: reviewId })}</Text>}
    {lapse && <Text accessibilityRole="alert" style={[styles.warning, { color: alert.warning }]}>{lapse}</Text>}
    {error && <Text accessibilityRole="alert" style={[styles.error, { color: alert.error }]}>{error}</Text>}
    {busy && <ActivityIndicator />}
    {progress !== 'enabled' && <Pressable accessibilityRole="button" disabled={busy} onPress={enable} style={styles.primary}><Text style={styles.primaryText}>{t('remote.enable')}</Text></Pressable>}
    {error && !setupUnavailable && progress !== 'enabled' && <Pressable accessibilityRole="button" disabled={busy} onPress={recover} style={styles.secondary}><Text style={styles.secondaryText}>{t('remote.recover')}</Text></Pressable>}
    <Pressable accessibilityRole="button" onPress={async () => { if (progress === 'enabled' || await localOnly()) router.replace('/(tabs)'); }} style={styles.secondary}><Text style={styles.secondaryText}>{t(progress === 'enabled' ? 'remote.done' : 'remote.localOnly')}</Text></Pressable>

  </View>;
}
const makeStyles = (c: ThemeColors) => StyleSheet.create({
  page: { flex: 1, padding: 28, paddingTop: 80, gap: 24, backgroundColor: c.background },
  title: { fontSize: 28, fontWeight: '600', color: c.text }, body: { fontSize: 16, lineHeight: 24, color: c.textSecondary },
  error: { fontSize: 16 },
  warning: { fontSize: 16, lineHeight: 24 },
  primary: { padding: 18, borderRadius: 12, backgroundColor: c.tint, alignItems: 'center' },
  primaryText: { color: c.textOnBrand, fontSize: 16 }, secondary: { padding: 18, alignItems: 'center' },
  secondaryText: { color: c.text },
});
