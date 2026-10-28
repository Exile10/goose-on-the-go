import { useEffect, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServer } from '@/providers/server-provider';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';
import '@/services/i18n';
import { GIcon } from '@/components/ui/g-icon';
import type { IconName } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import { FontSize, FontWeight } from '@/constants/typography';
import { useTheme } from '@/providers/theme-provider';
import {
  bannerHiddenOn,
  connectionActionIsPairing,
  connectionNeedsAttention,
  type ConnectionState,
} from '@/models/connection';
// The insecure development banner above this one takes the top inset when it is shown.

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
 * How long a reconnect may run before the banner says so. The banner pushes every screen down, so
 * showing it for a reconnect that finishes in a few hundred milliseconds -- a network change, a
 * return to the app -- made the whole layout jump for nothing anyone could act on.
 */
const RECONNECT_GRACE_MS = 1_500;

/**
 * Shows `children` once the grace period has passed. It holds no reset of its own: the banner
 * renders nothing between reconnects, so React mounts a fresh one, with a fresh timer, for each.
 */
function AfterGrace({ children }: { children: ReactElement }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), RECONNECT_GRACE_MS);
    return () => clearTimeout(timer);
  }, []);
  return shown ? children : null;
}

/** The glyph for what kind of problem it is: the connection, the pairing, or trust in the Pond. */
function stateIcon(state: ConnectionState): IconName {
  if (connectionActionIsPairing(state)) return 'link';
  if (state === 'trust') return 'shield';
  return 'cloud-off';
}

/**
 * The app's one statement that the Pond cannot be used.
 *
 * Screens do not repeat it: while it is up, content that did not arrive shows only that it will
 * fill in (`ContentUnavailable`), and Home's Pond card drops its own reachability title. That is
 * the whole point of it being one strip rather than a notice per screen -- a Pond that is down was
 * being reported three times on one screen.
 *
 * A working connection says nothing (`connectionNeedsAttention`). The strip sits above the
 * navigator, over the notification bar, and pushes every screen down, so paying that permanently
 * to report "Connected locally" spent the status bar on news that nothing is wrong. It is quiet when
 * it does appear -- the secondary surface and a hairline, not a coloured slab.
 *
 * It carries no Try again. Another attempt is a downward swipe on the screen underneath, as it is
 * in most apps (`usePullToRefresh`), which looks for the Pond and reads the screen again in one
 * gesture. The only button left is Pair, where only pairing can help (`connectionActionIsPairing`):
 * that is a different action, not a refresh. There is no "Checking" either: the pull's own spinner
 * shows the attempt where the finger is, and the attempt itself turns the strip to "Reconnecting"
 * once it has run past the grace period, so a third word for it would say the same thing again.
 *
 * A screen reader cannot easily pull to refresh, so where another attempt can help the strip
 * carries it as an accessibility action: TalkBack and VoiceOver read the sentence, the hint says to
 * pull down, and a double tap tries again. A sighted tap on the strip does nothing.
 */
export function ConnectionStatus() {
  const { connectionState, recover, hydrated } = useServer();
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();

  // Before the saved pairing has loaded, the state is a placeholder, not news.
  if (!hydrated || !connectionNeedsAttention(connectionState) || bannerHiddenOn(segments)) return null;
  const pairing = connectionActionIsPairing(connectionState);
  // A reconnect is already the attempt a pull would make, so it offers nothing to trigger.
  const retryable = !pairing && connectionState !== 'reconnecting';
  const label = stateLabel(t, connectionState);
  const banner = (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
      <View
        style={styles.statement}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={label}
        accessibilityHint={retryable ? t('contentState.pullHint') : undefined}
        accessibilityActions={retryable ? [{ name: 'activate', label: t('common.retry') }] : undefined}
        onAccessibilityAction={retryable ? () => void recover() : undefined}
      >
        <GIcon name={stateIcon(connectionState)} size={16} color={colors.textSecondary} />
        <Text style={styles.text}>{label}</Text>
      </View>
      {pairing ? (
        <Pressable accessibilityRole="button" hitSlop={Spacing.md} onPress={() => router.push('/(stack)/pond-pairing')}>
          <Text style={styles.action}>{t('connection.actionPair')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
  return connectionState === 'reconnecting' ? <AfterGrace>{banner}</AfterGrace> : banner;
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
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.sm,
      backgroundColor: c.backgroundSecondary,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    statement: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    text: { flex: 1, color: c.text, fontSize: FontSize.sm },
    action: { color: c.textBrand, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  });
