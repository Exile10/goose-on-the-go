/**
 * The member's saved places, for hooks that wait on arriving or leaving: each place, and saving
 * where the phone is now under a name the member gives it.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkInput } from '@/components/ui/ink';

import { Spacing } from '@/constants/spacing';
import type { Place } from '@/models/todos';
import { GroupRow, InsetGroup } from './following';
import { RoundButton } from './hub-parts';
import { Labelled } from './labelled';

export function SavePlaceHere({ onSave }: { onSave: (label: string) => Promise<Place | null> }) {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <View style={styles.save}>
      <Labelled label={t('goose.places.nameLabel')}>
        <InkInput value={label} onChange={setLabel} label={t('goose.places.nameLabel')} placeholder={t('goose.places.namePlaceholder')} />
      </Labelled>
      <InkButton
        icon="locate"
        loading={saving}
        disabled={!label.trim()}
        onPress={async () => {
          setSaving(true);
          const made = await onSave(label);
          setSaving(false);
          if (made) setLabel('');
        }}
      >
        {t('goose.places.saveHere')}
      </InkButton>
    </View>
  );
}

export function PlacesList({ places, onRemove }: { places: Place[]; onRemove: (id: string) => void }) {
  const { t } = useTranslation();
  if (places.length === 0) return null;
  return (
    <InsetGroup>
      {places.map((p, i) => (
        <GroupRow
          key={p.id}
          first={i === 0}
          icon="pin"
          label={p.label}
          detail={t('goose.places.radius', { metres: Math.round(p.radiusM) })}
          trailing={<RoundButton icon="trash" size={30} label={t('goose.places.remove', { place: p.label })} onPress={() => onRemove(p.id)} />}
        />
      ))}
    </InsetGroup>
  );
}

const styles = StyleSheet.create({
  save: { gap: Spacing.sm },
});
