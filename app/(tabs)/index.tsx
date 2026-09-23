/**
 * HomeScreen — Smart home AI assistant landing tab.
 *
 * Personalized greeting, status chips, "Ask Goose" bar, "Right Now" cards,
 * shortcuts carousel, device grid with toggles, recent conversations.
 */

import React, { useState, useCallback } from 'react';
import { InkSwitch } from '@jarida/ink/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GIcon } from '@/components/ui/g-icon';
import { useRecentSessions } from '@/view-models/use-recent-sessions';
import { supports, useDevices } from '@/view-models/use-devices';
import { initialOf, useMember } from '@/view-models/use-household';
import { greetingFor, untilOf, useRightNow, type Until } from '@/view-models/use-right-now';
import type { Device } from '@/services/types';
import { HOME_SHORTCUTS } from '@/constants/navigation';
import { Grey, JaridaPurple, Brand, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { Shadows } from '@/constants/shadows';
import { RemoteAccessOffer } from '@/components/patterns/remote-access-offer';
import { EqualizerBars } from '@/components/ui/equalizer-bars';
import i18n from '@/services/i18n';

/** How far off a routine is, in words. */
function untilText(until: Until): string {
  if (until.unit === 'now') return i18n.t('home.dueNow');
  if (until.unit === 'minutes') return i18n.t('home.inMinutes', { count: until.count });
  if (until.unit === 'hours') return i18n.t('home.inHours', { count: until.count });
  return i18n.t('home.inDays', { count: until.count });
}

function StatusChip({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <View style={[styles.statusChip, { backgroundColor: bg }]}>
      <Text style={[styles.statusChipText, { color }]}>{label}</Text>
    </View>
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
  const canPower = supports(device, 'power');
  const on = power ?? false;
  const handleToggle = useCallback((next: boolean) => onToggle(device, next), [device, onToggle]);

  return (
    <View style={styles.deviceCard}>
      <View style={styles.deviceCardTop}>
        <View style={[styles.deviceIconWrap, { backgroundColor: JaridaPurple[500] + '18' }]}>
          <GIcon
            name="device"
            size={17}
            color={on && device.is_online ? JaridaPurple[500] : '#B5B5B5'}
          />
        </View>
        {canPower ? (
          <InkSwitch checked={on} onChange={handleToggle} disabled={!device.is_online} />
        ) : null}
      </View>
      <Text style={styles.deviceLabel} numberOfLines={1}>
        {device.name}
      </Text>
      <Text style={styles.deviceDetail}>
        {!device.is_online ? i18n.t('devices.stateOffline') : power === undefined ? i18n.t('devices.stateOnline') : power ? i18n.t('devices.stateOn') : i18n.t('devices.stateOff')}
      </Text>
    </View>
  );
});

/** The home grid is a glance, not the full list — that is the Devices tab. */
const HOME_GRID_LIMIT = 4;

export default function HomeScreen() {
  const recent = useRecentSessions();
  const devices = useDevices();
  const member = useMember();
  const rightNow = useRightNow().data;
  // Read from the clock once, as the waveform below is rolled once, so render stays pure.
  const [greeting] = useState(() => greetingFor(new Date().getHours()));
  const [now] = useState(() => new Date());
  const initial = member ? initialOf(member.displayName) : null;

  // Only chips with a source. The online count is the list the grid below shows, so the two
  // cannot disagree, and it is not shown while that list is unknown. Meeting and Locked had no
  // source at all and are gone rather than guessed.
  const chips = [
    ...(devices.loading || devices.error
      ? []
      : [{
          key: 'online',
          label: i18n.t('home.chipOnline', { count: devices.data.devices.filter((d) => d.is_online).length }),
          color: Semantic.success,
          bg: Semantic.successSoft,
        }]),
    ...(rightNow.outdoorTemp === null
      ? []
      : [{
          key: 'outdoor',
          label: i18n.t('home.chipOutdoorTemp', { temp: rightNow.outdoorTemp }),
          color: Semantic.info,
          bg: Semantic.infoSoft,
        }]),
  ];
  const { nowPlaying, nextRoutine } = rightNow;
  const handleDeviceToggle = useCallback(
    (device: Device, on: boolean) => void devices.actions.setState(device, { power: on }),
    [devices.actions],
  );
  const router = useRouter();
  const [askText, setAskText] = useState('');

  const handleMicPress = useCallback(() => {
    // Will trigger listening overlay in future
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Offered once per pairing, and declinable. Pairing used to push a
            remote-access screen you had to get past. */}
        <RemoteAccessOffer />

        {/* Greeting header */}
        <View style={styles.greetingRow}>
          <View style={styles.greetingText}>
            <Text style={styles.greetingLabel}>
              {greeting === 'morning'
                ? i18n.t('home.greetingMorning')
                : greeting === 'afternoon'
                  ? i18n.t('home.greetingAfternoon')
                  : i18n.t('home.greetingEvening')}
            </Text>
            {/* The member the Pond attributes this phone to. No name when nobody has claimed it. */}
            {member ? <Text style={styles.greetingName}>{member.displayName}</Text> : null}
          </View>
          <View style={styles.avatar}>
            {initial ? (
              <Text style={styles.avatarText}>{initial}</Text>
            ) : (
              <GIcon name="home" size={18} color={Brand.white} />
            )}
          </View>
        </View>

        {/* Status chips */}
        {chips.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            {chips.map(({ key, ...chip }) => (
              <StatusChip key={key} {...chip} />
            ))}
          </ScrollView>
        ) : null}

        {/* Ask Goose search bar */}
        <Pressable style={styles.askBar}>
          <GIcon name="search" size={18} color={Grey[400]} />
          <TextInput
            style={styles.askInput}
            placeholder={i18n.t('home.askPlaceholder')}
            placeholderTextColor={Grey[400]}
            value={askText}
            onChangeText={setAskText}
          />
          <Pressable style={styles.askMicBtn} onPress={handleMicPress}>
            <GIcon name="mic" size={18} color={JaridaPurple[500]} />
          </Pressable>
        </Pressable>

        {/* Right Now section: a card with nothing true to say is not drawn, and a row with no
            cards has no heading. */}
        {nowPlaying || nextRoutine ? (
          <>
            <Text style={styles.sectionLabel}>{i18n.t('home.rightNow')}</Text>
            <View style={styles.rightNowRow}>
              {nowPlaying ? (
                <View style={styles.nowPlayingCard}>
                  <Text style={styles.nowPlayingLabel}>{i18n.t('home.nowPlaying')}</Text>
                  {nowPlaying.state === 'playing' ? (
                    <>
                      <Text style={styles.nowPlayingTitle}>{nowPlaying.track}</Text>
                      {nowPlaying.artist ? <Text style={styles.nowPlayingArtist}>{nowPlaying.artist}</Text> : null}
                      {/* Moving, and only while something is playing: bars over silence would say
                          music is on. They hold still under Reduce Motion and when Home is not in
                          front. */}
                      <View style={styles.waveformRow}>
                        <EqualizerBars color={JaridaPurple[400]} />
                      </View>
                    </>
                  ) : (
                    <Text style={styles.nowPlayingTitle}>{i18n.t('home.nothingPlaying')}</Text>
                  )}
                </View>
              ) : null}

              {nextRoutine ? (
                <View style={styles.nextRoutineCard}>
                  <Text style={styles.nextRoutineLabel}>{i18n.t('home.nextRoutine')}</Text>
                  <Text style={styles.nextRoutineTitle}>{nextRoutine.label}</Text>
                  <Text style={styles.nextRoutineTime}>
                    {nextRoutine.nextRun.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                  <View style={styles.nextRoutineBadge}>
                    <Text style={styles.nextRoutineBadgeText}>{untilText(untilOf(nextRoutine.nextRun, now))}</Text>
                  </View>
                </View>
              ) : null}
            </View>
          </>
        ) : null}

        {/* Shortcuts carousel */}
        <Text style={styles.sectionLabel}>{i18n.t('home.shortcuts')}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.shortcutsRow}
        >
          {HOME_SHORTCUTS.map((s) => (
            <Pressable key={s.id} style={[styles.shortcutPill, { backgroundColor: s.color }]}>
              <GIcon name={s.iconName} size={13} color={Brand.charcoal} />
              <Text style={styles.shortcutLabel}>{i18n.t(s.labelKey)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Devices grid */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>{i18n.t('home.devices')}</Text>
          <Pressable onPress={() => router.push('/(tabs)/devices')}>
            <Text style={styles.seeAllText}>{i18n.t('home.seeAll')}</Text>
          </Pressable>
        </View>
        <View style={styles.devicesGrid}>
          {devices.data.devices.slice(0, HOME_GRID_LIMIT).map((d) => (
            <DeviceGridItem
              key={d.id}
              device={d}
              power={devices.data.powerById[d.id]}
              onToggle={handleDeviceToggle}
            />
          ))}
        </View>

        {/* Recent conversations */}
        <Text style={styles.sectionLabel}>{i18n.t('home.recentConversations')}</Text>
        {recent.data.sessions.map((c) => (
          <Pressable key={c.id} style={styles.convoRow}>
            <View style={styles.convoIcon}>
              <GIcon name="chat" size={14} color={JaridaPurple[400]} />
            </View>
            <Text style={styles.convoText} numberOfLines={1}>{c.text}</Text>
            <Text style={styles.convoTime}>{c.time}</Text>
          </Pressable>
        ))}
        {/* Say why the strip is empty. A blank gap reads as a broken screen. */}
        {!recent.loading && recent.data.sessions.length === 0 ? (
          <Text style={styles.convoEmpty}>
            {recent.error ?? i18n.t('home.noConversations')}
          </Text>
        ) : null}

        {/* Bottom spacer for tab bar */}
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Grey[50] },
  scroll: { paddingHorizontal: Spacing.lg },

  /* Greeting */
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
    color: Grey[500],
  },
  greetingName: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize['2xl'],
    fontWeight: FontWeight.bold,
    color: Brand.charcoal,
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

  /* Status chips */
  chipsRow: { gap: Spacing.sm, marginBottom: Spacing.lg },
  statusChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.pill,
  },
  statusChipText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },

  /* Ask bar */
  askBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Brand.white,
    borderRadius: Radii.xl,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: Grey[200],
    ...Shadows.sm,
  },
  askInput: {
    flex: 1,
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: Brand.charcoal,
    marginLeft: Spacing.sm,
    paddingVertical: 0,
  },
  askMicBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: JaridaPurple[50],
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Section labels */
  sectionLabel: {
    fontFamily: FontFamily.body,
    fontSize: 11,
    fontWeight: FontWeight.bold,
    color: Grey[500],
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: Spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  seeAllText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: JaridaPurple[500],
  },

  /* Right Now cards */
  rightNowRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  nowPlayingCard: {
    flex: 1,
    backgroundColor: Brand.charcoal,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
  },
  nowPlayingLabel: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: Grey[400],
    marginBottom: Spacing.xs,
  },
  nowPlayingTitle: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: Brand.white,
  },
  nowPlayingArtist: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[400],
    marginTop: 2,
  },
  waveformRow: {
    marginTop: Spacing.md,
  },

  nextRoutineCard: {
    flex: 1,
    backgroundColor: Brand.white,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Grey[200],
  },
  nextRoutineLabel: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: Grey[500],
    marginBottom: Spacing.xs,
  },
  nextRoutineTitle: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: Brand.charcoal,
  },
  nextRoutineTime: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[500],
    marginTop: 2,
  },
  nextRoutineBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Semantic.warningSoft,
    borderRadius: Radii.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    marginTop: Spacing.md,
  },
  nextRoutineBadgeText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Semantic.warning,
  },

  /* Shortcuts carousel */
  shortcutsRow: { gap: Spacing.md, marginBottom: Spacing.xl },
  shortcutPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.pill,
    gap: Spacing.sm,
  },
  shortcutLabel: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Brand.charcoal,
  },

  /* Devices grid */
  devicesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  deviceCard: {
    width: '47%',
    backgroundColor: Brand.white,
    borderRadius: Radii.xl,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Grey[200],
  },
  deviceCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  deviceIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceLabel: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Brand.charcoal,
  },
  deviceDetail: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: Grey[500],
    marginTop: 2,
  },

  /* Recent conversations */
  convoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Brand.white,
    borderRadius: Radii.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Grey[200],
  },
  convoIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: JaridaPurple[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  convoText: {
    flex: 1,
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: Brand.charcoal,
  },
  convoTime: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: Grey[400],
    marginLeft: Spacing.sm,
  },
  convoEmpty: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[500],
    paddingVertical: Spacing.sm,
  },
});
