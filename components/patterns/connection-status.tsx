import { Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServer } from '@/providers/server-provider';
import '@/services/i18n';
import type { ConnectionState } from '@/models/connection';

/** Persistent feedback with local pairing or recovery as the relevant action. */
/**
 * One literal key per state, for the same reason as the steps in
 * app/(stack)/remote-access.tsx: a key built from the state is invisible to the
 * key-completeness test, and this banner is the one piece of UI that is supposed
 * to be trustworthy when everything else is failing.
 */
function stateLabel(t: (key: string) => string, state: ConnectionState): string {
  switch (state) {
    case 'trust': return t('connection.trust');
    case 'unpaired': return t('connection.unpaired');
    case 'upgrade': return t('connection.upgrade');
    case 'reconnecting': return t('connection.reconnecting');
    case 'local': return t('connection.local');
    case 'remote': return t('connection.remote');
    case 'disconnected': return t('connection.disconnected');
    case 'revoked': return t('connection.revoked');
  }
}

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
    <Text accessibilityLiveRegion="polite" style={styles.text}>{stateLabel(t, connectionState)}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 6, backgroundColor: '#f3f0fa' },
  text: { color: '#46336b', fontSize: 12, textAlign: 'center' },
});
