/**
 * ProfileHub — the "You" tab: who this Pond knows you as, and everything that
 * configures it.
 *
 * The identity shown here is the member the Pond attributes this phone to, not
 * an account. There is no login and no email field anywhere in GIAP, so the
 * card reports that member and the Pond it came from rather than inventing a
 * user — and each figure under it is one read, shown as a dash when that read
 * failed rather than as a zero nobody counted.
 */

import React, { useCallback, useState } from 'react';
import {
  Alert,
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
import { initialOf, useHousehold } from '@/view-models/use-household';
import { useServer } from '@/providers/server-provider';
import { hostOf } from '@/services/discovery';
import { APP_VERSION } from '@/constants/app';
import { selectionTick, caution } from '@/services/haptics';
import { Grey, JaridaPurple, Brand } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';

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
  const { data: household } = useHousehold();
  const { unpair, serverUrl } = useServer();
  const [unpairing, setUnpairing] = useState(false);
  const chrome = useChromeScroll();
  const bottomInset = useBottomBarInset();

  // Only what the Pond said. The name is the member it attributes this phone to -- there is no
  // account, and so no email.
  const { member, pondName, counts } = household;
  const initial = member ? initialOf(member.displayName) : null;
  const stats = [
    { key: 'devices', label: t('profile.statDevices'), value: counts.devices },
    { key: 'rooms', label: t('profile.statRooms'), value: counts.rooms },
    { key: 'routines', label: t('profile.statRoutines'), value: counts.routines },
    { key: 'users', label: t('profile.statUsers'), value: counts.users },
  ];

  const handleNav = useCallback(
    (route: string) => {
      void selectionTick();
      router.push(route as any);
    },
    [router],
  );

  /**
   * Unpairing is not undoable from the phone: it revokes this device's session
   * on the Pond and releases its remote enrollment, so coming back means
   * pairing at home again. Worth one question first.
   */
  const confirmUnpair = useCallback(() => {
    void caution();
    Alert.alert(
      t('common.unpair'),
      t('profile.unpairWarning'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.unpair'),
          style: 'destructive',
          onPress: () => {
            setUnpairing(true);
            // The provider clears stored credentials and reconfigures the
            // connection, which leaves no stored pairing -- and the tab
            // layout's gate takes the app to pairing from there.
            void unpair()
              .catch(() => Alert.alert(t('common.unpair'), t('profile.unpairFailed')))
              .finally(() => setUnpairing(false));
          },
        },
      ],
    );
  }, [unpair, t]);

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
              {initial ? (
                <Text style={styles.avatarLargeText}>{initial}</Text>
              ) : (
                <GIcon name="home" size={28} color={Brand.white} />
              )}
            </View>
            <InkTitle level={2}>{member?.displayName ?? pondName ?? t('profile.yourPond')}</InkTitle>
            {member && pondName ? (
              <InkText>{t('profile.pairedTo', { pond: pondName })}</InkText>
            ) : serverUrl ? (
              <InkText>{hostOf(serverUrl)}</InkText>
            ) : null}
          </View>

          <View style={styles.statsRow}>
            {stats.map((stat) => (
              <View key={stat.key} style={styles.statItem}>
                <Text style={styles.statValue}>{stat.value ?? '—'}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>
        </InkCard>

        {PROFILE_NAV.map((group) => (
          <InkGroup key={group.groupKey} title={t(group.groupKey)} style={styles.group}>
            {group.items.map((item, i) => (
              <NavRow key={item.id} item={item} onPress={handleNav} divided={i > 0} />
            ))}
          </InkGroup>
        ))}

        {/* Signing out is also the only way to release a remote enrollment the
            Pond still calls active, so it has to work — and say that it is
            working, rather than take a second press for a second sign-out. */}
        <InkButton
          variant="danger"
          disabled={unpairing}
          onPress={confirmUnpair}
          style={styles.unpair}
        >
          {unpairing ? t('profile.unpairing') : t('common.unpair')}
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
  unpair: { marginTop: Spacing.md, alignSelf: 'flex-start' },
  safe: { flex: 1, backgroundColor: c.background },
  listContent: { paddingHorizontal: Spacing.lg },

  /* Profile card. InkCard draws its own face and plate, so its style carries
     layout only: a background, border or radius here paints a second card. */
  profileCard: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.xl,
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

  /* Nav rows */
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

  versionText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: Grey[400],
    marginTop: Spacing.lg,
  },
});
