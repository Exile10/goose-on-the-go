/**
 * A visible label over a field. Ink's inputs carry their label for a screen reader only, and its
 * own field label is a capitalised eyebrow; a form here names each field in plain words above it.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { InkText } from '@jarida/ink/native';

export function Labelled({ label, hint, children }: { label: string; hint?: string | null; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <InkText size="sm" weight="semibold">
        {label}
      </InkText>
      {children}
      {hint ? (
        <InkText size="sm" tone="secondary">
          {hint}
        </InkText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ field: { gap: 6 } });
