/**
 * Choosing the home's time zone from the Pond's own list, searchable by city, zone or offset.
 * The phone's zone is offered first, since it is nearly always the answer.
 */

import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkSearchField, InkSpinner } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { Spacing } from '@/constants/spacing';
import { selectionTick } from '@/services/haptics';
import type { ZoneChoice } from '@/services/types';
import { usePondSettings } from '@/view-models/use-pond-settings';
import { searchZones, useTimeZones } from '@/view-models/use-settings-extras';
import { SettingsGroup, SettingsMessage, SettingsRow } from './settings-list';
import { useSettingsPagePadding } from './settings-scroll';
import { useSettingsColors, useSettingsStyles, type SettingsColors, type SettingsMetrics, type SettingsType } from './settings-theme';

export function TimezonePickerScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const padding = useSettingsPagePadding();
  const colors = useSettingsColors();
  const styles = useSettingsStyles(makeStyles);
  const vm = usePondSettings();
  const zones = useTimeZones();
  const [query, setQuery] = useState('');
  const current = vm.settings?.timezone ?? '';
  const phoneZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const matches = useMemo(() => searchZones(zones.items, query), [zones.items, query]);

  const choose = (zone: string) => {
    void selectionTick();
    if (zone !== current) void vm.actions.update('timezone', zone);
    router.back();
  };

  const renderZone = ({ item, index }: { item: ZoneChoice; index: number }) => {
    const selected = item.zone === current;
    return (
      <Pressable
        onPress={() => choose(item.zone)}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${item.place}, ${item.zone}, ${item.offset}`}
        style={({ pressed }) => [
          styles.zone,
          index === 0 && styles.first,
          index === matches.length - 1 && styles.last,
          index > 0 && styles.divided,
          pressed && { backgroundColor: colors.pressed },
        ]}
      >
        <View style={styles.zoneText}>
          <Text style={[styles.place, selected && { color: colors.accent }]}>{item.place || item.zone}</Text>
          <Text style={styles.detail}>{`${item.zone.replace(/_/g, ' ')} · ${item.offset}`}</Text>
        </View>
        {selected ? <GIcon name="check" size={18} color={colors.accent} /> : null}
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <FlatList
        data={matches}
        keyExtractor={(z) => z.zone}
        renderItem={renderZone}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={24}
        contentContainerStyle={padding}
        ListHeaderComponent={
          <>
            <InkSearchField
              label={t('settings.timezone.search')}
              value={query}
              onChange={setQuery}
              placeholder={t('settings.timezone.search')}
              style={styles.search}
            />
            {!query && phoneZone && phoneZone !== current ? (
              <SettingsGroup>
                <SettingsRow label={t('settings.timezone.useDevice')} value={phoneZone} icon="device" tile="green" onPress={() => choose(phoneZone)} />
              </SettingsGroup>
            ) : null}
            {zones.loading ? <InkSpinner label={t('settings.loading')} /> : null}
            {zones.error && zones.items.length === 0 ? <SettingsMessage tone="danger">{t('settings.timezone.loadFailed')}</SettingsMessage> : null}
          </>
        }
        ListEmptyComponent={!zones.loading && zones.items.length > 0 ? <SettingsMessage>{t('settings.timezone.none')}</SettingsMessage> : null}
      />
    </View>
  );
}

const makeStyles = (c: SettingsColors, type: SettingsType, m: SettingsMetrics) => ({
  search: { marginBottom: Spacing.lg },
  zone: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Spacing.md,
    backgroundColor: c.group,
    paddingHorizontal: m.rowH,
    paddingVertical: m.rowV,
    minHeight: 56,
    borderLeftWidth: m.hairline,
    borderRightWidth: m.hairline,
    borderColor: c.line,
  },
  first: { borderTopWidth: m.hairline, borderTopLeftRadius: m.radius.lg, borderTopRightRadius: m.radius.lg },
  last: { borderBottomWidth: m.hairline, borderBottomLeftRadius: m.radius.lg, borderBottomRightRadius: m.radius.lg },
  divided: { borderTopWidth: m.hairline, borderTopColor: c.line },
  zoneText: { flex: 1, gap: 2 },
  place: type.label,
  detail: type.description,
});
