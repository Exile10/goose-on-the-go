/**
 * Choosing what brings a to-do up: a time, a repeat, arriving at or leaving a place, or something
 * the Pond sees or a connected service raises. The last list is drawn from what the Pond offers
 * (`/me/hooks/sources`), so a connector added on the Pond appears here with no app release.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkChip, InkDatePicker, InkSegmented, InkText, InkTimePicker } from '@jarida/ink/native';
import type { CivilDate, CivilTime } from '@jarida/ink/native';

import { Spacing } from '@/constants/spacing';
import { clockText } from '@/models/news';
import { REPEATS, hookOnSource, sourceKindKey, sourcesByKind, weekdayNames, type Hook, type HookSources, type Place, type RepeatEvery, type Transition } from '@/models/todos';
import type { LocationAccess } from '@/services/geofence';
import { selectionTick } from '@/services/haptics';
import { SavePlaceHere } from './places';

type Kind = 'time' | 'repeat' | 'place' | 'event';

function blank(spec: Hook['spec']): Hook {
  return { id: '', label: '', spec, nextFireAt: null, lastFiredAt: null };
}

function today(): CivilDate {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

export function HookPicker({
  sources,
  access,
  onAdd,
  onSavePlace,
  onNeedsLocation,
}: {
  sources: HookSources;
  access: LocationAccess | null;
  onAdd: (hook: Hook) => void;
  onSavePlace: (label: string) => Promise<Place | null>;
  onNeedsLocation: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState<Kind>('time');
  const [date, setDate] = useState<CivilDate>(today());
  const [time, setTime] = useState<CivilTime>({ hour: 18, minute: 0 });
  const [every, setEvery] = useState<RepeatEvery>('weekday');
  const [days, setDays] = useState<number[]>([6]);
  const [transition, setTransition] = useState<Transition>('arrive');
  const groups = sourcesByKind(sources.sources);

  const add = (hook: Hook) => {
    void selectionTick();
    onAdd(hook);
  };

  return (
    <View style={styles.picker}>
      <InkSegmented
        label={t('goose.hookPicker.label')}
        value={kind}
        options={[
          { value: 'time', label: t('goose.hookPicker.time') },
          { value: 'repeat', label: t('goose.hookPicker.repeat') },
          { value: 'place', label: t('goose.hookPicker.place') },
          { value: 'event', label: t('goose.hookPicker.event') },
        ]}
        onChange={setKind}
      />

      {kind === 'time' ? (
        <View style={styles.form}>
          <InkDatePicker label={t('goose.asking.day')} value={date} onChange={setDate} min={today()} />
          <InkTimePicker label={t('goose.asking.time')} value={time} onChange={setTime} />
          <InkButton icon="plus" onPress={() => add(blank({ kind: 'time', at: new Date(date.year, date.month - 1, date.day, time.hour, time.minute).toISOString() }))}>
            {t('goose.hookPicker.addTime')}
          </InkButton>
        </View>
      ) : null}

      {kind === 'repeat' ? (
        <View style={styles.form}>
          <View style={styles.chips}>
            {REPEATS.map((r) => (
              <InkChip key={r} selected={every === r} onPress={() => setEvery(r)}>
                {r === 'day' ? t('goose.hookPicker.everyDay') : r === 'weekday' ? t('goose.hookPicker.everyWeekday') : r === 'week' ? t('goose.hookPicker.everyWeek') : t('goose.hookPicker.everyMonth')}
              </InkChip>
            ))}
          </View>
          {every === 'week' ? (
            <View style={styles.chips}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <InkChip key={d} selected={days.includes(d)} onPress={() => setDays((all) => (all.includes(d) ? all.filter((x) => x !== d) : [...all, d]))}>
                  {weekdayNames([d], i18n.language)}
                </InkChip>
              ))}
            </View>
          ) : null}
          <InkTimePicker label={t('goose.asking.time')} value={time} onChange={setTime} />
          <InkButton
            icon="plus"
            disabled={every === 'week' && days.length === 0}
            onPress={() => add(blank({ kind: 'repeat', every, at: clockText(time.hour, time.minute), days: every === 'week' ? [...days].sort() : [] }))}
          >
            {t('goose.hookPicker.addRepeat')}
          </InkButton>
        </View>
      ) : null}

      {kind === 'place' ? (
        <View style={styles.form}>
          <InkSegmented
            label={t('goose.hookPicker.whenAt')}
            value={transition}
            options={[
              { value: 'arrive', label: t('goose.hookPicker.arrive') },
              { value: 'leave', label: t('goose.hookPicker.leave') },
            ]}
            onChange={setTransition}
          />
          {sources.places.length ? (
            <View style={styles.chips}>
              {sources.places.map((p) => (
                <InkChip key={p.id} icon="pin" onPress={() => add(blank({ kind: 'place', placeId: p.id, transition }))}>
                  {p.label}
                </InkChip>
              ))}
            </View>
          ) : (
            <InkText tone="secondary">{t('goose.hookPicker.noPlaces')}</InkText>
          )}
          <SavePlaceHere onSave={onSavePlace} />
          {access && access !== 'granted' ? (
            <InkButton variant="quiet" icon="locate" onPress={onNeedsLocation}>
              {t('goose.places.allowFromList')}
            </InkButton>
          ) : null}
        </View>
      ) : null}

      {kind === 'event' ? (
        <View style={styles.form}>
          {groups.length === 0 ? <InkText tone="secondary">{t('goose.hookPicker.noSources')}</InkText> : null}
          {groups.map((group) => (
            <View key={group.kind} style={styles.group}>
              <InkText size="sm" weight="bold" tone="secondary">
                {t(sourceKindKey(group.kind))}
              </InkText>
              {group.sources.map((source) => (
                <View key={source.id} style={styles.source}>
                  <InkText weight="semibold">{source.label}</InkText>
                  <View style={styles.chips}>
                    {source.events.map((e) => (
                      <InkChip key={e.id} icon="bolt" onPress={() => add(hookOnSource(source, e.id))}>
                        {e.label}
                      </InkChip>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { gap: Spacing.md },
  form: { gap: Spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  group: { gap: Spacing.sm },
  source: { gap: 6 },
});
