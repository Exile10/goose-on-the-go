// The name this phone is paired under, shown rather than asked: the device's own, changed in place.

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkFormField, InkInput, InkText } from '@/components/ui/ink';

import { Spacing } from '@/constants/spacing';

export function PhoneName({ value, onChange, disabled }: { value: string; onChange: (next: string) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <View style={styles.edit}>
        <InkFormField label={t('bleSetup.find.phoneName')} hint={t('bleSetup.find.phoneHint')}>
          <InkInput label={t('bleSetup.find.phoneName')} value={value} onChange={(next) => onChange(next.slice(0, 64))} />
        </InkFormField>
        <View style={styles.done}>
          <InkButton variant="quiet" icon="check" disabled={!value.trim()} onPress={() => setEditing(false)}>
            {t('bleSetup.find.phoneDone')}
          </InkButton>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.line}>
      <View style={styles.text}>
        <InkText size="sm" tone="secondary">
          {value.trim() ? t('bleSetup.find.phoneLabel', { name: value.trim() }) : t('bleSetup.find.phoneUnnamed')}
        </InkText>
      </View>
      <InkButton variant="quiet" icon="edit" disabled={disabled} onPress={() => setEditing(true)}>
        {t('bleSetup.find.phoneChange')}
      </InkButton>
    </View>
  );
}

const styles = StyleSheet.create({
  edit: { gap: Spacing.xs },
  done: { alignItems: 'flex-start' },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  text: { flex: 1 },
});
