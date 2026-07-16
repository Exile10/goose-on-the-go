/**
 * NotificationBanner — transient in-app banner for the newest server
 * notification (security alerts, schedule results, assistant pushes).
 *
 * Renders nothing when there is no fresh notification; auto-dismisses after
 * a few seconds, or on tap. Alert-category notifications use the danger
 * palette so "Failed pairing attempt" reads as a warning at a glance.
 */

import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Grey, Semantic } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { FontFamily, FontSize } from '@/constants/typography';
import { useNotifications } from '@/providers/notifications-provider';

const AUTO_DISMISS_MS = 6_000;

export function NotificationBanner() {
  const { latest, markAllRead } = useNotifications();

  useEffect(() => {
    if (!latest) return;
    const timer = setTimeout(markAllRead, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [latest, markAllRead]);

  if (!latest) return null;
  const isAlert = latest.category === 'alert';

  return (
    <Pressable
      accessibilityRole="alert"
      onPress={markAllRead}
      style={[styles.banner, isAlert ? styles.bannerAlert : styles.bannerInfo]}
    >
      <View style={styles.textColumn}>
        <Text style={[styles.title, isAlert && styles.titleAlert]} numberOfLines={1}>
          {latest.title}
        </Text>
        <Text style={styles.body} numberOfLines={2}>
          {latest.body}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: Spacing.xl,
    left: Spacing.md,
    right: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  bannerInfo: {
    backgroundColor: Semantic.infoSoft,
    borderColor: Semantic.info,
  },
  bannerAlert: {
    backgroundColor: Semantic.dangerSoft,
    borderColor: Semantic.danger,
  },
  textColumn: {
    flex: 1,
    gap: Spacing.xs,
  },
  title: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Grey[800],
  },
  titleAlert: {
    color: Semantic.danger,
  },
  body: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: Grey[600],
  },
});
