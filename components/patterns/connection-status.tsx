import { Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServer } from '@/providers/server-provider';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';
import '@/services/i18n';
import type { ConnectionState } from '@/models/connection';
// The insecure development banner above this one takes the top inset when it is shown.
import { insecureDevMode } from '@/services/dev-mode';

/** Persistent feedback with local pairing or recovery as the relevant action. */
/**
 * One literal key per state, for the same reason as the steps in
 * app/(stack)/remote-access.tsx: a key built from the state is invisible to the
 * key-completeness test, and this banner is the one piece of UI that is supposed
 * to be trustworthy when everything else is failing.
 */
function stateLabel(t: TFunction, state: ConnectionState): string {
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

/**
 * The states that need saying. A working connection is not one of them.
 *
 * This banner sits above the navigator in the root layout, so whatever it draws
 * it draws over the notification bar and pushes every screen down -- and the
 * screens below apply the top inset again, which is the empty strip under it.
 * Paying that permanently to report "Connected locally" spent the status bar on
 * news that nothing is wrong, which Home already shows beside the Pond's
 * address. Healthy connections say nothing; the banner appears when there is
 * something to act on, and is the control that acts on it.
 */
const NEEDS_ATTENTION: readonly ConnectionState[] = [
  'trust',
  'unpaired',
  'upgrade',
  'reconnecting',
  'disconnected',
  'revoked',
];

export function ConnectionStatus() {
  const { connectionState, recover } = useServer();
  const styles = useThemedStyles(makeStyles);
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
  if (!NEEDS_ATTENTION.includes(connectionState)) return null;
  return <Pressable accessibilityRole="button" onPress={act} style={[styles.container, { paddingTop: (insecureDevMode ? 0 : insets.top) + 6 }]}>
    <Text accessibilityLiveRegion="polite" style={styles.text}>{stateLabel(t, connectionState)}</Text>
  </Pressable>;
}
/*
 * Themed, because this strip is drawn behind the notification bar.
 *
 * The colours were a hardcoded pale lavender on deep purple. The root layout
 * sets the system status bar's content to light in dark mode, so those white
 * icons landed on a near-white strip and the clock, signal and battery became
 * unreadable -- the notification bar was there, and could not be seen. A
 * surface that follows the scheme keeps the contrast the system is expecting.
 */
const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 16,
      paddingVertical: 6,
      backgroundColor: c.backgroundSecondary,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    text: { color: c.text, fontSize: 12, textAlign: 'center' },
  });
