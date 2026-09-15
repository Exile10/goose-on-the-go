/**
 * DevicesTab — the devices this Pond has, grouped by the rooms they are in.
 *
 * Every control here is gated on the device's own `capabilities`. That list is
 * what the Matter controller derived from the device's clusters, and it is the
 * fact that stops a contact sensor being offered a power button — an unmapped
 * device arrives with an empty list, which means no controls rather than an
 * error.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GIcon } from '@/components/ui/g-icon';
import { GSwitch } from '@/components/ui/g-switch';
import { ALL_ROOMS, supports, useDevices } from '@/view-models/use-devices';
import type { Device } from '@/services/types';
import { Grey, JaridaPurple, Brand, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';

/** Icon and accent by device type, falling back to something neutral. */
const TYPE_STYLE: Record<string, { icon: string; color: string }> = {
  light: { icon: 'light', color: '#F59E0B' },
  thermostat: { icon: 'thermo', color: '#1C63D1' },
  lock: { icon: 'lock', color: '#1F8A3C' },
  camera: { icon: 'camera', color: '#C8383B' },
  speaker: { icon: 'speaker', color: '#8C4BFF' },
};
const DEFAULT_STYLE = { icon: 'devices', color: JaridaPurple[500] };

function styleFor(device: Device) {
  return TYPE_STYLE[device.device_type?.toLowerCase() ?? ''] ?? DEFAULT_STYLE;
}

/**
 * The line under a device's name.
 *
 * Reports what the device is doing where it says so, and falls back to
 * reachability — which is a different fact, and labelled as one — rather than
 * inventing a state.
 */
function detailFor(device: Device, power: boolean | undefined): string {
  if (!device.is_online) return 'Offline';
  if (power !== undefined) return power ? 'On' : 'Off';
  // Online is reachability, not power — a different fact, and labelled as one.
  return 'Online';
}

/** Device card. The switch appears only for devices that accept one. */
const DeviceCard = React.memo(function DeviceCard({
  device,
  power,
  onToggle,
}: {
  device: Device;
  power: boolean | undefined;
  onToggle: (device: Device, on: boolean) => void;
}) {
  const { icon, color } = styleFor(device);
  const canPower = supports(device, 'power');
  const on = power ?? false;

  const handleToggle = useCallback(
    (next: boolean) => onToggle(device, next),
    [device, onToggle],
  );

  return (
    <View style={styles.deviceCard}>
      <View style={styles.deviceCardTop}>
        <View style={[styles.deviceIconWrap, { backgroundColor: color + '18' }]}>
          <GIcon name={icon} size={17} color={on && device.is_online ? color : '#B5B5B5'} />
        </View>
        {canPower ? (
          <GSwitch value={on} onValueChange={handleToggle} disabled={!device.is_online} />
        ) : null}
      </View>
      <Text style={styles.deviceLabel} numberOfLines={1}>
        {device.name}
      </Text>
      <Text style={styles.deviceDetail}>{detailFor(device, power)}</Text>
    </View>
  );
});

export default function DevicesTab() {
  const router = useRouter();
  const { data, loading, error, actions } = useDevices();
  const [activeRoom, setActiveRoom] = useState(ALL_ROOMS);

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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Devices</Text>
          <Text style={styles.headerSubtitle}>
            {data.devices.length === 1 ? '1 device' : `${data.devices.length} devices`}
          </Text>
        </View>
        <Pressable style={styles.manageBtn} onPress={actions.refresh}>
          <Text style={styles.manageBtnText}>Refresh</Text>
        </Pressable>
      </View>

      {/* Room tabs, derived from the rooms devices are actually in. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRow}
      >
        {data.roomTabs.map((tab) => (
          <Pressable
            key={tab}
            style={[styles.roomTab, activeRoom === tab && styles.roomTabActive]}
            onPress={() => setActiveRoom(tab)}
          >
            <Text style={[styles.roomTabText, activeRoom === tab && styles.roomTabTextActive]}>
              {tab}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* The controller can take minutes to come up on first use, and nothing
            can be commissioned until it has. Say so rather than failing later. */}
        {data.matter?.state === 'connecting' ? (
          <Text style={styles.notice}>
            Your Pond is still starting its Matter controller. New devices cannot be added yet.
          </Text>
        ) : null}
        {data.matter?.state === 'unreachable' ? (
          <Text style={styles.noticeError}>
            Your Pond cannot reach its Matter controller. Existing devices still work.
          </Text>
        ) : null}

        {loading ? <ActivityIndicator color={JaridaPurple[500]} /> : null}

        {error ? <Text style={styles.noticeError}>{error}</Text> : null}

        {!loading && data.devices.length === 0 ? (
          <Text style={styles.notice}>
            No devices registered yet. Commission one to get started.
          </Text>
        ) : null}

        {visibleRooms.map((room) => (
          <View key={room.name} style={styles.roomSection}>
            <Text style={styles.roomLabel}>{room.name.toUpperCase()}</Text>
            <View style={styles.deviceGrid}>
              {room.devices.map((d) => (
                <DeviceCard
                  key={d.id}
                  device={d}
                  power={data.powerById[d.id]}
                  onToggle={handleToggle}
                />
              ))}
            </View>
          </View>
        ))}

        <Pressable
          style={styles.addDeviceBtn}
          onPress={() => router.push('/(stack)/commission-device')}
        >
          <GIcon name="plus" size={20} color={JaridaPurple[500]} />
          <Text style={styles.addDeviceText}>Add a device</Text>
        </Pressable>

        <Pressable
          style={styles.addDeviceBtn}
          onPress={() => router.push('/(stack)/pond-pairing')}
        >
          <GIcon name="plus" size={20} color={JaridaPurple[500]} />
          <Text style={styles.addDeviceText}>Pair another Pond</Text>
        </Pressable>

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Grey[50] },

  /* Header */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    backgroundColor: Brand.white,
  },
  headerTitle: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Brand.charcoal,
  },
  headerSubtitle: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[500],
    marginTop: 2,
  },
  manageBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: Grey[200],
  },
  manageBtnText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Grey[700],
  },

  /* Room tabs */
  tabsRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: Brand.white,
    borderBottomWidth: 1,
    borderBottomColor: Grey[200],
  },
  roomTab: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    borderRadius: Radii.pill,
    backgroundColor: Grey[100],
  },
  roomTabActive: {
    backgroundColor: JaridaPurple[500],
  },
  roomTabText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Grey[600],
  },
  roomTabTextActive: {
    color: Brand.white,
  },

  /* Scroll */
  scroll: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },

  /* Room section */
  roomSection: { marginBottom: Spacing.xl },
  roomLabel: {
    fontFamily: FontFamily.body,
    fontSize: 11,
    fontWeight: FontWeight.bold,
    color: Grey[500],
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: Spacing.md,
  },
  notice: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[500],
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    lineHeight: FontSize.sm * 1.5,
  },
  noticeError: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Semantic.danger,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    lineHeight: FontSize.sm * 1.5,
  },
  deviceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },

  /* Device card */
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

  /* Add device button */
  addDeviceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
    borderRadius: Radii.xl,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: JaridaPurple[200],
    backgroundColor: JaridaPurple[50],
    marginBottom: Spacing.xl,
  },
  addDeviceText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: JaridaPurple[500],
  },
});
