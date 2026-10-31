/**
 * HomeScreen — whether the Pond wants anything from you, and what is happening at home.
 *
 * Under the greeting, everything is a widget on one board, in the order this phone's owner chose:
 * by default the suggestions and questions first, because they are the part that needs a person.
 * Each widget is something the Pond actually told us, and a widget with nothing true to say is not
 * drawn. Only a waiting suggestion is raised and only the music is filled; the rest sit on
 * hairlines, so the board can hold more of them without every one shouting.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  InkBadge,
  InkButton,
  InkCard,
  InkEmptyState,
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
import {
  ConversationsWidget,
  DevicesWidget,
  NextRoutineWidget,
  NowPlayingWidget,
  OutsideWidget,
  RememberWidget,
} from '@/components/patterns/home-widgets';
import { WidgetBoard, type BoardWidget } from '@/components/patterns/widget-board';
import { useHomeIdeas, type PondPrompt } from '@/view-models/use-home-ideas';
import { useHomeLayout, type HomeWidgetKey } from '@/view-models/use-home-layout';
import { useRecentSessions } from '@/view-models/use-recent-sessions';
import { useDevices } from '@/view-models/use-devices';
import { initialOf, useMember } from '@/view-models/use-household';
import { useRightNow } from '@/view-models/use-right-now';
import { useLive } from '@/view-models/use-live';
import { useServer } from '@/providers/server-provider';
import { hostOf } from '@/services/discovery';
import { tap } from '@/services/haptics';
import type { Device } from '@/services/types';
import { Brand, JaridaPurple, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';

/** The devices widget is a glance, not the full list — that is the Devices tab. Three rows of two. */
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
  // One read of the Pond's ideas for the whole screen; the widgets take their parts.
  const ideas = useHomeIdeas();
  const layout = useHomeLayout();
  const router = useRouter();
  const chrome = useChromeScroll();
  const bottomInset = useBottomBarInset();
  const scroller = useRef<ScrollView>(null);
  const boardTop = useRef(0);

  // The clock is state, advanced once a minute while Home is in front, so render stays pure and
  // the greeting and "in 23 h" move with the time instead of freezing at the moment Home mounted.
  const [now, setNow] = useState(() => new Date());
  useLive(async () => setNow(new Date()), CLOCK_MS);

  const initial = member ? initialOf(member.displayName) : null;

  const handleDeviceToggle = useCallback(
    (device: Device, on: boolean) => void devices.actions.setState(device, { power: on }),
    [devices.actions],
  );

  const ask = useCallback(
    (prompt: PondPrompt) => {
      ideas.actions.taken(prompt);
      router.push({ pathname: '/conversation', params: { ask: prompt.prompt } });
    },
    [ideas.actions, router],
  );

  const edit = useCallback(() => {
    void tap();
    layout.actions.edit();
    // Folded, the board fits on one screen; bring all of it into view, since the page holds still while widgets move.
    scroller.current?.scrollTo({ y: Math.max(0, boardTop.current - Spacing.lg), animated: true });
  }, [layout.actions]);

  // The online count is the list the grid shows, so the two cannot disagree, and it is not stated
  // while that list is unknown.
  const devicesKnown = !devices.loading && !devices.error;
  const hasIdeas = ideas.data.proposals.length > 0 || !!ideas.data.agent || !!ideas.outcome || ideas.quiet;

  // Built in the saved order; a widget with nothing to say is left out rather than drawn empty.
  const widgets = useMemo(() => {
    const all: Record<HomeWidgetKey, BoardWidget | null> = {
      ideas: hasIdeas
        ? {
            key: 'ideas',
            span: 2,
            frame: ideas.data.proposals.length > 0 ? 'raised' : 'plain',
            title: t('home.ideas.title'),
            icon: 'sparkle',
            node: (
              <HomeIdeas
                proposals={ideas.data.proposals}
                moreProposals={ideas.data.moreProposals}
                agent={ideas.data.agent}
                deciding={ideas.deciding}
                outcome={ideas.outcome}
                quiet={ideas.quiet}
                onAccept={(id) => void ideas.actions.approve(id)}
                onDecline={(id) => void ideas.actions.decline(id)}
              />
            ),
          }
        : null,
      ask: {
        key: 'ask',
        span: 2,
        frame: 'plain',
        title: t('pond.askGoose'),
        icon: 'chat',
        node: <AskRow prompts={ideas.data.prompts} onAsk={ask} onAskGoose={() => router.push('/conversation')} />,
      },
      music: rightNow.nowPlaying
        ? {
            key: 'music',
            span: 1,
            frame: 'accent',
            title: t('home.nowPlaying'),
            icon: 'music',
            node: <NowPlayingWidget playing={rightNow.nowPlaying} />,
          }
        : null,
      next: rightNow.nextRoutine
        ? {
            key: 'next',
            span: 1,
            frame: 'plain',
            title: t('home.nextRoutine'),
            icon: 'schedule',
            node: (
              <NextRoutineWidget routine={rightNow.nextRoutine} now={now} onOpen={() => router.push('/(stack)/schedule')} />
            ),
          }
        : null,
      outside: rightNow.outdoor
        ? {
            key: 'outside',
            span: 1,
            frame: 'plain',
            title: t('home.widgets.outside'),
            icon: 'partly-sunny',
            node: <OutsideWidget outdoor={rightNow.outdoor} />,
          }
        : null,
      remember: ideas.data.reminders
        ? {
            key: 'remember',
            span: 1,
            frame: 'plain',
            title: t('home.widgets.remember'),
            icon: 'bell',
            node: <RememberWidget reminders={ideas.data.reminders} onOpen={() => router.push('/(stack)/reminders')} />,
          }
        : null,
      conversations: {
        key: 'conversations',
        span: 2,
        frame: 'plain',
        title: t('home.conversations'),
        icon: 'chat',
        node: (
          <ConversationsWidget
            sessions={recent.data.sessions}
            loading={recent.loading}
            error={recent.error}
            onSeeAll={() => router.push('/(tabs)/chat')}
            onOpen={(c) =>
              router.push({
                pathname: '/conversation',
                params: c.title ? { session: c.id, title: c.title } : { session: c.id },
              })
            }
          />
        ),
      },
      devices: {
        key: 'devices',
        span: 2,
        frame: 'plain',
        title: t('home.devices'),
        icon: 'device',
        node: (
          <DevicesWidget
            devices={devices.data.devices.slice(0, HOME_GRID_LIMIT)}
            powerById={devices.data.powerById}
            online={devicesKnown ? { count: devices.data.onlineCount, total: devices.data.devices.length } : null}
            loading={devices.loading}
            error={devices.error}
            onToggle={handleDeviceToggle}
            onSeeAll={() => router.push('/(tabs)/devices')}
            empty={
              <InkEmptyState
                icon="device"
                title={t('home.noDevices')}
                action={
                  <InkButton variant="primary" onPress={() => router.push('/(stack)/commission-device')}>
                    {t('home.addDevice')}
                  </InkButton>
                }
              >
                <InkText>{t('home.noDevicesBody')}</InkText>
              </InkEmptyState>
            }
          />
        ),
      },
    };
    return layout.order.map((key) => all[key]).filter((w): w is BoardWidget => w !== null);
  }, [layout.order, hasIdeas, ideas, rightNow, now, recent, devices, devicesKnown, handleDeviceToggle, ask, router, t]);

  const shown = widgets.map((w) => w.key);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        ref={scroller}
        {...chrome}
        // Still while rearranging: a widget is carried with the finger the page would otherwise follow.
        scrollEnabled={!layout.editing}
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
          <View onLayout={(e) => (boardTop.current = e.nativeEvent.layout.y)}>
            {layout.editing ? (
              <View style={styles.editBar}>
                <Text style={styles.editHint}>{t('home.board.hint')}</Text>
                <InkButton variant="quiet" onPress={layout.actions.reset}>
                  {t('home.board.reset')}
                </InkButton>
                <InkButton variant="primary" onPress={layout.actions.done}>
                  {t('common.done')}
                </InkButton>
              </View>
            ) : null}
            <WidgetBoard
              widgets={widgets}
              editing={layout.editing}
              onEdit={edit}
              onMove={layout.actions.move}
              onStep={(key, delta) => layout.actions.step(key, delta, shown)}
            />
            {layout.editing ? null : (
              <GPressable style={styles.editLink} hitSlop={8} accessibilityRole="button" onPress={edit}>
                <GIcon name="grip" size={14} color={styles.editLinkText.color} />
                <Text style={styles.editLinkText}>{t('home.board.edit')}</Text>
              </GPressable>
            )}
          </View>
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
    marginBottom: Spacing['2xl'],
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

  editBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  editHint: {
    flex: 1,
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: c.textSecondary,
  },
  editLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: Spacing.xs + 2,
    marginTop: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  editLinkText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: c.textBrand,
  },
});
