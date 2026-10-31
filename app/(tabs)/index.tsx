/**
 * HomeScreen — whether the Pond wants anything from you, and what is happening at home.
 *
 * In that order: the suggestions it is waiting on and the questions it offers come before the
 * facts, because they are the part that needs a person. Everything is something the Pond actually
 * told us, and a section with nothing true to say is not drawn. The raised edge is spent on the
 * suggestions alone; the facts, conversations and devices sit on hairlines, so the screen can hold
 * more of them without every one shouting.
 */

import React, { useCallback, useState } from 'react';
import {
  InkBadge,
  InkButton,
  InkCard,
  InkEmptyState,
  InkNotice,
  InkSwitch,
  InkText,
  InkTitle,
  inkText,
  useInkTheme,
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
import { FinishSetup } from '@/components/patterns/finish-setup';
import { AgentsGettingReady } from '@/components/patterns/agents-building';
import { PondGettingReady } from '@/components/patterns/pond-getting-ready';
import { RemoteAccessOffer } from '@/components/patterns/remote-access-offer';
import { AskRow, HomeIdeas } from '@/components/patterns/home-ideas';
import { RightNowLedger } from '@/components/patterns/right-now-ledger';
import { homeLedger } from '@/view-models/home-ledger';
import { useHomeIdeas, type PondPrompt } from '@/view-models/use-home-ideas';
import { useRecentSessions } from '@/view-models/use-recent-sessions';
import { supports, useDevices } from '@/view-models/use-devices';
import { initialOf, useMember } from '@/view-models/use-household';
import { useRightNow } from '@/view-models/use-right-now';
import { useLive } from '@/view-models/use-live';
import { useServer } from '@/providers/server-provider';
import { hostOf } from '@/services/discovery';
import { deviceStyle } from '@/constants/device-style';
import { toggle } from '@/services/haptics';
import type { Device } from '@/services/types';
import { Brand, Grey, JaridaPurple, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';

/** The home grid is a glance, not the full list — that is the Devices tab. Three rows of two. */
const HOME_GRID_LIMIT = 6;

/** How often the greeting and the countdowns catch up with the clock. */
const CLOCK_MS = 60_000;

/** A greeting uses the name someone is called, not their full record. */
function firstName(displayName: string | undefined): string | null {
  const first = displayName?.trim().split(/\s+/)[0];
  return first || null;
}

function greetingKey(hour: number) {
  if (hour < 5) return 'greeting.night' as const;
  if (hour < 12) return 'greeting.morning' as const;
  if (hour < 18) return 'greeting.afternoon' as const;
  return 'greeting.evening' as const;
}

/**
 * The Pond, while it is not plainly there.
 *
 * Three states, not two: until `hydrated` the stored URL has not been read
 * back, so claiming "unreachable" would be reporting a race rather than a
 * fact. A reconnect in progress is the same kind of not-yet: it said
 * "unreachable" for the six seconds a cold start on cellular takes to bring the
 * tailnet up, beside a banner saying it was reconnecting. Connected, it is the
 * line under the name (`PondLine`), and this draws nothing.
 */
function PondCard() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { online, serverUrl, checkHealth, hydrated, connectionState } = useServer();
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

  if (!hydrated || connectionState === 'reconnecting') {
    return (
      <InkCard style={styles.pond}>
        <InkTitle level={2}>{t('pond.searching')}</InkTitle>
        <InkText>{hydrated ? t('pond.connectingBody') : t('pond.searchingBody')}</InkText>
      </InkCard>
    );
  }

  if (online) return null;

  return (
    <InkCard style={styles.pond}>
      <View style={styles.pondTop}>
        <InkTitle level={2}>{t('pond.unreachable')}</InkTitle>
        <InkBadge tone="danger">{t('common.offline')}</InkBadge>
      </View>
      <InkText>{hostOf(serverUrl)}</InkText>
      <View style={styles.pondActions}>
        <InkButton variant="primary" disabled={checking} onPress={retry}>
          {t(checking ? 'pond.checking' : 'common.retry')}
        </InkButton>
        <InkButton variant="quiet" onPress={() => router.push('/(stack)/switch-pond')}>
          {t('pond.switch')}
        </InkButton>
      </View>
    </InkCard>
  );
}

/**
 * The Pond, connected: one line under the name rather than a card. It took a third of the screen
 * to say "connected" and offer two buttons; Ask Goose is now in the Ask row, and this line is the
 * way to another Pond.
 */
function PondLine() {
  const theme = useInkTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { online, serverUrl, hydrated, connectionState } = useServer();
  const router = useRouter();

  if (!hydrated || !online || connectionState === 'reconnecting') return null;

  return (
    <GPressable
      style={styles.pondLine}
      hitSlop={8}
      onPress={() => router.push('/(stack)/switch-pond')}
      accessibilityRole="button"
      accessibilityHint={t('pond.switch')}
    >
      <View style={styles.pondDot} />
      <Text style={inkText(theme, { size: 'sm', color: theme.color.textSecondary }).style} numberOfLines={1}>
        {t('home.connectedTo', { host: hostOf(serverUrl) })}
      </Text>
    </GPressable>
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
    <InkCard raised={false} style={styles.deviceCard}>
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
  // The member the Pond attributes this phone to. No name when nobody has
  // claimed it — the first household profile is not necessarily whoever holds
  // this phone.
  const member = useMember();
  const rightNow = useRightNow().data;
  // One read of the Pond's ideas for the whole screen; the sections below take their parts.
  const ideas = useHomeIdeas();
  const router = useRouter();
  const chrome = useChromeScroll();
  const bottomInset = useBottomBarInset();

  // The clock is state, advanced once a minute while Home is in front, so render stays pure and
  // the greeting and "in 23 h" move with the time instead of freezing at the moment Home mounted.
  const [now, setNow] = useState(() => new Date());
  useLive(async () => setNow(new Date()), CLOCK_MS);

  const initial = member ? initialOf(member.displayName) : null;

  const handleDeviceToggle = useCallback(
    (device: Device, on: boolean) => void devices.actions.setState(device, { power: on }),
    [devices.actions],
  );

  const shown = devices.data.devices.slice(0, HOME_GRID_LIMIT);

  // The online count is the list the grid below shows, so the two cannot
  // disagree, and it is not stated while that list is unknown.
  const devicesKnown = !devices.loading && !devices.error;
  const ledger = homeLedger({
    ...rightNow,
    now,
    devices: devicesKnown ? { online: devices.data.onlineCount, total: devices.data.devices.length } : null,
    reminders: ideas.data.reminders,
  });

  const ask = useCallback(
    (prompt: PondPrompt) => {
      ideas.actions.taken(prompt);
      router.push({ pathname: '/conversation', params: { ask: prompt.prompt } });
    },
    [ideas.actions, router],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        {...chrome}
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.greetingRow}>
          <View style={styles.greetingText}>
            <Text style={styles.greetingLabel}>{t(greetingKey(now.getHours()))}</Text>
            <InkTitle level={1}>{firstName(member?.displayName) ?? t('home.you')}</InkTitle>
            <PondLine />
          </View>
          <GPressable feedback="lift"
            style={styles.avatar}
            onPress={() => router.push('/(tabs)/profile')}
            accessibilityRole="button"
            accessibilityLabel={t('tabs.you')}
          >
            {initial ? (
              <Text style={styles.avatarText}>{initial}</Text>
            ) : (
              <GIcon name="home" size={18} color={Brand.white} />
            )}
          </GPressable>
        </View>

        <PondCard />

        {/* Offered once per pairing, and declinable. It draws nothing unless
            the Pond is reachable and remote access is off, so it sits under the
            card that says the Pond is reachable. */}
        {/* Whether Goose can answer yet matters more than reaching it from away, so it comes first. */}
        <PondGettingReady />
        <AgentsGettingReady />
        <FinishSetup />
        <RemoteAccessOffer />

        {offline ? null : (
          <>
        {/* "Nothing needs you" only once both reads have answered; a failed one is unknown, not quiet. */}
        {ideas.quiet && !ideas.data.agent && !ideas.outcome ? (
          <InkText size="sm" tone="secondary" style={styles.quiet}>
            {t('home.ideas.quiet')}
          </InkText>
        ) : (
          <HomeIdeas
            proposals={ideas.data.proposals}
            moreProposals={ideas.data.moreProposals}
            agent={ideas.data.agent}
            deciding={ideas.deciding}
            outcome={ideas.outcome}
            onAccept={(id) => void ideas.actions.approve(id)}
            onDecline={(id) => void ideas.actions.decline(id)}
          />
        )}

        <AskRow prompts={ideas.data.prompts} onAsk={ask} onAskGoose={() => router.push('/conversation')} />

        {/* A line with nothing true to say is not drawn, and a ledger with no
            lines has no heading. */}
        {ledger.length > 0 ? (
          <>
            <InkTitle level={3} style={styles.section}>
              {t('home.rightNowTitle')}
            </InkTitle>
            <RightNowLedger
              entries={ledger}
              onOpen={{
                next: () => router.push('/(stack)/schedule'),
                devices: () => router.push('/(tabs)/devices'),
                remember: () => router.push('/(stack)/reminders'),
              }}
            />
          </>
        ) : null}

        <View style={styles.sectionHeader}>
          <InkTitle level={3}>{t('home.conversations')}</InkTitle>
          <GPressable onPress={() => router.push('/(tabs)/chat')}>
            <Text style={styles.seeAllText}>{t('common.seeAll')}</Text>
          </GPressable>
        </View>
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
        {/* Say why the strip is empty: a read that failed is not "no
            conversations yet". */}
        {!recent.loading && recent.data.sessions.length === 0 ? (
          recent.error ? (
            <InkNotice tone="danger">{recent.error}</InkNotice>
          ) : (
            <InkEmptyState icon="chat" title={t('home.noConversations')}>
              <InkText>{t('home.noConversationsBody')}</InkText>
            </InkEmptyState>
          )
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
            screen rather than as an absence. A list that failed to load is
            neither, and says so. */}
        {!devices.loading && shown.length === 0 ? (
          devices.error ? (
            <InkNotice tone="danger">{devices.error}</InkNotice>
          ) : (
            <InkEmptyState
              icon="device"
              title={t('home.noDevices')}
              action={
                <InkButton
                  variant="primary"
                  onPress={() => router.push('/(stack)/commission-device')}
                >
                  {t('home.addDevice')}
                </InkButton>
              }
            >
              <InkText>{t('home.noDevicesBody')}</InkText>
            </InkEmptyState>
          )
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
    color: Brand.white,
  },

  pondLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
    marginTop: Spacing.xs,
    alignSelf: 'flex-start',
  },
  pondDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Semantic.success },
  quiet: { marginBottom: Spacing.lg },

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
    color: c.textBrand,
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
    // `space-between` rather than a column gap, so the pair spans the full
    // content width and its right edge lands where the Right now row's does.
    // At 47% plus a gap the grid stopped ~25px short of every other card on
    // the screen, which is the ragged edge under "Devices".
    justifyContent: 'space-between',
    rowGap: Spacing.md,
  },
  deviceCard: { width: '48%' },
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
