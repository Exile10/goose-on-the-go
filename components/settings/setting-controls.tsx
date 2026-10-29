/**
 * One control per kind of setting, each drawn as rows of a settings group. Every control applies
 * its change as soon as it is made; there is no Save button on a settings page.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { InkMenu, InkSheet, InkSwitch } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { Spacing } from '@/constants/spacing';
import {
  formatClock,
  nextStop,
  paceWord,
  parseClock,
  parseSettingNumber,
  tidyNumber,
  type ChoiceOption,
  type SliderFormat,
} from '@/models/pond-settings';
import { selectionTick, toggle } from '@/services/haptics';
import type { TranslationKey } from '@/services/i18n';
import { SettingsRow } from './settings-list';
import { SettingsSlider } from './settings-slider';
import {
  useSettingsColors,
  useSettingsStyles,
  type SettingsColors,
  type SettingsMetrics,
  type SettingsType,
} from './settings-theme';

interface Common {
  label: string;
  description?: string | null;
  note?: string | null;
  error?: string | null;
  disabled?: boolean;
}

export function SwitchRow({ value, onChange, ...row }: Common & { value: boolean; onChange: (next: boolean) => void }) {
  const flip = useCallback(() => {
    void toggle();
    onChange(!value);
  }, [value, onChange]);
  return (
    <SettingsRow
      {...row}
      onPress={row.disabled ? undefined : flip}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      trailing={<InkSwitch checked={value} onChange={() => flip()} label={row.label} disabled={row.disabled} />}
    />
  );
}

/** Ink's radio: an edge-coloured ring on the surface, the accent dot inside when chosen. */
export function Radio({ selected }: { selected: boolean }) {
  const styles = useSettingsStyles(makeStyles);
  return <View style={styles.radio}>{selected ? <View style={styles.radioDot} /> : null}</View>;
}

/** Every option on its own row with a radio and what it means. Returns rows, one per option. */
export function radioRows({
  name,
  value,
  options,
  onChange,
  disabled,
  t,
}: {
  name: string;
  value: string;
  options: ChoiceOption[];
  onChange: (next: string) => void;
  disabled?: boolean;
  t: TFunction;
}) {
  // A stored value no option names stays visible rather than leaving nothing selected.
  const known = options.some((o) => o.value === value);
  const all: (Omit<ChoiceOption, 'labelKey'> & { labelKey?: TranslationKey })[] =
    known || !value ? options : [...options, { value }];
  return all.map((option) => (
    <RadioRow
      key={`${name}:${option.value}`}
      label={option.labelKey ? t(option.labelKey) : option.value}
      description={option.hintKey ? t(option.hintKey) : null}
      selected={option.value === value}
      disabled={disabled}
      onSelect={() => {
        if (option.value === value) return;
        void selectionTick();
        onChange(option.value);
      }}
    />
  ));
}

export function RadioRow({
  label,
  description,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  description: string | null;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  return (
    <Pressable
      onPress={onSelect}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={label}
      accessibilityHint={description ?? undefined}
      style={({ pressed }) => [styles.radioRow, pressed && { backgroundColor: colors.pressed }, disabled && styles.dim]}
    >
      <Radio selected={selected} />
      <View style={styles.radioText}>
        <Text style={styles.radioLabel}>{label}</Text>
        {description ? <Text style={styles.radioHint}>{description}</Text> : null}
      </View>
    </Pressable>
  );
}

export interface MenuChoice {
  value: string;
  label: string;
}

/** A row showing the current choice that opens the list of choices, for short lists of plain values. */
export function MenuRow({
  value,
  choices,
  onChange,
  ...row
}: Common & { value: string; choices: MenuChoice[]; onChange: (next: string) => void }) {
  const { t } = useTranslation();
  const current = choices.find((c) => c.value === value)?.label ?? (value || t('settings.notSet'));
  return (
    <InkMenu
      label={row.label}
      items={choices.map((choice) => ({
        key: choice.value || '_',
        label: choice.label,
        icon: choice.value === value ? 'check' : undefined,
        onPress: () => {
          if (choice.value === value) return;
          void selectionTick();
          onChange(choice.value);
        },
      }))}
      trigger={({ onPress }) => (
        <SettingsRow {...row} value={current} accessory="menu" onPress={row.disabled ? undefined : onPress} />
      )}
    />
  );
}

/**
 * A text setting. A short value is typed in place on the right, a long one under its label. Both
 * save when typing ends, and a page closed mid-word still saves what was typed.
 */
export function TextRow({
  value,
  onCommit,
  placeholder,
  multiline,
  address,
  ...row
}: Common & {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  multiline?: boolean;
  address?: boolean;
}) {
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  // A draft exists only while typing; otherwise the field shows what the Pond holds.
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const saved = useRef({ value, onCommit });
  useEffect(() => {
    saved.current = { value, onCommit };
  });

  const finish = () => {
    const typed = pending.current;
    pending.current = null;
    setDraft(null);
    if (typed !== null && typed.trim() !== saved.current.value.trim()) saved.current.onCommit(typed.trim());
  };

  // A page closed mid-word still saves what was typed.
  useEffect(
    () => () => {
      const typed = pending.current;
      if (typed !== null && typed.trim() !== saved.current.value.trim()) saved.current.onCommit(typed.trim());
    },
    [],
  );

  const field = (
    <TextInput
      value={draft ?? value}
      onChangeText={(text) => {
        pending.current = text;
        setDraft(text);
      }}
      onFocus={() => {
        pending.current = value;
        setDraft(value);
      }}
      onBlur={finish}
      onSubmitEditing={multiline ? undefined : finish}
      placeholder={placeholder}
      placeholderTextColor={colors.textTertiary}
      multiline={multiline}
      editable={!row.disabled}
      autoCapitalize={address ? 'none' : 'sentences'}
      autoCorrect={!address}
      keyboardType={address ? 'url' : 'default'}
      returnKeyType={multiline ? 'default' : 'done'}
      accessibilityLabel={row.label}
      style={multiline ? styles.textArea : styles.textInline}
    />
  );

  if (multiline) {
    return (
      <SettingsRow {...row}>
        {field}
      </SettingsRow>
    );
  }
  return <SettingsRow {...row} trailing={<View style={styles.inlineWrap}>{field}</View>} />;
}

/**
 * A number. Small whole-number ranges get − and + so nobody has to type; anything else is typed,
 * checked against its range, and saved when typing ends.
 */
export function NumberRow({
  value,
  min,
  max,
  step,
  stops,
  unit,
  onCommit,
  ...row
}: Common & {
  value: number;
  min: number;
  max?: number;
  step: number;
  stops?: readonly number[];
  unit?: string;
  onCommit: (next: number) => void;
}) {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  const stepper = Boolean(stops?.length) || (Number.isInteger(step) && max !== undefined && max - min <= 50);
  const shown = String(tidyNumber(value));
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const saved = useRef({ shown, onCommit, min, max, step });
  useEffect(() => {
    saved.current = { shown, onCommit, min, max, step };
  });

  const finish = () => {
    const typed = pending.current;
    pending.current = null;
    setDraft(null);
    const st = saved.current;
    if (typed === null || typed.trim() === st.shown) {
      setProblem(null);
      return;
    }
    const parsed = parseSettingNumber(typed, st);
    if ('error' in parsed) {
      setProblem(
        parsed.error === 'tooSmall' ? t('settings.number.tooSmall', { min: st.min })
          : parsed.error === 'tooBig' ? t('settings.number.tooBig', { max: st.max })
            : parsed.error === 'whole' ? t('settings.number.whole')
              : t('settings.number.notNumber'),
      );
      return;
    }
    setProblem(null);
    st.onCommit(parsed.value);
  };

  useEffect(
    () => () => {
      const typed = pending.current;
      const st = saved.current;
      if (typed === null || typed.trim() === st.shown) return;
      const parsed = parseSettingNumber(typed, st);
      if ('value' in parsed) st.onCommit(parsed.value);
    },
    [],
  );

  if (stepper) {
    const bump = (delta: number) => {
      const target = stops?.length ? nextStop(stops, value, delta) : value + delta;
      const next = Math.min(max ?? Infinity, Math.max(min, target));
      if (next === value) return;
      void selectionTick();
      onCommit(next);
    };
    return (
      <SettingsRow
        {...row}
        trailing={
          <View style={styles.stepper}>
            <StepButton icon="minus" label={t('settings.number.decrease', { label: row.label })} disabled={row.disabled || value <= min} onPress={() => bump(-step)} />
            <Text style={styles.stepValue} accessibilityLiveRegion="polite">
              {unit ? `${shown} ${unit}` : shown}
            </Text>
            <StepButton icon="plus" label={t('settings.number.increase', { label: row.label })} disabled={row.disabled || (max !== undefined && value >= max)} onPress={() => bump(step)} />
          </View>
        }
      />
    );
  }

  return (
    <SettingsRow
      {...row}
      error={problem ?? row.error}
      trailing={
        <View style={styles.numberWrap}>
          <TextInput
            value={draft ?? shown}
            onChangeText={(text) => {
              pending.current = text;
              setDraft(text);
            }}
            onFocus={() => {
              pending.current = shown;
              setDraft(shown);
            }}
            onBlur={finish}
            onSubmitEditing={finish}
            keyboardType={Number.isInteger(step) && min >= 0 ? 'number-pad' : 'numbers-and-punctuation'}
            returnKeyType="done"
            editable={!row.disabled}
            selectTextOnFocus
            accessibilityLabel={row.label}
            style={styles.numberInput}
            placeholderTextColor={colors.textTertiary}
          />
          {unit ? <Text style={styles.unit}>{unit}</Text> : null}
        </View>
      }
    />
  );
}

function StepButton({ icon, label, disabled, onPress }: { icon: 'minus' | 'plus'; label: string; disabled?: boolean; onPress: () => void }) {
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.stepButton, pressed && { backgroundColor: colors.pressed }, disabled && styles.dim]}
    >
      <GIcon name={icon} size={16} color={colors.text} strokeWidth={2.25} />
    </Pressable>
  );
}

function paceKey(speed: number): TranslationKey {
  switch (paceWord(speed)) {
    case 'muchSlower':
      return 'settings.pace.muchSlower';
    case 'slower':
      return 'settings.pace.slower';
    case 'natural':
      return 'settings.pace.natural';
    case 'faster':
      return 'settings.pace.faster';
    case 'muchFaster':
      return 'settings.pace.muchFaster';
  }
}

function creativityKey(value: number): TranslationKey {
  if (value < 0.5) return 'settings.creativity.steady';
  if (value <= 1) return 'settings.creativity.balanced';
  return 'settings.creativity.inventive';
}

export function sliderText(format: SliderFormat, value: number, t: TFunction): string {
  if (format === 'pace') return t('settings.pace.value', { word: t(paceKey(value)), speed: value.toFixed(2) });
  if (format === 'creativity') return t('settings.creativity.value', { word: t(creativityKey(value)), value: value.toFixed(2) });
  return t('settings.percent', { value: Math.round(value * 100) });
}

/** A continuous value. The readout follows the finger; the setting is saved once, on release. */
export function SliderRow({
  value,
  min,
  max,
  step,
  format,
  onCommit,
  ...row
}: Common & { value: number; min: number; max: number; step: number; format: SliderFormat; onCommit: (next: number) => void }) {
  const { t } = useTranslation();
  const [moving, setMoving] = useState<number | null>(null);
  const shown = moving ?? tidyNumber(value);
  const text = sliderText(format, shown, t);
  return (
    <SettingsRow {...row} value={text}>
      <SettingsSlider
        value={shown}
        min={min}
        max={max}
        step={step}
        label={row.label}
        valueText={text}
        disabled={row.disabled}
        onChange={setMoving}
        onCommit={(next) => {
          setMoving(null);
          if (next !== tidyNumber(value)) onCommit(next);
        }}
      />
    </SettingsRow>
  );
}

const QUARTER_HOURS = Array.from({ length: 96 }, (_, i) => formatClock(Math.floor(i / 4), (i % 4) * 15));

/** A clock time the Pond stores as `HH:MM`, picked from a list of quarter hours. */
export function TimeRow({ value, onCommit, ...row }: Common & { value: string; onCommit: (next: string) => void }) {
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  const [open, setOpen] = useState(false);
  const clock = parseClock(value);
  const shown = clock ? formatClock(clock.hour, clock.minute) : value;
  const times = clock && !QUARTER_HOURS.includes(shown) ? [...QUARTER_HOURS, shown].sort() : QUARTER_HOURS;
  return (
    <>
      <SettingsRow {...row} value={shown} accessory="menu" onPress={row.disabled ? undefined : () => setOpen(true)} />
      <InkSheet open={open} onClose={() => setOpen(false)} title={row.label}>
        <ScrollView style={styles.sheetList} contentOffset={{ x: 0, y: Math.max(0, times.indexOf(shown) - 3) * 48 }}>
          {times.map((time) => {
            const selected = time === shown;
            return (
              <Pressable
                key={time}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  setOpen(false);
                  if (!selected) {
                    void selectionTick();
                    onCommit(time);
                  }
                }}
                style={({ pressed }) => [styles.sheetItem, pressed && { backgroundColor: colors.pressed }]}
              >
                <Text style={[styles.sheetText, selected && styles.sheetChosen]}>{time}</Text>
                {selected ? <GIcon name="check" size={18} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </InkSheet>
    </>
  );
}

/** A list the Pond stores, shown one item to a row, each removable. Returns rows. */
export function listRows({
  name,
  items,
  label,
  description,
  emptyText,
  onChange,
  t,
}: {
  name: string;
  items: string[];
  label: string;
  description?: string | null;
  emptyText: string;
  onChange: (next: string[]) => void;
  t: TFunction;
}) {
  const header = <SettingsRow key={`${name}:label`} label={label} description={description} value={items.length === 0 ? emptyText : null} />;
  return [
    header,
    ...items.map((item) => (
      <ListItemRow
        key={`${name}:${item}`}
        item={item}
        removeLabel={t('settings.list.remove', { item })}
        onRemove={() => {
          void selectionTick();
          onChange(items.filter((i) => i !== item));
        }}
      />
    )),
  ];
}

function ListItemRow({ item, removeLabel, onRemove }: { item: string; removeLabel: string; onRemove: () => void }) {
  const colors = useSettingsColors();
  return (
    <SettingsRow
      label={item}
      trailing={
        <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={removeLabel}>
          <GIcon name="x" size={18} color={colors.textTertiary} />
        </Pressable>
      }
    />
  );
}

const makeStyles = (c: SettingsColors, type: SettingsType, m: SettingsMetrics) => ({
  dim: { opacity: 0.45 },
  radio: {
    width: 20,
    height: 20,
    marginTop: 2,
    borderRadius: m.radius.pill,
    borderWidth: m.border,
    borderColor: c.edge,
    backgroundColor: c.group,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  radioDot: { width: 8, height: 8, borderRadius: m.radius.pill, backgroundColor: c.accent },
  radioRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: m.gap,
    paddingHorizontal: m.rowH,
    paddingVertical: m.rowV,
    minHeight: m.tapMin,
  },
  radioText: { flex: 1, gap: 2 },
  radioLabel: type.label,
  radioHint: type.description,
  inlineWrap: { flexShrink: 1, minWidth: 120, maxWidth: '60%' as const },
  textInline: { ...type.value, textAlign: 'right' as const, paddingVertical: 0 },
  textArea: {
    ...type.body,
    minHeight: 88,
    textAlignVertical: 'top' as const,
    borderRadius: m.radius.md,
    borderWidth: m.hairline,
    borderColor: c.edge,
    backgroundColor: c.group,
    paddingHorizontal: m.gap,
    paddingVertical: Spacing.sm,
  },
  numberWrap: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.xs },
  numberInput: { ...type.value, textAlign: 'right' as const, minWidth: 56, paddingVertical: 0 },
  unit: type.note,
  stepper: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.sm },
  stepButton: {
    width: 32,
    height: 32,
    borderRadius: m.radius.pill,
    borderWidth: m.hairline,
    borderColor: c.edge,
    backgroundColor: c.group,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  stepValue: { ...type.label, minWidth: 28, textAlign: 'center' as const },
  sheetList: { maxHeight: 360 },
  sheetItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    minHeight: 48,
    paddingHorizontal: m.gap,
    borderRadius: m.radius.sm,
  },
  sheetText: type.body,
  sheetChosen: { ...type.label, color: c.accent },
});
