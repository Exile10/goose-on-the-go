/**
 * HomeScreen — what the Pond is doing right now.
 *
 * The app is inert without a Pond, so its reachability is the first thing on
 * the screen rather than a grey line under the fold. Everything below it is
 * something the Pond actually told us: conversations it is holding, devices it
 * can see. Surfaces are Ink's printed plate, not a shadow.
 */

import React, { useCallback, useState } from 'react';
import {
  InkBadge,
  InkButton,
  InkCard,
  InkEmptyState,
  InkSwitch,
  InkText,
  InkTitle,
} from '@jarida/ink/native';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBottomBarInset, useChromeScroll } from '@/providers/chrome-provider';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { useRecentSessions } from '@/view-models/use-recent-sessions';
import { supports, useDevices } from '@/view-models/use-devices';
import { useProfiles } from '@/view-models/use-profiles';
import { useServer } from '@/providers/server-provider';
import { hostOf } from '@/services/discovery';
import { deviceStyle } from '@/constants/device-style';
import { toggle } from '@/services/haptics';
import type { Device } from '@/services/types';
import { Grey, JaridaPurple } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';

/** The home grid is a glance, not the full list — that is the Devices tab. */
const HOME_GRID_LIMIT = 4;

/** A greeting uses the name someone is called, not their full record. */
function firstName(displayName: string | undefined): string | null {
  const first = displayName?.trim().split(/\s+/)[0];
  return first || null;
}

function greetingKey(hour = new Date().getHours()) {
  if (hour < 5) return 'greeting.night' as const;
  if (hour < 12) return 'greeting.morning' as const;
  if (hour < 18) return 'greeting.afternoon' as const;
  return 'greeting.evening' as const;
}

/**
 * The Pond's reachability, as the page's opening statement.
 *
 * Three states, not two: until `hydrated` the stored URL has not been read
 * back, so claiming "unreachable" would be reporting a race rather than a
 * fact.
 */
function PondCard() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { online, serverUrl, checkHealth, hydrated } = useServer();
  const [checking, setChecking] = useState(false);
  const router = useRouter();

  const retry = useCallback(async () => {
    setChecking(true);
    try {
      await checkHealth();
    } finally {
      setChecking(false);
    }
  }, [checkHealth]);

  if (!hydrated) {
    return (
      <InkCard style={styles.pond}>
        <InkTitle level={2}>{t('pond.searching')}</InkTitle>
        <InkText>{t('pond.searchingBody')}</InkText>
      </InkCard>
    );
  }

  return (
    <InkCard style={styles.pond}>
      <View style={styles.pondTop}>
        <InkTitle level={2}>{t(online ? 'pond.connected' : 'pond.unreachable')}</InkTitle>
        <InkBadge tone={online ? 'success' : 'danger'}>
          {t(online ? 'common.online' : 'common.offline')}
        </InkBadge>
      </View>
      <InkText>{hostOf(serverUrl)}</InkText>
      <View style={styles.pondActions}>
        {online ? (
          <>
            <InkButton
              variant="primary"
              icon="chat"
              onPress={() => router.push('/conversation')}
            >
              {t('pond.askGoose')}
            </InkButton>
            <InkButton
              variant="quiet"
              icon="server"
              onPress={() => router.push('/(stack)/switch-pond')}
            >
              {t('pond.switch')}
            </InkButton>
          </>
        ) : (
          <>
            <InkButton variant="primary" disabled={checking} onPress={retry}>
              {t(checking ? 'pond.checking' : 'common.retry')}
            </InkButton>
            <InkButton variant="quiet" onPress={() => router.push('/(stack)/switch-pond')}>
              {t('pond.switch')}
            </InkButton>
          </>
        )}
      </View>
    </InkCard>
  );
}

/**
 * A device on the home grid. Same rules as the Devices tab: the switch appears
 * only where `capabilities` says the device accepts one, and its position comes
 * from what the device reported rather than from a default.
 */
const DeviceGridItem = React.memo(function DeviceGridItem({
  device,
  power,
  onToggle,
}: {
  device: Device;
  power: boolean | undefined;
  onToggle: (device: Device, on: boolean) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { icon, color } = deviceStyle(device);
  const canPower = supports(device, 'power');
  const on = power ?? false;
  const handleToggle = useCallback(
    (next: boolean) => {
      void toggle();
      onToggle(device, next);
    },
    [device, onToggle],
  );

  return (
    <InkCard style={styles.deviceCard}>
      <View style={styles.deviceCardTop}>
        <View style={[styles.deviceIconWrap, { backgroundColor: color + '1F' }]}>
          <GIcon name={icon} size={17} color={on && device.is_online ? color : Grey[500]} />
        </View>
        {canPower ? (
          <InkSwitch checked={on} onChange={handleToggle} disabled={!device.is_online} />
        ) : null}
      </View>
      <Text style={styles.deviceLabel} numberOfLines={1}>
        {device.name}
      </Text>
      <Text style={styles.deviceDetail}>
        {!device.is_online
          ? t('common.offline')
          : power === undefined
            ? t('common.online')
            : t(power ? 'common.on' : 'common.off')}
      </Text>
    </InkCard>
  );
});

export default function HomeScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { online, hydrated } = useServer();
  const offline = hydrated && !online;
  const recent = useRecentSessions();
  const devices = useDevices();
  const profiles = useProfiles();
  const router = useRouter();
  const chrome = useChromeScroll();
  const bottomInset = useBottomBarInset();

  const me = profiles.data.profiles[0];

  const handleDeviceToggle = useCallback(
    (device: Device, on: boolean) => void devices.actions.setState(device, { power: on }),
    [devices.actions],
  );

  const shown = devices.data.devices.slice(0, HOME_GRID_LIMIT);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        {...chrome}
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.greetingRow}>
          <View style={styles.greetingText}>
            <Text style={styles.greetingLabel}>{t(greetingKey())}</Text>
            <InkTitle level={1}>{firstName(me?.display_name) ?? t('home.you')}</InkTitle>
          </View>
          <GPressable feedback="lift"
            style={styles.avatar}
            onPress={() => router.push('/(tabs)/profile')}
            accessibilityRole="button"
            accessibilityLabel={t('screens.addUsers')}
          >
            <Text style={styles.avatarText}>
              {me?.avatar_emoji || me?.display_name.charAt(0).toUpperCase() || '—'}
            </Text>
          </GPressable>
        </View>

        <PondCard />

        {offline ? null : (
          <>
        <InkTitle level={3} style={styles.section}>
          {t('home.conversations')}
        </InkTitle>
        {recent.data.sessions.map((c) => (
          <GPressable
            key={c.id}
            style={styles.convoRow}
            onPress={() =>
              router.push({
                pathname: '/conversation',
                params: c.title ? { session: c.id, title: c.title } : { session: c.id },
              })
            }
          >
            <GIcon name="chat" size={14} color={JaridaPurple[400]} />
            <Text style={styles.convoText} numberOfLines={1}>
              {c.text}
            </Text>
            <Text style={styles.convoTime}>{c.time}</Text>
          </GPressable>
        ))}
        {!recent.loading && recent.data.sessions.length === 0 ? (
          <InkEmptyState icon="chat" title={t('home.noConversations')}>
            <InkText>{t('home.noConversationsBody')}</InkText>
          </InkEmptyState>
        ) : null}

        <View style={styles.sectionHeader}>
          <InkTitle level={3}>{t('home.devices')}</InkTitle>
          <GPressable onPress={() => router.push('/(tabs)/devices')}>
            <Text style={styles.seeAllText}>{t('common.seeAll')}</Text>
          </GPressable>
        </View>
        {shown.length > 0 ? (
          <View style={styles.devicesGrid}>
            {shown.map((d) => (
              <DeviceGridItem
                key={d.id}
                device={d}
                power={devices.data.powerById[d.id]}
                onToggle={handleDeviceToggle}
              />
            ))}
          </View>
        ) : null}
        {/* An empty grid used to render as a blank gap, which reads as a broken
            screen rather than as an absence. */}
        {!devices.loading && shown.length === 0 ? (
          <InkEmptyState
            icon="device"
            title={t('home.noDevices')}
            action={
              <InkButton
                variant="primary"
                onPress={() => router.push('/(stack)/commission-device')}
              >
                Add a device
              </InkButton>
            }
          >
            <InkText>{t('home.noDevicesBody')}</InkText>
          </InkEmptyState>
        ) : null}
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.background },
  scroll: { paddingHorizontal: Spacing.lg },

  greetingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  greetingText: { flex: 1 },
  greetingLabel: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: c.textTertiary,
  },
  greetingName: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize['3xl'],
    fontWeight: FontWeight.bold,
    color: c.text,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: JaridaPurple[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: '#FFFFFF',
  },

  /* The plate sits 4px below the face, so every card reserves room for it. */
  pond: { marginBottom: Spacing.lg },
  pondTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  pondActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    flexWrap: 'wrap',
  },

  section: { marginBottom: Spacing.sm },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  seeAllText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: JaridaPurple[600],
  },

  convoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  convoText: {
    flex: 1,
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: c.text,
  },
  convoTime: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: c.textTertiary,
  },

  devicesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  deviceCard: { width: '47%' },
  deviceIconWrap: {
    width: 34,
    height: 34,
    borderRadius: Radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  deviceLabel: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: c.text,
  },
  deviceDetail: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: c.textTertiary,
  },
});
