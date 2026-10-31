/**
 * HomeScreen — what the Pond is doing right now.
 *
 * The app is inert without a Pond, so its reachability is the first thing on
 * the screen rather than a grey line under the fold. Everything below it is
 * something the Pond actually told us: what is playing, the next routine,
 * conversations it is holding, devices it can see. A card with nothing true to
 * say is not drawn. Surfaces are Ink's printed plate, not a shadow.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  InkBadge,
  InkButton,
  InkCard,
  InkEmptyState,
  InkSwitch,
  InkText,
  InkTitle,
  inkText,
  useInkTheme,
} from '@jarida/ink/native';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBottomBarInset, useChromeScroll } from '@/providers/chrome-provider';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { EqualizerBars } from '@/components/ui/equalizer-bars';
import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { GlanceStrip, type Figure } from '@/components/patterns/glance-strip';
import { HomeIdeas } from '@/components/patterns/home-ideas';
import { PondSays } from '@/components/patterns/pond-says';
import { FinishSetup } from '@/components/patterns/finish-setup';
import { AgentsGettingReady } from '@/components/patterns/agents-building';
import { PondGettingReady } from '@/components/patterns/pond-getting-ready';
import { RemoteAccessOffer } from '@/components/patterns/remote-access-offer';
import { isUnavailable } from '@/models/content-state';
import { useActivitySummary } from '@/view-models/use-activity-summary';
import { useHomeIdeas } from '@/view-models/use-home-ideas';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { useRecentSessions } from '@/view-models/use-recent-sessions';
import { supports, useDevices } from '@/view-models/use-devices';
import { initialOf, useMember } from '@/view-models/use-household';
import { untilOf, useRightNow, type NextRoutine, type NowPlaying } from '@/view-models/use-right-now';
import { useLive } from '@/view-models/use-live';
import { useServer } from '@/providers/server-provider';
import { hostOf } from '@/services/discovery';
import { deviceStyle } from '@/constants/device-style';
import { toggle } from '@/services/haptics';
import type { Device } from '@/services/types';
import { Brand, Grey } from '@/constants/colors';
import { FontSize, face } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';

/**
 * The type the Right now cards are set in, from Ink's own scale rather than by hand.
 *
 * The eyebrow is the mono micro-label the tracking scale was built for: at 0.14em it separates
 * the card's label from its content without a rule or a box. Sentence case, not caps -- the
 * tracking is what does the separating, and a tracked-out capital label above every heading is
 * the commonest tell of a page nobody chose the type for. The title is display at -0.02em,
 * because a bold face reads looser the larger it is set and the negative tracking is what takes
 * that back. Leading tightens as the size grows, for the same reason.
 */
function useCardType() {
  const theme = useInkTheme();
  return useMemo(
    () => ({
      eyebrow: inkText(theme, {
        role: 'mono',
        size: 'xs',
        tracking: 'eyebrow',
        color: theme.color.textTertiary,
      }).style,
      title: inkText(theme, {
        role: 'display',
        size: 'md',
        weight: theme.weight.bold,
        tracking: 'title',
        leading: 'tight',
      }).style,
      detail: inkText(theme, { size: 'sm', color: theme.color.textSecondary }).style,
    }),
    [theme],
  );
}

/** The home grid is a glance, not the full list — that is the Devices tab. */
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
 * The Pond, as the page's opening statement.
 *
 * Connected, it says so beside the Pond's address and offers the two things to do with it. Not
 * connected, it says nothing about why: the connection indicator at the top of the app is already
 * saying that, with the action for it, and this card used to repeat it underneath as "Pond
 * unreachable", a red OFFLINE badge and a second Try again. What it keeps is what only it offers --
 * switching to another Pond -- and a line on what Home will show once the connection is back.
 *
 * Until `hydrated` the stored URL has not been read back, so the card says it is looking rather
 * than claiming anything about reachability.
 */
function PondCard() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { online, serverUrl, hydrated } = useServer();
  const router = useRouter();

  if (!hydrated) {
    return (
      <InkCard style={styles.pond}>
        <InkTitle level={2}>{t('pond.searching')}</InkTitle>
        <InkText>{t('pond.searchingBody')}</InkText>
      </InkCard>
    );
  }

  if (!online) {
    return (
      <InkCard style={styles.pond}>
        <InkTitle level={2}>{t('pond.yours')}</InkTitle>
        <InkText>{t('pond.waitingBody')}</InkText>
        <View style={styles.pondActions}>
          <InkButton variant="quiet" icon="server" onPress={() => router.push('/(stack)/switch-pond')}>
            {t('pond.switch')}
          </InkButton>
        </View>
      </InkCard>
    );
  }

  return (
    <InkCard style={styles.pond}>
      <View style={styles.pondTop}>
        <InkTitle level={2}>{t('pond.connected')}</InkTitle>
        <InkBadge tone="success">{t('common.online')}</InkBadge>
      </View>
      <InkText>{hostOf(serverUrl)}</InkText>
      <View style={styles.pondActions}>
        <InkButton variant="primary" icon="chat" onPress={() => router.push('/conversation')}>
          {t('pond.askGoose')}
        </InkButton>
        <InkButton variant="quiet" icon="server" onPress={() => router.push('/(stack)/switch-pond')}>
          {t('pond.switch')}
        </InkButton>
      </View>
    </InkCard>
  );
}

/**
 * What is playing. Idle is said in words; the bars move only while something
 * plays, because bars over silence would say music is on. They hold still
 * under Reduce Motion and when Home is not in front.
 */
function NowPlayingCard({ playing }: { playing: NowPlaying }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const theme = useInkTheme();
  const type = useCardType();

  return (
    <InkCard style={styles.rightNowCard} contentStyle={styles.rightNowFace}>
      <Text style={[styles.cardEyebrow, type.eyebrow]}>{t('home.nowPlaying')}</Text>
      {playing.state === 'playing' ? (
        <>
          <Text style={type.title} numberOfLines={2}>
            {playing.track}
          </Text>
          {playing.artist ? (
            <Text style={type.detail} numberOfLines={1}>
              {playing.artist}
            </Text>
          ) : null}
          <View style={styles.waveformRow}>
            <EqualizerBars color={theme.color.accentLine} />
          </View>
        </>
      ) : (
        <Text style={type.title}>{t('home.nothingPlaying')}</Text>
      )}
    </InkCard>
  );
}

/**
 * The soonest routine that will actually run. Labelled a routine, never an
 * event: the data is the Pond's own schedules, not a calendar.
 */
function NextRoutineCard({ routine, now }: { routine: NextRoutine; now: Date }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const type = useCardType();
  const until = untilOf(routine.nextRun, now);

  return (
    <InkCard style={styles.rightNowCard} contentStyle={styles.rightNowFace}>
      <Text style={[styles.cardEyebrow, type.eyebrow]}>{t('home.nextRoutine')}</Text>
      <Text style={type.title} numberOfLines={2}>
        {routine.label}
      </Text>
      <Text style={[type.detail, styles.cardClock]}>
        {routine.nextRun.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
      </Text>
      <View style={styles.routineBadge}>
        <InkBadge tone="warning">
          {until.unit === 'now'
            ? t('home.dueNow')
            : until.unit === 'minutes'
              ? t('home.inMinutes', { count: until.count })
              : until.unit === 'hours'
                ? t('home.inHours', { count: until.count })
                : t('home.inDays', { count: until.count })}
        </InkBadge>
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
  const theme = useInkTheme();
  const { online, hydrated } = useServer();
  const offline = hydrated && !online;
  const recent = useRecentSessions();
  const devices = useDevices();
  // The member the Pond attributes this phone to. No name when nobody has
  // claimed it — the first household profile is not necessarily whoever holds
  // this phone.
  const member = useMember();
  const rightNow = useRightNow().data;
  const today = useActivitySummary().data.summary?.total ?? null;
  // One read for both the sentence at the top and the chips below it.
  const ideas = useHomeIdeas();
  const router = useRouter();
  const chrome = useChromeScroll();
  const bottomInset = useBottomBarInset();

  // The clock is state, advanced once a minute while Home is in front, so render stays pure and
  // the greeting and "in 23 h" move with the time instead of freezing at the moment Home mounted.
  const [now, setNow] = useState(() => new Date());
  useLive(async () => setNow(new Date()), CLOCK_MS);

  const initial = member ? initialOf(member.displayName) : null;
  const { nowPlaying, nextRoutine } = rightNow;

  const handleDeviceToggle = useCallback(
    (device: Device, on: boolean) => void devices.actions.setState(device, { power: on }),
    [devices.actions],
  );

  const shown = devices.data.devices.slice(0, HOME_GRID_LIMIT);
  const recentState = useContentState({
    loading: recent.loading,
    failed: recent.failed,
    hasContent: recent.data.sessions.length > 0,
  });
  const devicesState = useContentState({ loading: devices.loading, failed: devices.failed, hasContent: shown.length > 0 });
  // Home's pull reads both of the Pond's lists on it: recent conversations and the devices.
  const reloadHome = useCallback(
    () => Promise.all([recent.actions.refresh(), devices.actions.refresh()]),
    [recent.actions, devices.actions],
  );
  const pull = usePullToRefresh(reloadHome);

  // The online count is the list the grid below shows, so the two cannot
  // disagree, and it is not stated while that list is unknown.
  const showOnlineCount = devicesState === 'ready' || devicesState === 'empty';
  const showOutdoor = rightNow.outdoorTemp !== null;

  // Only phrases with a source behind them; the line hides when there are none.
  const figures: Figure[] = [];
  if (showOnlineCount) {
    figures.push({ key: 'devices', phrase: t('home.lineDevicesOn', { count: devices.data.onlineCount }) });
  }
  if (showOutdoor) {
    figures.push({
      key: 'outdoor',
      // Where the Pond is configured to be, which is not always where the reader is.
      phrase: rightNow.outdoorPlace
        ? t('home.lineOutdoorPlace', { temp: rightNow.outdoorTemp, place: rightNow.outdoorPlace })
        : t('home.lineOutdoor', { temp: rightNow.outdoorTemp }),
    });
  }
  if (today !== null) {
    figures.push({ key: 'today', phrase: t('home.lineToday', { count: today }) });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        {...chrome}
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pull} />}
      >
        <View style={styles.greetingRow}>
          <View style={styles.greetingText}>
            <Text style={styles.greetingLabel}>
              {t(greetingKey(now.getHours()))}
              {member?.displayName ? `, ${firstName(member.displayName)}` : ''}
            </Text>
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

        {offline ? null : (
          <PondSays
            lead={ideas.data.lead}
            reminderCount={ideas.data.reminderCount}
            deciding={ideas.deciding}
            onAccept={(id) => void ideas.actions.approve(id)}
            onDecline={(id) => void ideas.actions.decline(id)}
          />
        )}

        {offline ? null : <GlanceStrip figures={figures} />}

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
        <HomeIdeas />

        {/* A card with nothing true to say is not drawn, and a row with no
            cards has no heading. */}
        {nowPlaying || nextRoutine ? (
          <>
            <InkTitle level={3} style={styles.section}>
              {t('home.rightNowTitle')}
            </InkTitle>
            <View style={styles.rightNowRow}>
              {nowPlaying ? <NowPlayingCard playing={nowPlaying} /> : null}
              {nextRoutine ? <NextRoutineCard routine={nextRoutine} now={now} /> : null}
            </View>
          </>
        ) : null}

        <View style={styles.sectionHeader}>
          <InkTitle level={3}>{t('home.conversations')}</InkTitle>
          <GPressable
            onPress={() => router.push('/(tabs)/chat')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('home.seeAllConversations')}
          >
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
            <GIcon name="chat" size={14} color={theme.color.accentLine} />
            <View style={styles.convoWords}>
              <Text style={styles.convoText} numberOfLines={1}>
                {c.text}
              </Text>
              {/* How it opened, under its name. Null when that is what the line above already says. */}
              {c.preview ? (
                <Text style={styles.convoPreview} numberOfLines={1}>
                  {c.preview}
                </Text>
              ) : null}
            </View>
            <Text style={styles.convoTime}>{c.time}</Text>
          </GPressable>
        ))}
        {/* A read that failed is not "no conversations yet". */}
        {isUnavailable(recentState) ? (
          <ContentUnavailable compact state={recentState} reason={recent.error} onRetry={recent.actions.refresh} />
        ) : recentState === 'empty' ? (
          <InkEmptyState icon="chat" title={t('home.noConversations')}>
            <InkText>{t('home.noConversationsBody')}</InkText>
          </InkEmptyState>
        ) : null}

        <View style={styles.sectionHeader}>
          <InkTitle level={3}>{t('home.devices')}</InkTitle>
          <GPressable
            onPress={() => router.push('/(tabs)/devices')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('home.seeAllDevices')}
          >
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
        {isUnavailable(devicesState) ? (
          <ContentUnavailable compact state={devicesState} reason={devices.error} onRetry={devices.actions.refresh} />
        ) : devicesState === 'empty' ? (
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
    ...face('body', 'regular'),
    fontSize: FontSize.base,
    color: c.textTertiary,
  },
  avatar: {
    // Ink's `touch.tapMin`: the floor a finger can hit, which is also the size this reads best at.
    width: 44,
    height: 44,
    borderRadius: Radii.pill,
    backgroundColor: c.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    ...face('display', 'bold'),
    fontSize: FontSize.lg,
    color: Brand.white,
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
    ...face('body', 'semibold'),
    fontSize: FontSize.sm,
    color: c.textBrand,
  },

  /* Right now. InkCard draws its own face and plate; its style is layout only. */
  rightNowRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  rightNowCard: { flex: 1 },
  // The row stretches both cards to the taller one, but InkCard's raised plate
  // fills that height while its face only wraps its content — so the card with
  // less to say showed a slab of bare ink below it. The face takes the height
  // too, and the pair reads as one row again.
  rightNowFace: { flex: 1 },
  cardEyebrow: { marginBottom: Spacing.xs },
  cardClock: { fontVariant: ['tabular-nums'], marginTop: Spacing.xs },
  waveformRow: { marginTop: 'auto', paddingTop: Spacing.md },
  routineBadge: { alignSelf: 'flex-start', marginTop: 'auto', paddingTop: Spacing.md },

  convoRow: {
    flexDirection: 'row',
    // The icon and the time sit against the first line, not the middle of two.
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  convoWords: { flex: 1, gap: 1 },
  convoText: {
    ...face('body', 'regular'),
    fontSize: FontSize.base,
    color: c.text,
  },
  convoPreview: {
    ...face('body', 'regular'),
    fontSize: FontSize.sm,
    color: c.textSecondary,
  },
  convoTime: {
    ...face('body', 'regular'),
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
    ...face('body', 'semibold'),
    fontSize: FontSize.base,
    color: c.text,
  },
  deviceDetail: {
    ...face('body', 'regular'),
    fontSize: FontSize.xs,
    color: c.textTertiary,
  },
});
