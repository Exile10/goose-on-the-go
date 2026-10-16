/**
 * The You tab, laid out as iPhone Settings: each row says how its setting stands, so the menu
 * answers "what is on" by itself. GIAP has no login, so the card is the member the Pond names.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InkButton } from '@jarida/ink/native';

import { SwitchRow } from '@/components/settings/setting-controls';
import { SettingsGroup, SettingsRow, TILE_INSET } from '@/components/settings/settings-list';
import { useSettingsColors, useSettingsStyles, type SettingsColors } from '@/components/settings/settings-theme';
import { GIcon } from '@/components/ui/g-icon';
import { APP_VERSION } from '@/constants/app';
import { Brand, JaridaPurple } from '@/constants/colors';
import { ACCOUNT_ROUTE, PROFILE_NAV } from '@/constants/navigation';
import { Spacing } from '@/constants/spacing';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import type { SummaryId } from '@/models/pond-settings';
import { useBottomBarInset, useChromeScroll } from '@/providers/chrome-provider';
import { useServer } from '@/providers/server-provider';
import { hostOf } from '@/services/discovery';
import { caution, hapticsEnabled, saveHapticsPreference, selectionTick } from '@/services/haptics';
import { initialOf, useHousehold } from '@/view-models/use-household';
import { usePondSettings } from '@/view-models/use-pond-settings';
import { summarize, useSummaryExtras } from '@/view-models/use-settings-extras';

const SUMMARY_IDS: SummaryId[] = PROFILE_NAV.flatMap((group) =>
  group.items.flatMap((item) => (item.summary ? [item.summary] : [])),
);

function AccountRow({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  const { data: household } = useHousehold();
  const { serverUrl } = useServer();
  const { member, pondName, counts } = household;
  const initial = member ? initialOf(member.displayName) : null;
  const subtitle = member && pondName ? t('profile.pairedTo', { pond: pondName }) : serverUrl ? hostOf(serverUrl) : null;
  const tally = [
    counts.devices === null ? null : t('settings.account.devices', { count: counts.devices }),
    counts.rooms === null ? null : t('settings.account.rooms', { count: counts.rooms }),
    counts.users === null ? null : t('settings.account.people', { count: counts.users }),
  ].filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={member?.displayName ?? pondName ?? t('profile.yourPond')}
      accessibilityHint={t('settings.account.hint')}
      style={({ pressed }) => [styles.account, pressed && { backgroundColor: colors.pressed }]}
    >
      <View style={styles.avatar}>
        {initial ? <Text style={styles.avatarText}>{initial}</Text> : <GIcon name="home" size={26} color={Brand.white} />}
      </View>
      <View style={styles.accountText}>
        <Text style={styles.accountName} numberOfLines={1}>
          {member?.displayName ?? pondName ?? t('profile.yourPond')}
        </Text>
        {subtitle ? <Text style={styles.accountSub} numberOfLines={1}>{subtitle}</Text> : null}
        {tally ? <Text style={styles.accountSub} numberOfLines={1}>{tally}</Text> : null}
      </View>
      <GIcon name="chevron-right" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

export default function ProfileHub() {
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  const { t } = useTranslation();
  const router = useRouter();
  const { unpair } = useServer();
  const [unpairing, setUnpairing] = useState(false);
  const [hapticsOn, setHapticsOn] = useState(hapticsEnabled);
  const chrome = useChromeScroll();
  const bottomInset = useBottomBarInset();
  const { settings } = usePondSettings();
  const extras = useSummaryExtras(SUMMARY_IDS);

  const go = useCallback(
    (route: string) => {
      void selectionTick();
      router.push(route as never);
    },
    [router],
  );

  const values = useMemo(
    () => Object.fromEntries(SUMMARY_IDS.map((id) => [id, summarize(id, settings, extras, t)])) as Record<SummaryId, string | null>,
    [settings, extras, t],
  );

  // Unpairing revokes this phone on the Pond and releases its remote enrollment; it cannot be undone here.
  const confirmUnpair = useCallback(() => {
    void caution();
    Alert.alert(t('common.unpair'), t('profile.unpairWarning'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.unpair'),
        style: 'destructive',
        onPress: () => {
          setUnpairing(true);
          void unpair()
            .catch(() => Alert.alert(t('common.unpair'), t('profile.unpairFailed')))
            .finally(() => setUnpairing(false));
        },
      },
    ]);
  }, [unpair, t]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.page }]} edges={['top']}>
      <ScrollView
        {...chrome}
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset + Spacing.lg }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title} accessibilityRole="header">
          {t('screens.settings')}
        </Text>

        <SettingsGroup>
          <AccountRow onPress={() => go(ACCOUNT_ROUTE)} />
        </SettingsGroup>

        {PROFILE_NAV.map((group) => (
          <View key={group.groupKey} accessibilityLabel={t(group.groupKey)}>
            <SettingsGroup inset={TILE_INSET}>
              {group.items.map((item) => (
                <SettingsRow
                  key={item.id}
                  label={t(item.labelKey)}
                  icon={item.icon}
                  tile={item.tile}
                  value={item.summary ? values[item.summary] : null}
                  accessory="next"
                  onPress={() => go(item.route)}
                />
              ))}
              {group.groupKey === 'settings.menu.phone' ? (
                <SwitchRow
                  key="haptics"
                  label={t('settings.hapticsLabel')}
                  value={hapticsOn}
                  onChange={(next) => {
                    setHapticsOn(next);
                    void saveHapticsPreference(next);
                  }}
                />
              ) : null}
            </SettingsGroup>
          </View>
        ))}

        {/* Signing out is also the only way to release a remote enrollment the Pond still calls
            active, so it has to work, and say that it is working. */}
        <InkButton variant="danger" disabled={unpairing} onPress={confirmUnpair} style={styles.unpair}>
          {unpairing ? t('profile.unpairing') : t('common.unpair')}
        </InkButton>
        <Text style={styles.version}>{t('profile.version', { version: APP_VERSION })}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: SettingsColors) => ({
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg },
  title: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize['3xl'],
    fontWeight: FontWeight.bold,
    letterSpacing: -0.5,
    color: c.text,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
    marginLeft: Spacing.xs,
  },
  account: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: JaridaPurple[500],
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  avatarText: { fontFamily: FontFamily.heading, fontSize: FontSize['2xl'], fontWeight: FontWeight.bold, color: Brand.white },
  accountText: { flex: 1, gap: 2 },
  accountName: { fontFamily: FontFamily.heading, fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: c.text },
  accountSub: { fontFamily: FontFamily.body, fontSize: FontSize.sm, color: c.textSecondary },
  unpair: { alignSelf: 'flex-start' as const, marginTop: Spacing.sm },
  version: { fontFamily: FontFamily.body, fontSize: FontSize.xs, color: c.textTertiary, marginTop: Spacing.lg },
});
