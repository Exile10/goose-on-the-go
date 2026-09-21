import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkSwitch } from '@jarida/ink/native';
import { useRemoteAccess } from '@/view-models/use-remote-access';
import { diagnosticsAvailable, setDiagnostics } from '@/services/diagnostics';
export default function RemoteAccessScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  // Here rather than on the developer screen, which redirects away unless the
  // build is debuggable -- the one build where node diagnostics are no use.
  const diagnosable = diagnosticsAvailable();
  const [recording, setRecording] = useState(false);
  const onDiagnostics = useCallback((next: boolean) => {
    setRecording(next);
    void setDiagnostics(next).catch(() => setRecording((was) => !was));
  }, []);
  const { setupUnavailable, progress, error, busy, enable, recover, reviewId, localOnly } = useRemoteAccess();
  return <View style={styles.page}>
    <Text style={styles.title}>{t('remote.title')}</Text>
    <Text style={styles.body}>{t('remote.description')}</Text>
    {progress && !error && <Text accessibilityLiveRegion="polite" style={styles.body}>{t(`remote.${progress}`)}</Text>}
    {reviewId && busy && <Text selectable style={styles.body}>{t('remote.reviewCode', { id: reviewId })}</Text>}
    {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {busy && <ActivityIndicator />}
    {progress !== 'enabled' && <Pressable accessibilityRole="button" disabled={busy} onPress={enable} style={styles.primary}><Text style={styles.primaryText}>{t('remote.enable')}</Text></Pressable>}
    {error && !setupUnavailable && progress !== 'enabled' && <Pressable accessibilityRole="button" disabled={busy} onPress={recover} style={styles.secondary}><Text>{t('remote.recover')}</Text></Pressable>}
    <Pressable accessibilityRole="button" onPress={async () => { if (progress === 'enabled' || await localOnly()) router.replace('/(tabs)'); }} style={styles.secondary}><Text>{t(progress === 'enabled' ? 'remote.done' : 'remote.localOnly')}</Text></Pressable>
    {diagnosable ? (
      <View style={styles.diagnosticsRow}>
        <View style={styles.diagnosticsLabel}>
          <Text style={styles.body}>{t('diagnostics.title')}</Text>
          <Text style={styles.diagnosticsHint}>{t('diagnostics.hint')}</Text>
        </View>
        <InkSwitch checked={recording} onChange={onDiagnostics} />
      </View>
    ) : null}
  </View>;
}
const styles = StyleSheet.create({
  page: { flex: 1, padding: 28, paddingTop: 80, gap: 24, backgroundColor: '#FAFAFA' },
  title: { fontSize: 28, fontWeight: '600' }, body: { fontSize: 16, lineHeight: 24, color: '#444444' },
  error: { fontSize: 16, color: '#A02020' },
  diagnosticsRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingTop: 8 },
  diagnosticsLabel: { flex: 1, gap: 4 },
  diagnosticsHint: { fontSize: 13, lineHeight: 19, color: '#666666' },
  warning: { fontSize: 16, color: '#8A5A00', lineHeight: 24 },
  primary: { padding: 18, borderRadius: 12, backgroundColor: '#6030A0', alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 16 }, secondary: { padding: 18, alignItems: 'center' },
});
