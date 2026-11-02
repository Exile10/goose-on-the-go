// A text field in a settings row, typed on every keystroke: the agent editors' fields, which save
// with a button rather than when typing ends.

import React from 'react';
import { TextInput } from 'react-native';

import { SettingsRow } from '@/components/settings/settings-list';
import { useSettingsColors, useSettingsStyles, type SettingsColors, type SettingsMetrics, type SettingsType } from '@/components/settings/settings-theme';
import { Spacing } from '@/constants/spacing';

/** A field typed on every keystroke, unlike `TextRow`, which saves when typing ends. */
export function FieldRow({
  label,
  description,
  error,
  value,
  onChange,
  placeholder,
  multiline,
  numeric,
  plain,
  disabled,
}: {
  label: string;
  description?: string | null;
  error?: string | null;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  numeric?: boolean;
  /** A name, not words: no capitals, no corrections. */
  plain?: boolean;
  disabled?: boolean;
}) {
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  return (
    <SettingsRow label={label} description={description} error={error}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        multiline={multiline}
        editable={!disabled}
        keyboardType={numeric ? 'number-pad' : 'default'}
        autoCapitalize={plain ? 'none' : 'sentences'}
        autoCorrect={!plain}
        accessibilityLabel={label}
        style={[multiline ? styles.area : styles.input, error ? { borderColor: colors.danger } : null]}
      />
    </SettingsRow>
  );
}

const makeStyles = (c: SettingsColors, type: SettingsType, m: SettingsMetrics) => ({
  input: {
    ...type.body,
    marginTop: Spacing.sm,
    borderRadius: m.radius.md,
    borderWidth: m.hairline,
    borderColor: c.edge,
    backgroundColor: c.group,
    paddingHorizontal: m.gap,
    paddingVertical: Spacing.sm,
    minHeight: 44,
  },
  area: {
    ...type.body,
    marginTop: Spacing.sm,
    minHeight: 160,
    textAlignVertical: 'top' as const,
    borderRadius: m.radius.md,
    borderWidth: m.hairline,
    borderColor: c.edge,
    backgroundColor: c.group,
    paddingHorizontal: m.gap,
    paddingVertical: Spacing.sm,
  },
});

