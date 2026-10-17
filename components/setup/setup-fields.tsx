// Two fields Ink has no single control for: a birthday as three selects, since a calendar opens on
// this month and a birth year is decades back, and a zone as a searchable sheet of the Pond's own.

import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkInput, InkListItem, InkSelect, InkSheet, InkSpinner, InkText, inkText, useInkTheme } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { Spacing } from '@/constants/spacing';
import { birthdayOf, deviceZone } from '@/models/owner-setup';
import { api } from '@/services/api-client';
import { selectionTick } from '@/services/haptics';
import type { ZoneChoice } from '@/services/types';
import { searchZones } from '@/view-models/use-settings-extras';

function partsOf(birthday: string): { year: string; month: string; day: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday);
  return m ? { year: m[1], month: String(Number(m[2])), day: String(Number(m[3])) } : { year: '', month: '', day: '' };
}

function monthName(month: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date(2000, month - 1, 1));
  } catch {
    return String(month);
  }
}

/** `YYYY-MM-DD` once it is a real date. Day and year are typed: 31 or 120 rows run off Ink's sheet. */
export function BirthdayField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { t } = useTranslation();
  const [parts, setParts] = useState(() => partsOf(value));
  const thisYear = new Date().getFullYear();
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1) })), []);
  const complete = !!(parts.day && parts.month && parts.year.length === 4);
  const invalid = complete && birthdayOf(parts, thisYear) === null;

  const change = (part: 'year' | 'month' | 'day', next: string) => {
    const updated = { ...parts, [part]: part === 'month' ? next : next.replace(/\D/g, '').slice(0, part === 'year' ? 4 : 2) };
    setParts(updated);
    onChange(birthdayOf(updated, thisYear) ?? '');
  };

  const clear = () => {
    setParts({ year: '', month: '', day: '' });
    onChange('');
  };

  return (
    <View style={styles.birthday}>
      <View style={styles.row}>
        <InkInput
          style={styles.day}
          type="number"
          label={t('setup.about.day')}
          placeholder={t('setup.about.day')}
          value={parts.day}
          onChange={(v) => change('day', v)}
        />
        <InkSelect
          style={styles.month}
          label={t('setup.about.month')}
          value={parts.month}
          options={[{ value: '', label: t('setup.about.month') }, ...months]}
          onChange={(v) => change('month', v)}
        />
        <InkInput
          style={styles.year}
          type="number"
          label={t('setup.about.year')}
          placeholder={t('setup.about.year')}
          value={parts.year}
          onChange={(v) => change('year', v)}
        />
      </View>
      {invalid ? <InkText size="sm" tone="secondary">{t('setup.about.birthdayInvalid')}</InkText> : null}
      {parts.day || parts.month || parts.year ? (
        <InkButton variant="quiet" icon="x" onPress={clear}>
          {t('setup.about.clearBirthday')}
        </InkButton>
      ) : null}
    </View>
  );
}

// Ink's search field with autocorrect off, which Ink's own cannot do: tapping a result committed
// "Jairo" for "nairo" and emptied the list under the finger.
function ZoneSearch({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const field = inkText(theme, { size: 'md' });
  return (
    <View
      style={[
        styles.search,
        {
          gap: theme.space[2],
          minHeight: theme.touch.tapMin,
          paddingHorizontal: theme.space[3],
          borderWidth: theme.edge.hairlineWidth,
          borderColor: theme.color.lineStrong,
          borderRadius: theme.radius.pill,
          backgroundColor: theme.color.surface,
        },
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={t('setup.locale.zoneSearch')}
        placeholderTextColor={theme.color.textTertiary}
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        returnKeyType="search"
        accessibilityLabel={t('setup.locale.zoneSearch')}
        style={[field.style, styles.searchInput, { paddingVertical: theme.space[2] }]}
      />
      {value ? (
        <InkButton variant="quiet" icon="x" onPress={() => onChange('')}>
          {t('setup.locale.zoneClear')}
        </InkButton>
      ) : null}
    </View>
  );
}

/** The Pond's zone list is what saving validates against, so it is the one offered. */
export function ZoneField({ value, onChange }: { value: string; onChange: (zone: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [zones, setZones] = useState<ZoneChoice[] | null>(null);
  const [query, setQuery] = useState('');
  const phone = deviceZone();

  useEffect(() => {
    if (!open || zones) return;
    let live = true;
    void api
      .listTimeZones()
      .then((list) => live && setZones(list))
      .catch(() => live && setZones([]));
    return () => {
      live = false;
    };
  }, [open, zones]);

  const shown = useMemo(() => {
    const all = zones ?? [];
    // The phone's own zone first: it is nearly always the answer.
    const ordered = [...all.filter((z) => z.zone === phone), ...all.filter((z) => z.zone !== phone)];
    return searchZones(ordered, query);
  }, [zones, phone, query]);

  const current = zones?.find((z) => z.zone === value);
  const choose = (zone: string) => {
    void selectionTick();
    onChange(zone);
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <GPressable
        onPress={() => {
          void selectionTick();
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={t('setup.locale.zoneChange')}
      >
        <InkListItem
          title={current?.place || value.split('/').pop()?.replace(/_/g, ' ') || value}
          description={current ? `${value.replace(/_/g, ' ')} · ${current.offset}` : value.replace(/_/g, ' ')}
          trail={<GIcon name="chevron-right" size={18} />}
        />
      </GPressable>
      <InkSheet open={open} onClose={() => setOpen(false)} title={t('setup.locale.zone')}>
        <View style={styles.sheet}>
          <ZoneSearch value={query} onChange={setQuery} />
          {zones === null ? (
            <InkSpinner label={t('setup.locale.zone')} />
          ) : shown.length === 0 ? (
            <InkText tone="secondary">{t('setup.locale.zoneNone')}</InkText>
          ) : (
            <FlatList
              data={shown}
              keyExtractor={(z) => z.zone}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              renderItem={({ item }) => (
                <InkListItem
                  title={item.place || item.zone}
                  description={`${item.zone.replace(/_/g, ' ')} · ${item.offset}${item.zone === phone ? ` · ${t('setup.locale.zonePhone')}` : ''}`}
                  selected={item.zone === value}
                  onPress={() => choose(item.zone)}
                />
              )}
            />
          )}
        </View>
      </InkSheet>
    </>
  );
}

const styles = StyleSheet.create({
  birthday: { gap: Spacing.sm, alignItems: 'flex-start' },
  row: { flexDirection: 'row', gap: Spacing.sm, alignSelf: 'stretch' },
  day: { flex: 2 },
  month: { flex: 4 },
  year: { flex: 2.5 },
  sheet: { gap: Spacing.md, minHeight: 320 },
  search: { flexDirection: 'row', alignItems: 'center' },
  searchInput: { flex: 1 },
  list: { maxHeight: 420 },
});
