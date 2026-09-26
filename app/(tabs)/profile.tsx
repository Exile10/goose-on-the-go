/**
 * ProfileHub — the "You" tab: who this Pond knows you as, and everything that
 * configures it.
 *
 * The identity shown here is the first household profile the Pond returns, not
 * an account. There is no login and no email field anywhere in GIAP, so the
 * card reports the profile and the Pond it came from rather than inventing a
 * user.
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBottomBarInset, useChromeScroll } from '@/providers/chrome-provider';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';

import {
  InkButton,
  InkCard,
  InkGroup,
  InkRow,
  InkText,
  InkTitle,
} from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { PROFILE_NAV, type NavItem } from '@/constants/navigation';
import { useDevices } from '@/view-models/use-devices';
import { useProfiles } from '@/view-models/use-profiles';
import { useServer } from '@/providers/server-provider';
import { hostOf } from '@/services/discovery';
import { APP_VERSION } from '@/constants/app';
import { selectionTick, caution } from '@/services/haptics';
import { Grey, JaridaPurple, Brand, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { Shadows } from '@/constants/shadows';

const NavRow = React.memo(function NavRow({
  item,
  onPress,
  divided,
}: {
  item: NavItem;
  onPress: (route: string) => void;
  divided: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const handlePress = useCallback(() => onPress(item.route), [item.route, onPress]);

  return (
    <GPressable onPress={handlePress} accessibilityRole="button">
      <InkRow
        divided={divided}
        label={
          <View style={styles.rowLeft}>
            <GIcon name={item.icon} size={16} color={JaridaPurple[500]} />
            <Text style={styles.rowLabel}>{t(item.labelKey)}</Text>
          </View>
        }
      >
        <View style={styles.chevron}>
          <GIcon name="chevron" size={16} color={Grey[400]} />
        </View>
      </InkRow>
    </GPressable>
  );
});

export default function ProfileHub() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const devices = useDevices();
  const profiles = useProfiles();
  const { signOut, serverUrl } = useServer();
  const chrome = useChromeScroll();
  const bottomInset = useBottomBarInset();

  const me = profiles.data.profiles[0];

  const handleNav = useCallback(
    (route: string) => {
      void selectionTick();
      router.push(route as any);
    },
    [router],
  );
  const handleSignOut = useCallback(() => {
    void caution();
    void signOut();
  }, [signOut]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        {...chrome}
        contentContainerStyle={[styles.listContent, { paddingBottom: bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        <InkCard style={styles.profileCard}>
          <View style={styles.profileContent}>
            <View style={styles.avatarLarge}>
              <Text style={styles.avatarLargeText}>
                {me?.avatar_emoji || me?.display_name.charAt(0).toUpperCase() || '\u2014'}
              </Text>
            </View>
            <InkTitle level={2}>{me?.display_name ?? t('profile.noProfile')}</InkTitle>
            <InkText>
              {serverUrl ? hostOf(serverUrl) : t('profile.notPaired')}
            </InkText>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{devices.data.devices.length}</Text>
              <Text style={styles.statLabel}>{t('profile.devices')}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{devices.data.rooms.length}</Text>
              <Text style={styles.statLabel}>{t('profile.rooms')}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{profiles.data.profiles.length}</Text>
              <Text style={styles.statLabel}>{t('profile.people')}</Text>
            </View>
          </View>
        </InkCard>

        {PROFILE_NAV.map((group) => (
          <InkGroup key={group.groupKey} title={t(group.groupKey)} style={styles.group}>
            {group.items.map((item, i) => (
              <NavRow key={item.id} item={item} onPress={handleNav} divided={i > 0} />
            ))}
          </InkGroup>
        ))}

        <InkButton variant="danger" onPress={handleSignOut} style={styles.signOut}>
          {t('common.signOut')}
        </InkButton>
        <Text style={styles.versionText}>{t('profile.version', { version: APP_VERSION })}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  chevron: { transform: [{ rotate: '-90deg' }] },
  group: { marginBottom: Spacing.lg },
  signOut: { marginTop: Spacing.md, alignSelf: 'flex-start' },
  safe: { flex: 1, backgroundColor: c.background },
  listContent: { paddingHorizontal: Spacing.lg },

  /* Profile card */
  profileCard: {
    backgroundColor: c.card,
    borderRadius: Radii.xl,
    overflow: 'hidden',
    marginTop: Spacing.lg,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: c.border,
    ...Shadows.md,
  },
  charcoalBand: {
    height: 80,
    backgroundColor: Brand.charcoal,
  },
  profileContent: {
    alignItems: 'center',
    paddingBottom: Spacing.md,
  },
  avatarLarge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: JaridaPurple[500],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: c.background,
  },
  avatarLargeText: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize['2xl'],
    fontWeight: FontWeight.bold,
    color: Brand.white,
  },
  profileName: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: c.text,
    marginTop: Spacing.sm,
  },
  profileEmail: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: c.textTertiary,
    marginTop: 2,
  },
  proBadge: {
    backgroundColor: c.tintSoft,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radii.pill,
    marginTop: Spacing.sm,
  },
  proBadgeText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: JaridaPurple[600],
  },

  /* Stats row */
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
    backgroundColor: c.background,
    borderRadius: Radii.lg,
    paddingVertical: Spacing.md,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: c.text,
  },
  statLabel: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: c.textTertiary,
    marginTop: 2,
  },

  /* Section headers */

  /* Nav rows */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    marginBottom: 1,
    backgroundColor: c.card,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: c.border,
    marginTop: Spacing.xs,
  },
  rowPressed: {
    backgroundColor: c.tintSoft,
    borderColor: JaridaPurple[200],
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  rowLabel: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    fontWeight: FontWeight.medium,
    color: c.text,
  },

  /* Footer */
  footerSection: {
    alignItems: 'center',
    marginTop: Spacing['3xl'],
  },
  signOutBtn: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing['3xl'],
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Semantic.danger,
  },
  signOutText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Semantic.danger,
  },
  versionText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: Grey[400],
    marginTop: Spacing.lg,
  },
});
