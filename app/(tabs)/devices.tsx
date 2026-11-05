/**
 * DevicesTab — the devices this Pond has, grouped by the rooms they are in.
 *
 * Every control here is gated on the device's own `capabilities`. That list is
 * what the Matter controller derived from the device's clusters, and it is the
 * fact that stops a contact sensor being offered a power button — an unmapped
 * device arrives with an empty list, which means no controls rather than an
 * error.
 *
 * Reachable devices sort first. A household accumulates rows for things that
 * were unplugged or replaced, and the one being reached for is almost never the
 * dead one.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  InkButton,
  InkCard,
  InkChoice,
  InkEmptyState,
  InkNotice,
  InkSpinner,
  InkSwitch,
  InkText,
  InkTitle,
} from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GRoundButton } from '@/components/ui/g-round-button';
import { useBottomBarInset, useChromeScroll } from '@/providers/chrome-provider';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { selectionTick, toggle } from '@/services/haptics';
import { deviceStyle } from '@/constants/device-style';
import { ALL_ROOMS, UNASSIGNED_ROOM, isAppWindow, roomLabel, supports, useDevices } from '@/view-models/use-devices';
import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { DeviceEditSheet } from '@/components/patterns/device-edit-sheet';
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import type { Device } from '@/services/types';
import { Grey } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { FontSize, face } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';

/**
 * Device card. The switch appears only for devices that accept one; a tap opens its name and room.
 * A switch that was just tapped sits where it was put, greyed out, until the Pond confirms it.
 */
const DeviceCard = React.memo(function DeviceCard({
  device,
  power,
  waiting,
  onToggle,
  onEdit,
}: {
  device: Device;
  power: boolean | undefined;
  /** The power asked for and not yet confirmed. */
  waiting: boolean | undefined;
  onToggle: (device: Device, on: boolean) => void;
  onEdit: (device: Device) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { icon, color } = deviceStyle(device);
  const canPower = supports(device, 'power');
  const on = power ?? false;
  const lit = on && device.is_online;

  const handleToggle = useCallback(
    (next: boolean) => {
      void toggle();
      onToggle(device, next);
    },
    [device, onToggle],
  );

  /**
   * What the device is doing where it says so, and reachability where it does
   * not. Online is not the same fact as on, and it is labelled as one. A
   * dashboard window is open or not, which is no fault either way.
   */
  const appWindow = isAppWindow(device);
  const offline = !device.is_online && !appWindow;
  const detail = appWindow
    ? t(device.is_online ? 'devices.app.open' : 'devices.app.notOpen')
    : offline
      ? t('common.offline')
      : waiting !== undefined
        ? t('devices.waitingForPond')
        : power === undefined
          ? t('common.online')
          : t(power ? 'common.on' : 'common.off');

  return (
    <InkCard style={styles.card} pressable onPress={() => onEdit(device)}>
      <View style={styles.cardTop}>
        <View style={[styles.iconWrap, { backgroundColor: color + '1F' }]}>
          <GIcon name={icon} size={17} color={lit ? color : Grey[500]} />
        </View>
        {canPower ? (
          <InkSwitch
            checked={waiting ?? on}
            onChange={handleToggle}
            disabled={!device.is_online || waiting !== undefined}
          />
        ) : null}
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {device.name}
      </Text>
      <Text style={[styles.detail, (offline || waiting !== undefined) && styles.detailMuted]}>
        {detail}
      </Text>
    </InkCard>
  );
});

export default function DevicesTab() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { data, loading, failed, error, actions } = useDevices();
  // A pull draws its own spinner at the top of the list, so the one in the
  // list body stands down while it runs rather than showing two.
  const [pulling, setPulling] = useState(false);
  const [activeRoom, setActiveRoom] = useState(ALL_ROOMS);
  const [editing, setEditing] = useState<Device | null>(null);
  const chrome = useChromeScroll();
  const bottomInset = useBottomBarInset();

  const visibleRooms = useMemo(
    () =>
      activeRoom === ALL_ROOMS
        ? data.rooms
        : data.rooms.filter((r) => r.name === activeRoom),
    [activeRoom, data.rooms],
  );

  const handleToggle = useCallback(
    (device: Device, on: boolean) => void actions.setState(device, { power: on }),
    [actions],
  );

  const handleRefresh = useCallback(() => {
    void selectionTick();
    void actions.refresh();
  }, [actions]);

  const handlePull = useCallback(async () => {
    setPulling(true);
    try {
      await actions.refresh();
    } finally {
      setPulling(false);
    }
  }, [actions]);

  const handleEdit = useCallback((device: Device) => {
    void selectionTick();
    setEditing(device);
  }, []);

  const namedRooms = useMemo(
    () => data.rooms.map((r) => r.name).filter((name) => name !== UNASSIGNED_ROOM),
    [data.rooms],
  );

  const pickRoom = useCallback((room: string) => {
    void selectionTick();
    setActiveRoom(room);
  }, []);

  const total = data.devices.length;
  const state = useContentState({ loading, failed, hasContent: total > 0 });
  const unavailable = isUnavailable(state);
  const nothingReachable = total > 0 && data.onlineCount === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Title and count on the left, the two actions as a matched pair of
          round buttons on the right. Add lives up here rather than under the
          grid, so it stays in reach however many devices there are; with none,
          the empty state below carries it instead, and the screen still has a
          single primary. Add used to be a full-width labelled bar beside a
          small round Refresh, one row with two sizes for two actions of one
          rank; now both are the same circle, Add filled as the primary. */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <InkTitle level={1}>{t('devices.title')}</InkTitle>
          <Text style={styles.subtitle} numberOfLines={1}>
            {t('devices.count', { count: total })}
            {total > 0 ? ` · ${t('devices.online', { count: data.onlineCount })}` : ''}
            {/* Only when the Pond has stopped answering: what is shown is its last word, and this is its age. */}
            {data.staleFor ? ` · ${t('devices.updatedAgo', { ago: data.staleFor })}` : ''}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <GRoundButton
            icon="refresh"
            label={t('devices.refreshList')}
            onPress={handleRefresh}
            busy={loading}
          />
          {total > 0 ? (
            <GRoundButton
              icon="plus"
              tone="primary"
              label={t('devices.addDevice')}
              onPress={() => router.push('/(stack)/commission-device')}
            />
          ) : null}
        </View>
      </View>

      {/* Room tabs, derived from the rooms devices are actually in. The
          view-model returns none when there is only one room to show. A tab
          is a room id, not a name: "All" and "Unassigned" are ids, and
          `roomLabel` is what turns any of them into words. */}
      {data.roomTabs.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabsScroll}
          contentContainerStyle={styles.tabsRow}
        >
          {data.roomTabs.map((tab) => (
            <InkChoice
              key={tab}
              role="radio"
              shape="pill"
              selected={activeRoom === tab}
              onSelect={() => pickRoom(tab)}
            >
              {roomLabel(tab)}
            </InkChoice>
          ))}
        </ScrollView>
      ) : null}

      <ScrollView
        {...chrome}
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void handlePull()} />}
      >
        {/* The controller can take minutes to come up on first use, and nothing
            can be commissioned until it has. Say so rather than failing later. */}
        {data.matter?.state === 'connecting' ? (
          <InkNotice tone="info">{t('devices.matterStarting')}</InkNotice>
        ) : null}
        {data.matter?.state === 'unreachable' ? (
          <InkNotice tone="warning">{t('devices.matterUnreachable')}</InkNotice>
        ) : null}

        {/* Said once at the top rather than on every card. Twenty-two rows each
            reading "Offline" is the same fact repeated, not twenty-two facts. */}
        {nothingReachable && !loading ? (
          <View style={styles.notice}>
            <InkNotice tone="warning">{t('devices.allOfflineBody')}</InkNotice>
          </View>
        ) : null}

        {/* Grey on their cards too; listed here because this is where they can be taken back. */}
        {data.queued.length > 0 ? (
          <InkCard>
            <View style={styles.notice}>
              <Text style={[styles.detail, styles.detailMuted]}>{t('devices.queuedTitle')}</Text>
              {data.queued.map((c) => {
                const name = data.devices.find((d) => d.id === c.deviceId)?.name ?? c.deviceId;
                return (
                  <View key={c.key} style={styles.queuedRow}>
                    <Text style={[styles.detail, styles.detailMuted]}>
                      {t(c.patch.power ? 'devices.queuedOn' : 'devices.queuedOff', { name })}
                    </Text>
                    <InkButton variant="quiet" onPress={() => actions.cancel(c.deviceId)}>
                      {t('common.cancel')}
                    </InkButton>
                  </View>
                );
              })}
            </View>
          </InkCard>
        ) : null}

        {loading && !pulling ? <InkSpinner label={t('pond.checking')} /> : null}

        {/* A pull that failed with the grid already on screen. A list that did not load is said
            once, in place of the grid; a switch the Pond refused is said in the snackbar. */}
        {!unavailable && error ? (
          <View style={styles.notice}>
            <InkNotice tone="danger">{error}</InkNotice>
          </View>
        ) : null}

        {/* A list that failed to load is unknown, not empty: "No devices yet" would be a claim
            nobody made. */}
        {unavailable ? <ContentUnavailable state={state} reason={error} onRetry={actions.refresh} /> : null}
        {state === 'empty' ? (
          <InkEmptyState
            icon="device"
            title={t('devices.noneTitle')}
            action={
              <InkButton
                variant="primary"
                onPress={() => router.push('/(stack)/commission-device')}
              >
                {t('devices.addDevice')}
              </InkButton>
            }
          >
            <InkText>{t('devices.noneBody')}</InkText>
          </InkEmptyState>
        ) : null}

        {visibleRooms.map((room) => (
          <View key={room.name} style={styles.roomSection}>
            {/* One room needs no heading — the screen is already that room. */}
            {data.rooms.length > 1 ? <InkTitle level={3}>{roomLabel(room.name)}</InkTitle> : null}
            <View style={styles.grid}>
              {room.devices.map((d) => (
                <DeviceCard
                  key={d.id}
                  device={d}
                  power={data.powerById[d.id]}
                  waiting={data.waitingById[d.id]}
                  onToggle={handleToggle}
                  onEdit={handleEdit}
                />
              ))}
            </View>
          </View>
        ))}

      </ScrollView>

      {editing ? (
        <DeviceEditSheet
          key={editing.id}
          device={editing}
          rooms={namedRooms}
          onClose={() => setEditing(null)}
          onSave={actions.edit}
        />
      ) : null}
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    notice: { marginBottom: Spacing.md },
    queuedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.lg,
      paddingBottom: Spacing.md,
    },
    // Takes the width the buttons leave, and may shrink so the count line
    // truncates rather than pushing the buttons off the row.
    headerText: { flex: 1, minWidth: 0 },
    subtitle: {
      ...face('body', 'regular'),
      fontSize: FontSize.sm,
      color: c.textTertiary,
      marginTop: Spacing.xs,
    },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },

    // Pins this ScrollView's own height to its content instead of letting it
    // compete for leftover flex space in the column layout below — without
    // this, filtering to a room with fewer devices frees up vertical space
    // that gets redistributed into the tab pills instead of staying blank,
    // stretching them tall.
    tabsScroll: { flexGrow: 0, flexShrink: 0 },
    tabsRow: {
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.md,
      /* Room for the plate under each pill. */
      gap: Spacing.sm,
      alignItems: 'center',
    },

    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
    roomSection: { marginBottom: Spacing.lg, gap: Spacing.md },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },

    /* InkCard draws its own face and plate. Adding a background, a border and a
       radius on top of that is what turned each card into a purple slab. */
    card: { width: '47%', gap: 2 },
    cardTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: Spacing.xs,
    },
    iconWrap: {
      width: 34,
      height: 34,
      borderRadius: Radii.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    name: {
      ...face('body', 'semibold'),
      fontSize: FontSize.sm,
      color: c.text,
    },
    detail: {
      ...face('body', 'regular'),
      fontSize: FontSize.xs,
      color: c.textSecondary,
    },
    detailMuted: { color: c.textTertiary },
  });
