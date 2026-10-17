// Two fields Ink's input cannot be: a code typed off a card in fixed-width digits, and a Wi-Fi
// password that is masked, never autocorrected, and never saved by the phone.

import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkText, inkText, useInkTheme } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { FontFamily } from '@/constants/typography';

function useFieldStyle(invalid: boolean) {
  const theme = useInkTheme();
  return {
    theme,
    text: inkText(theme, { size: 'md' }).style,
    frame: {
      gap: theme.space[2],
      minHeight: theme.touch.tapMin,
      paddingHorizontal: theme.space[3],
      borderWidth: theme.edge.hairlineWidth,
      borderColor: invalid ? theme.color.danger : theme.color.lineStrong,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.surface,
    },
  };
}

function FieldError({ text }: { text: string }) {
  const theme = useInkTheme();
  return (
    <View accessibilityLiveRegion="polite">
      <InkText size="sm" style={{ color: theme.color.danger }}>
        {text}
      </InkText>
    </View>
  );
}

export function DigitsField({
  label,
  value,
  onChange,
  placeholder,
  invalid,
  disabled,
  onSubmit,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  invalid?: string;
  disabled?: boolean;
  onSubmit?: () => void;
}) {
  const field = useFieldStyle(!!invalid);
  return (
    <View style={styles.wrap}>
      <View style={[styles.frame, field.frame]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={field.theme.color.textTertiary}
          keyboardType="number-pad"
          autoCorrect={false}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          editable={!disabled}
          returnKeyType="go"
          onSubmitEditing={onSubmit}
          accessibilityLabel={label}
          style={[field.text, styles.digits, { paddingVertical: field.theme.space[2] }]}
        />
      </View>
      {invalid ? <FieldError text={invalid} /> : null}
    </View>
  );
}

export function SecretField({
  label,
  value,
  onChange,
  invalid,
  disabled,
  onSubmit,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  invalid?: string;
  disabled?: boolean;
  onSubmit?: () => void;
}) {
  const { t } = useTranslation();
  const field = useFieldStyle(!!invalid);
  const [shown, setShown] = useState(false);
  return (
    <View style={styles.wrap}>
      <View style={[styles.frame, field.frame]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          secureTextEntry={!shown}
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          // The Pond keeps this password and the phone must not, so nothing asks the system to save it.
          // iOS still shows its Passwords key on any masked field; that only fills, it does not save.
          autoComplete="off"
          textContentType="none"
          importantForAutofill="no"
          editable={!disabled}
          returnKeyType="join"
          onSubmitEditing={onSubmit}
          accessibilityLabel={label}
          style={[field.text, styles.fill, { paddingVertical: field.theme.space[2] }]}
        />
        <GPressable
          hitSlop={8}
          onPress={() => setShown((s) => !s)}
          accessibilityRole="button"
          accessibilityLabel={shown ? t('bleSetup.wifi.hide') : t('bleSetup.wifi.show')}
        >
          <GIcon name={shown ? 'eye-off' : 'eye'} size={18} />
        </GPressable>
      </View>
      {invalid ? <FieldError text={invalid} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  frame: { flexDirection: 'row', alignItems: 'center' },
  fill: { flex: 1 },
  // Copied off a printed card group by group, so every digit keeps a fixed-width column.
  digits: { flex: 1, fontFamily: FontFamily.mono, letterSpacing: 1 },
});
