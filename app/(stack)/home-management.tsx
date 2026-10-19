/**
 * HomeManagementScreen — Room list with rename/remove, Pond device list.
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { InkTitle } from '@jarida/ink/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import type { IconName } from '@/constants/icons';
import { GKeyboardView } from '@/components/ui/g-keyboard-view';
import { Grey, JaridaPurple, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useConfirm } from '@/providers/confirm-provider';
import type { ThemeColors } from '@/constants/colors';

interface RoomItem {
  id: string;
  name: string;
  deviceCount: number;
  icon: IconName;
}

interface PondDevice {
  id: string;
  name: string;
  status: 'online' | 'offline';
  firmware: string;
}

const ROOMS: RoomItem[] = [
  { id: '1', name: 'Living Room', deviceCount: 3, icon: 'home' },
  { id: '2', name: 'Bedroom', deviceCount: 2, icon: 'moon' },
  { id: '3', name: 'Entrance', deviceCount: 2, icon: 'lock' },
  { id: '4', name: 'Kitchen', deviceCount: 1, icon: 'light' },
];

const POND_DEVICES: PondDevice[] = [
  { id: '1', name: 'Pond Hub (Main)', status: 'online', firmware: 'v2.4.1' },
  { id: '2', name: 'Pond Mini (Bedroom)', status: 'online', firmware: 'v2.4.0' },
];

export default function HomeManagementScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [rooms, setRooms] = useState(ROOMS);

  const confirm = useConfirm();

  const handleRemoveRoom = useCallback(async (id: string) => {
    const yes = await confirm({
      title: t('homeManagementAlert.removeTitle'),
      message: t('homeManagementAlert.removeBody'),
      confirmLabel: t('homeManagementAlert.remove'),
      destructive: true,
    });
    if (yes) setRooms((prev) => prev.filter((r) => r.id !== id));
  }, [confirm, t]);

  return (
    <GKeyboardView>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Rooms */}
        <InkTitle level={3}>{t('sections.rooms')}</InkTitle>
        {rooms.map((room) => (
          <View key={room.id} style={styles.roomCard}>
            <View style={{ marginRight: Spacing.md }}>
              <GIcon name={room.icon} size={20} color={JaridaPurple[500]} />
            </View>
            <View style={styles.roomInfo}>
              <Text style={styles.roomName}>{room.name}</Text>
              <Text style={styles.roomDevices}>
                {t('homeManagement.deviceCount', { count: room.deviceCount })}
              </Text>
            </View>
            <GPressable style={styles.roomAction}>
              <GIcon name="edit" size={16} color={Grey[400]} />
            </GPressable>
            <GPressable
              style={styles.roomAction}
              onPress={() => void handleRemoveRoom(room.id)}
            >
              <GIcon name="trash" size={16} color={Semantic.danger} />
            </GPressable>
          </View>
        ))}

        {/* Add room */}
        <GPressable feedback="lift" style={styles.addBtn}>
          <GIcon name="plus" size={16} color={JaridaPurple[500]} />
          <Text style={styles.addBtnText}>{t('rooms.add')}</Text>
        </GPressable>

        {/* Pond devices */}
        <InkTitle level={3}>{t('sections.pondDevices')}</InkTitle>
        {POND_DEVICES.map((pd) => (
          <View key={pd.id} style={styles.pondCard}>
            <View style={styles.pondHeader}>
              <View
                style={[
                  styles.pondDot,
                  { backgroundColor: pd.status === 'online' ? Semantic.success : Grey[400] },
                ]}
              />
              <Text style={styles.pondName}>{pd.name}</Text>
            </View>
            <View style={styles.pondMeta}>
              <Text style={styles.pondFirmware}>
                {t('homeManagement.firmware', { version: pd.firmware })}
              </Text>
              <View style={styles.pondStatus}>
                <Text
                  style={[
                    styles.pondStatusText,
                    { color: pd.status === 'online' ? Semantic.success : Grey[500] },
                  ]}
                >
                  {t(pd.status === 'online' ? 'common.online' : 'common.offline')}
                </Text>
              </View>
            </View>
          </View>
        ))}

        {/* Pair new device */}
        <GPressable
          feedback="lift"
          style={styles.addBtn}
          onPress={() => router.push('/(stack)/pond-pairing')}
        >
          <GIcon name="plus" size={16} color={JaridaPurple[500]} />
          <Text style={styles.addBtnText}>{t('rooms.pairDevice')}</Text>
        </GPressable>

        <View style={{ height: 32 }} />
      </ScrollView>
    </GKeyboardView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },

    /* Room card */
    roomCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.card,
      borderRadius: Radii.xl,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: Spacing.sm,
    },
    roomInfo: { flex: 1 },
    roomName: {
      fontFamily: FontFamily.heading,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: c.text,
    },
    roomDevices: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.sm,
      color: c.textTertiary,
      marginTop: 2,
    },
    roomAction: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },

    /* Add button */
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      paddingVertical: Spacing.md,
      borderRadius: Radii.xl,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: JaridaPurple[200],
      backgroundColor: c.tintSoft,
      marginBottom: Spacing.lg,
    },
    addBtnText: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: c.textBrand,
    },

    /* Pond device */
    pondCard: {
      backgroundColor: c.card,
      borderRadius: Radii.xl,
      padding: Spacing.lg,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: Spacing.sm,
    },
    pondHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    pondDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    pondName: {
      fontFamily: FontFamily.heading,
      fontSize: FontSize.md,
      fontWeight: FontWeight.bold,
      color: c.text,
    },
    pondMeta: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    pondFirmware: {
      fontFamily: FontFamily.mono,
      fontSize: FontSize.xs,
      color: c.textTertiary,
    },
    pondStatus: {
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: Radii.pill,
      backgroundColor: c.backgroundSecondary,
    },
    pondStatusText: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.bold,
    },
  });
