/**
 * The You tab, laid out as iPhone Settings: each row says how its setting stands, so the menu
 * answers "what is on" by itself. GIAP has no login, so the card is the member the Pond names.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InkButton, InkEdge, InkTitle } from '@jarida/ink/native';

import { IssueRows } from '@/components/settings/issue-page';
import { PAGE_GUTTER } from '@/components/settings/settings-scroll';
import { SwitchRow } from '@/components/settings/setting-controls';
import { SettingsGroup, SettingsRow, TILE_INSET } from '@/components/settings/settings-list';
import { useSettingsColors, useSettingsStyles, type SettingsColors, type SettingsType } from '@/components/settings/settings-theme';
import { GIcon } from '@/components/ui/g-icon';
import { APP_VERSION } from '@/constants/app';
import { Brand, JaridaPurple } from '@/constants/colors';
import { ACCOUNT_ROUTE, PROFILE_NAV } from '@/constants/navigation';
import { Spacing } from '@/constants/spacing';
import type { SummaryId } from '@/models/pond-settings';
import { useBottomBarInset, useChromeScroll } from '@/providers/chrome-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { useServer } from '@/providers/server-provider';
import { hostOf } from '@/services/discovery';
import { hapticsEnabled, saveHapticsPreference, selectionTick } from '@/services/haptics';
import { initialOf, useHousehold } from '@/view-models/use-household';
import { usePondSettings } from '@/view-models/use-pond-settings';
import { summarize, useSummaryExtras } from '@/view-models/use-settings-extras';
import { useSettingsIssues } from '@/view-models/use-settings-issues';

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
  const [pressed, setPressed] = useState(false);
  const initial = member ? initialOf(member.displayName) : null;
  const subtitle = member && pondName ? t('profile.pairedTo', { pond: pondName }) : serverUrl ? hostOf(serverUrl) : null;
  const tally = [
    counts.devices === null ? null : t('settings.account.devices', { count: counts.devices }),
    counts.rooms === null ? null : t('settings.account.rooms', { count: counts.rooms }),
    counts.users === null ? null : t('settings.account.people', { count: counts.users }),
  ].filter(Boolean).join(' · ');

  // The one raised card on the screen: a press drives its face down onto the plate.
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={member?.displayName ?? pondName ?? t('profile.yourPond')}
      accessibilityHint={t('settings.account.hint')}
      style={styles.accountWrap}
    >
      <InkEdge state={pressed ? 'pressed' : 'rest'} contentStyle={styles.account}>
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
      <GIcon name="chevron-right" size={18} color={colors.textTertiary} strokeWidth={2.5} />
      </InkEdge>
    </Pressable>
  );
}

export default function ProfileHub() {
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  const { t } = useTranslation();
  const router = useRouter();
  const { unpair } = useServer();
  const confirm = useConfirm();
  const [unpairing, setUnpairing] = useState(false);
  const [hapticsOn, setHapticsOn] = useState(hapticsEnabled);
  const chrome = useChromeScroll();
  const bottomInset = useBottomBarInset();
  const { settings } = usePondSettings();
  const issues = useSettingsIssues();
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
  const confirmUnpair = useCallback(async () => {
    const yes = await confirm({
      title: t('common.unpair'),
      message: t('profile.unpairWarning'),
      confirmLabel: t('common.unpair'),
      destructive: true,
    });
    if (!yes) return;
    setUnpairing(true);
    void unpair()
      .catch(() => Alert.alert(t('common.unpair'), t('profile.unpairFailed')))
      .finally(() => setUnpairing(false));
  }, [confirm, unpair, t]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.page }]} edges={['top']}>
      <ScrollView
        {...chrome}
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset + Spacing.lg }]}
        showsVerticalScrollIndicator={false}
      >
        <InkTitle style={styles.title}>{t('screens.settings')}</InkTitle>

        <IssueRows issues={issues} />

        <AccountRow onPress={() => go(ACCOUNT_ROUTE)} />

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
        <InkButton variant="danger" disabled={unpairing} onPress={() => void confirmUnpair()} style={styles.unpair}>
          {unpairing ? t('profile.unpairing') : t('common.unpair')}
        </InkButton>
        <Text style={styles.version}>{t('profile.version', { version: APP_VERSION })}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: SettingsColors, type: SettingsType) => ({
  safe: { flex: 1 },
  content: { paddingHorizontal: PAGE_GUTTER },
  title: { marginTop: Spacing.md, marginBottom: Spacing.lg },
  accountWrap: { marginBottom: Spacing.xl },
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
  avatarText: { ...type.heading, fontSize: 24, lineHeight: 30, color: Brand.white },
  accountText: { flex: 1, gap: 2 },
  accountName: { ...type.heading, fontSize: 20, lineHeight: 25 },
  accountSub: type.description,
  unpair: { alignSelf: 'flex-start' as const, marginTop: Spacing.sm },
  version: { ...type.mono, marginTop: Spacing.lg },
});
