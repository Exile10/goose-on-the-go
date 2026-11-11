/**
 * What is connected, as a strip of glyphs with their names, one marked when it needs attention,
 * and "Connect more" at the end. The strip shows only what is in use; what is on offer waits on
 * the Connectors screen.
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkText, useInkTheme } from '@/components/ui/ink';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { iconOr } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import { categoryIcon, type Connector } from '@/models/connectors';
import { selectionTick } from '@/services/haptics';

export function openConnector(id: string) {
  void selectionTick();
  router.push({ pathname: '/(stack)/goose-connector', params: { id } });
}

const SIZE = 56;

export function ConnectorStrip({ connectors }: { connectors: Connector[] }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.row}>
      {connectors.map((c) => {
        const broken = c.status === 'error';
        return (
          <GPressable
            key={c.id}
            onPress={() => openConnector(c.id)}
            accessibilityRole="button"
            accessibilityLabel={broken ? t('goose.connectors.needsLookLabel', { name: c.name }) : c.name}
            style={styles.item}
          >
            <View style={[styles.tile, { backgroundColor: theme.color.surface, borderColor: broken ? theme.color.warningFg : theme.color.lineStrong }]}>
              <GIcon name={iconOr(c.icon, categoryIcon(c.category))} size={24} color={theme.color.text} />
              {broken ? <View style={[styles.dot, { backgroundColor: theme.color.warning, borderColor: theme.color.bg }]} /> : null}
            </View>
            <InkText size="xs" weight="semibold" numberOfLines={1} tone={broken ? 'default' : 'secondary'}>
              {c.name}
            </InkText>
          </GPressable>
        );
      })}
      <GPressable
        onPress={() => {
          void selectionTick();
          router.push('/(stack)/goose-connectors');
        }}
        accessibilityRole="button"
        accessibilityLabel={t('goose.connectors.connectMore')}
        style={styles.item}
      >
        <View style={[styles.tile, styles.more, { backgroundColor: theme.color.accentSoft, borderColor: theme.color.accentLine }]}>
          <GIcon name="plus" size={24} color={theme.color.accentLine} />
        </View>
        <InkText size="xs" weight="semibold" numberOfLines={1} style={{ color: theme.color.accentLine }}>
          {t('goose.connectors.connectMore')}
        </InkText>
      </GPressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bleed: { marginHorizontal: -Spacing.lg },
  row: { gap: Spacing.md, paddingHorizontal: Spacing.lg },
  item: { width: 76, alignItems: 'center', gap: 6 },
  tile: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  more: { borderStyle: 'dashed', borderWidth: 1 },
  dot: { position: 'absolute', top: 2, right: 2, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
});
