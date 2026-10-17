/**
 * The Ponds on this network.
 *
 * Shared by first run and by switching Pond later, so the same list cannot
 * drift into two shapes. `currentUrl` marks the one in use; leaving it out —
 * first run, when nothing is paired — simply marks none.
 */

import React from 'react';
import { StyleSheet, Text, View  } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkBadge, InkEmptyState, InkGroup, InkRow, InkText } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { selectionTick } from '@/services/haptics';
import type { DiscoveredPond } from '@/services/discovery';
import type { ThemeColors } from '@/constants/colors';
import { FontFamily, FontSize } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';

export type DiscoveryPhase = 'searching' | 'found' | 'empty' | 'failed';

export interface PondListProps {
  title: string;
  ponds: DiscoveredPond[];
  phase: DiscoveryPhase;
  error?: string | null;
  currentUrl?: string;
  onSelect: (pond: DiscoveredPond) => void;
}

export function PondList({
  title,
  ponds,
  phase,
  error,
  currentUrl,
  onSelect,
}: PondListProps) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();

  if (ponds.length === 0) {
    return phase === 'searching' ? (
      <Text style={styles.scanning}>{t('onboarding.scanning')}</Text>
    ) : (
      <InkEmptyState icon="wifi" title={t('onboarding.noneFound')}>
        <InkText>{error ?? t('onboarding.noneFoundBody')}</InkText>
      </InkEmptyState>
    );
  }

  return (
    <InkGroup title={title}>
      {ponds.map((pond, i) => {
        const active = currentUrl === pond.url;
        return (
          <GPressable
            key={pond.id}
            accessibilityRole="button"
            onPress={() => {
              void selectionTick();
              onSelect(pond);
            }}
          >
            <InkRow
              divided={i > 0}
              label={
                <View style={styles.label}>
                  <GIcon name="server" size={18} />
                  <Text style={styles.name} numberOfLines={1}>
                    {pond.name || pond.id}
                  </Text>
                </View>
              }
              description={
                <Text style={styles.addr}>
                  {/* The card's id, in the card's own lowercase, says which of several new Ponds a card belongs to. */}
                  {pond.unclaimed && pond.setupId
                    ? `${pond.address}:${pond.port} · ${t('onboarding.cardId', { id: pond.setupId })}`
                    : `${pond.address}:${pond.port}`}
                </Text>
              }
            >
              {active ? (
                <InkBadge tone="success">{t('common.online')}</InkBadge>
              ) : pond.unclaimed ? (
                <View style={styles.trail}>
                  <InkBadge tone="brand">{t('onboarding.notSetUp')}</InkBadge>
                  <GIcon name="chevron-right" size={18} />
                </View>
              ) : (
                <GIcon name="chevron-right" size={18} />
              )}
            </InkRow>
          </GPressable>
        );
      })}
    </InkGroup>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    label: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    trail: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
    name: { fontFamily: FontFamily.body, fontSize: FontSize.base, color: c.text, flexShrink: 1 },
    addr: { fontFamily: FontFamily.mono, fontSize: FontSize.xs, color: c.textTertiary },
    scanning: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.sm,
      color: c.textTertiary,
      paddingVertical: Spacing.lg,
    },
  });
