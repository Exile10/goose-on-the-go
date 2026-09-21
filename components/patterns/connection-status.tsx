import { Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServer } from '@/providers/server-provider';
import '@/services/i18n';

/** Persistent feedback with local pairing or recovery as the relevant action. */
export function ConnectionStatus() {
  const { connectionState, recover } = useServer();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // `revoked` joins the states that send you to pairing rather than retrying:
  // the Pond is reachable and has stopped recognising this phone, so `recover`
  // -- which probes endpoints without a token -- would report success and
  // change nothing.
  const act = () => {
    if (['unpaired', 'upgrade', 'revoked'].includes(connectionState)) router.push('/(stack)/pond-pairing');
    else void recover();
  };
  return <Pressable accessibilityRole="button" onPress={act} style={[styles.container, { paddingTop: insets.top + 6 }]}>
    <Text accessibilityLiveRegion="polite" style={styles.text}>{t(`connection.${connectionState}`)}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 6, backgroundColor: '#f3f0fa' },
  text: { color: '#46336b', fontSize: 12, textAlign: 'center' },
});
