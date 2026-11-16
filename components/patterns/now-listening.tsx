/**
 * A slim strip across the top of every screen while the news is read aloud on this phone, so it
 * can be paused, resumed or stopped from wherever the member went after pressing Listen. The
 * phone's own media controls (lock screen, notification shade) are the other way to pause it.
 *
 * It sits where the connection strip sits and takes the status-bar inset only when that strip is
 * not already holding it, so the two never stack two notches' worth of space.
 */

import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { FontSize, FontWeight } from '@/constants/typography';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { connectionSurface } from '@/models/connection';
import { useTheme } from '@/providers/theme-provider';
import { useConnectionStatus } from '@/view-models/use-connection-status';
import { pauseListening, resumeListening, stopListening, useListening } from '@/view-models/news-player';

export function NowListening() {
  const listening = useListening();
  const connection = useConnectionStatus();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation();
  if (!listening) return null;

  const connectionBanner = connection.hydrated && connection.phase !== 'connected' && connectionSurface(segments) === 'banner';
  const playing = listening.state === 'playing';
  const loading = listening.state === 'loading';
  const status = listening.state === 'paused' ? t('goose.digest.nowPaused') : t('goose.digest.nowListening');

  return (
    <View style={[styles.container, { paddingTop: (connectionBanner ? 0 : insets.top) + Spacing.xs }]}>
      <GIcon name="listen" size={16} color={colors.textBrand} />
      <View style={styles.words} accessible accessibilityLiveRegion="polite" accessibilityLabel={`${status}: ${listening.title}`}>
        <Text style={styles.status}>{status}</Text>
        <Text style={styles.title} numberOfLines={1}>
          {listening.title}
        </Text>
      </View>
      {loading ? null : (
        <GPressable
          feedback="none"
          haptic="toggle"
          accessibilityRole="button"
          accessibilityLabel={playing ? t('goose.digest.pause') : t('goose.digest.resume')}
          hitSlop={Spacing.md}
          onPress={playing ? pauseListening : resumeListening}
        >
          <GIcon name={playing ? 'pause' : 'play'} size={20} color={colors.text} />
        </GPressable>
      )}
      <GPressable feedback="none" accessibilityRole="button" accessibilityLabel={t('goose.digest.stop')} hitSlop={Spacing.md} onPress={stopListening}>
        <Text style={styles.action}>{t('goose.digest.stop')}</Text>
      </GPressable>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.xs,
      backgroundColor: c.backgroundSecondary,
    },
    words: { flex: 1, gap: 2 },
    status: { color: c.textSecondary, fontSize: FontSize.xs },
    title: { color: c.text, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
    action: { color: c.textBrand, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  });
