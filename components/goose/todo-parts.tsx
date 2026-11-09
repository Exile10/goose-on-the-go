/**
 * To-dos on My Goose. What Goose is asking about is a question with its two answers in place; an
 * offer lifted from a chat is added with one tap, or given a time first when the chat named none;
 * the rest are a checklist, each with what brings it up said as a household would ("When you get
 * home"). A to-do that waits on a place says so when the phone cannot watch places.
 */

import React, { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkDatePicker, InkSheet, InkText, InkTimePicker, useInkTheme } from '@jarida/ink/native';
import type { CivilDate, CivilTime } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import type { IconName } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import { inSentence } from '@/models/me-read';
import { hookPhrase, needsLocation, nextUp, whenText, type Hook, type HookSources, type Todo, type TodoOffer } from '@/models/todos';
import type { LocationAccess } from '@/services/geofence';
import { selectionTick, toggle } from '@/services/haptics';
import { useAgo } from './hub-parts';

/** The words for a hook: the Pond's own sentence, else the phone's. */
export function useHookWords(): (hook: Hook, sources: HookSources | null) => string {
  const { t, i18n } = useTranslation();
  return (hook, sources) => {
    if (hook.label) return hook.label;
    const phrase = hookPhrase(hook, sources, i18n.language);
    return phrase ? (t(phrase.key as never, phrase.params) as string) : t('goose.hook.unknown');
  };
}

export function hookIcon(hook: Hook): IconName {
  switch (hook.spec.kind) {
    case 'time':
      return 'schedule';
    case 'repeat':
      return 'repeat';
    case 'place':
      return 'pin';
    case 'event':
    case 'connector':
    case 'other':
      return 'bolt';
  }
}

export function openTodo(todo: Pick<Todo, 'id'> | null) {
  void selectionTick();
  router.push(todo ? { pathname: '/(stack)/goose-todo', params: { id: todo.id } } : '/(stack)/goose-todo');
}

/** Goose asking whether a to-do is done, answered in place. */
export function CheckinRow({ todo, busy, onDone, onNotYet }: { todo: Todo; busy: boolean; onDone: () => void; onNotYet: () => void }) {
  const { t } = useTranslation();
  const ago = useAgo();
  return (
    <View style={styles.ask}>
      <GPressable onPress={() => openTodo(todo)} accessibilityRole="button" accessibilityLabel={t('goose.asking.checkinLabel', { text: todo.text })}>
        <InkText size="sm" tone="secondary">
          {todo.asked > 1 ? t('goose.asking.askedAgain', { when: ago(todo.lastAskedAt) ?? '' }) : t('goose.asking.asked', { when: ago(todo.lastAskedAt) ?? '' })}
        </InkText>
        <InkText size="lg" weight="semibold">
          {t('goose.asking.didYou', { text: inSentence(todo.text) })}
        </InkText>
      </GPressable>
      <View style={styles.answers}>
        <InkButton size="sm" variant="quiet" icon="check" disabled={busy} onPress={onDone}>
          {t('goose.asking.done')}
        </InkButton>
        <InkButton size="sm" variant="quiet" disabled={busy} onPress={onNotYet}>
          {t('goose.asking.notYet')}
        </InkButton>
      </View>
    </View>
  );
}

function civilOf(d: Date): { date: CivilDate; time: CivilTime } {
  return { date: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }, time: { hour: d.getHours(), minute: d.getMinutes() } };
}

/** Tomorrow, the day a time-less offer starts from, and today, the earliest it can be set to. */
function offerDays(): { tomorrow: CivilDate; today: CivilDate } {
  const now = new Date();
  return { tomorrow: civilOf(new Date(now.getTime() + 24 * 3_600_000)).date, today: civilOf(now).date };
}

/** A dated mention from a chat, offered as a to-do. With no time the Pond could work out, it asks for one. */
export function OfferRow({ offer, busy, onAdd, onNo }: { offer: TodoOffer; busy: boolean; onAdd: (dueAt?: string) => void; onNo: () => void }) {
  const { t, i18n } = useTranslation();
  const [choosing, setChoosing] = useState(false);
  const [days] = useState(offerDays);
  const [date, setDate] = useState<CivilDate>(days.tomorrow);
  const [time, setTime] = useState<CivilTime>({ hour: 9, minute: 0 });
  const chosen = new Date(date.year, date.month - 1, date.day, time.hour, time.minute);
  return (
    <View style={styles.ask}>
      <View>
        <InkText size="sm" tone="secondary">
          {offer.whenSaid ? t('goose.asking.fromChatWhen', { when: offer.whenSaid }) : t('goose.asking.fromChat')}
        </InkText>
        <InkText size="lg" weight="semibold">
          {offer.text}
        </InkText>
        {offer.dueAt ? (
          <InkText size="sm" tone="secondary">
            {t('goose.asking.offerAt', { when: whenText(offer.dueAt, i18n.language) })}
          </InkText>
        ) : null}
      </View>
      {choosing ? (
        <View style={styles.when}>
          <InkDatePicker label={t('goose.asking.day')} value={date} onChange={setDate} min={days.today} />
          <InkTimePicker label={t('goose.asking.time')} value={time} onChange={setTime} />
        </View>
      ) : null}
      <View style={styles.answers}>
        {offer.dueAt || choosing ? (
          <InkButton size="sm" variant="quiet" icon="plus" disabled={busy} onPress={() => onAdd(choosing ? chosen.toISOString() : undefined)}>
            {choosing ? t('goose.asking.addAt', { when: whenText(chosen.toISOString(), i18n.language) }) : t('goose.asking.add')}
          </InkButton>
        ) : (
          <InkButton size="sm" variant="quiet" icon="calendar-clock" disabled={busy} onPress={() => setChoosing(true)}>
            {t('goose.asking.pickTime')}
          </InkButton>
        )}
        <InkButton size="sm" variant="quiet" disabled={busy} onPress={onNo}>
          {t('goose.asking.no')}
        </InkButton>
      </View>
    </View>
  );
}

/** One open or done to-do as a checklist row: a tick, its words, and what brings it up. */
export function TodoRow({
  todo,
  sources,
  access,
  onToggle,
  onNeedsLocation,
}: {
  todo: Todo;
  sources: HookSources | null;
  access: LocationAccess | null;
  onToggle: () => void;
  onNeedsLocation?: () => void;
}) {
  const theme = useInkTheme();
  const { t, i18n } = useTranslation();
  const words = useHookWords();
  const done = todo.state === 'done';
  const blocked = !done && needsLocation(todo) && access !== null && access !== 'granted';
  const at = nextUp(todo);
  const lines = todo.hooks.length
    ? todo.hooks.map((h) => ({ icon: hookIcon(h), text: words(h, sources) }))
    : at
      ? [{ icon: 'schedule' as IconName, text: t('goose.todos.due', { when: whenText(at, i18n.language) }) }]
      : [];
  return (
    <View style={styles.todo}>
      <GPressable
        onPress={() => {
          void toggle();
          onToggle();
        }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={todo.text}
        hitSlop={8}
        style={styles.tick}
      >
        <GIcon name={done ? 'done' : 'circle'} size={24} color={done ? theme.color.accentLine : theme.color.textTertiary} />
      </GPressable>
      <GPressable onPress={() => openTodo(todo)} accessibilityRole="button" accessibilityLabel={t('goose.todos.editLabel', { text: todo.text })} style={styles.todoWords}>
        <InkText size="md" weight="semibold" tone={done ? 'tertiary' : 'default'} numberOfLines={3}>
          {todo.text}
        </InkText>
        {!done
          ? lines.map((line, i) => (
              <View key={i} style={styles.hookLine}>
                <GIcon name={line.icon} size={13} color={theme.color.textSecondary} />
                <InkText size="sm" tone="secondary" numberOfLines={1}>
                  {line.text}
                </InkText>
              </View>
            ))
          : null}
        {todo.kind === 'reminder' && !done && lines.length === 0 ? (
          <InkText size="sm" tone="secondary">
            {t('goose.todos.reminder')}
          </InkText>
        ) : null}
      </GPressable>
      {blocked && onNeedsLocation ? (
        <GPressable onPress={onNeedsLocation} accessibilityRole="button" accessibilityLabel={t('goose.places.needsLocation')} hitSlop={6} style={[styles.needs, { backgroundColor: theme.color.warningSoft }]}>
          <GIcon name="locate" size={13} color={theme.color.warningFg} />
          <InkText size="xs" weight="semibold" style={{ color: theme.color.warningFg }}>
            {t('goose.places.needsLocationShort')}
          </InkText>
        </GPressable>
      ) : null}
    </View>
  );
}

/** Why the phone needs location for places, asked only after the member has read it. */
export function LocationSheet({
  open,
  access,
  onClose,
  onAllow,
}: {
  open: boolean;
  access: LocationAccess | null;
  onClose: () => void;
  onAllow: () => Promise<LocationAccess>;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const denied = access === 'denied';
  return (
    <InkSheet open={open} onClose={onClose} title={t('goose.places.sheetTitle')}>
      <View style={styles.sheet}>
        <InkText>{t('goose.places.sheetBody')}</InkText>
        <InkText tone="secondary">{t('goose.places.sheetPrivacy')}</InkText>
        {access === 'unavailable' ? <InkText tone="secondary">{t('goose.places.unavailable')}</InkText> : null}
        {denied ? (
          <InkButton variant="primary" icon="settings" onPress={() => void Linking.openSettings()}>
            {t('goose.places.openSettings')}
          </InkButton>
        ) : access !== 'unavailable' ? (
          <InkButton
            variant="primary"
            icon="locate"
            loading={asking}
            onPress={async () => {
              setAsking(true);
              const next = await onAllow();
              setAsking(false);
              if (next === 'granted') onClose();
            }}
          >
            {t('goose.places.allow')}
          </InkButton>
        ) : null}
        <InkButton variant="quiet" onPress={onClose}>
          {t('goose.places.notNow')}
        </InkButton>
      </View>
    </InkSheet>
  );
}

const styles = StyleSheet.create({
  ask: { gap: Spacing.sm, paddingVertical: Spacing.md },
  answers: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  when: { gap: Spacing.sm },
  todo: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, paddingVertical: Spacing.md },
  tick: { paddingTop: 1 },
  todoWords: { flex: 1, gap: 3 },
  hookLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  needs: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  sheet: { gap: Spacing.md },
});
