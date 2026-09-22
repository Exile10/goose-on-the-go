import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useRemoteAccess } from '@/view-models/use-remote-access';
import type { RemoteProgress } from '@/services/remote-access';
/**
 * One literal key per step, so services/__tests__/i18n.test.ts can see them.
 *
 * Assembling the key from the step reads better and hides a failure: a deleted
 * key leaves the test green and renders "remote.enrolling" to somebody watching
 * a setup they cannot otherwise observe. The switch is exhaustive, so a new step
 * fails the typecheck here rather than at runtime.
 */
function progressLabel(t: (key: string) => string, progress: RemoteProgress): string {
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
  const { setupUnavailable, progress, error, busy, enable, recover, reviewId, localOnly } = useRemoteAccess();
  return <View style={styles.page}>
    <Text style={styles.title}>{t('remote.title')}</Text>
    <Text style={styles.body}>{t('remote.description')}</Text>
    {progress && !error && <Text accessibilityLiveRegion="polite" style={styles.body}>{progressLabel(t, progress)}</Text>}
    {reviewId && busy && <Text selectable style={styles.body}>{t('remote.reviewCode', { id: reviewId })}</Text>}
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {busy && <ActivityIndicator />}
    {progress !== 'enabled' && <Pressable accessibilityRole="button" disabled={busy} onPress={enable} style={styles.primary}><Text style={styles.primaryText}>{t('remote.enable')}</Text></Pressable>}
    {error && !setupUnavailable && progress !== 'enabled' && <Pressable accessibilityRole="button" disabled={busy} onPress={recover} style={styles.secondary}><Text>{t('remote.recover')}</Text></Pressable>}
    <Pressable accessibilityRole="button" onPress={async () => { if (progress === 'enabled' || await localOnly()) router.replace('/(tabs)'); }} style={styles.secondary}><Text>{t(progress === 'enabled' ? 'remote.done' : 'remote.localOnly')}</Text></Pressable>

  </View>;
}
const styles = StyleSheet.create({
  page: { flex: 1, padding: 28, paddingTop: 80, gap: 24, backgroundColor: '#FAFAFA' },
  title: { fontSize: 28, fontWeight: '600' }, body: { fontSize: 16, lineHeight: 24, color: '#444444' },
  error: { fontSize: 16, color: '#A02020' },
  warning: { fontSize: 16, color: '#8A5A00', lineHeight: 24 },
  primary: { padding: 18, borderRadius: 12, backgroundColor: '#6030A0', alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 16 }, secondary: { padding: 18, alignItems: 'center' },
});
