/**
 * Home's card for what owner setup left for later: the wake word, and a look over the defaults it
 * chose. Shown only on the phone that set the Pond up, until each is done or the card is put away.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkRow, InkText, InkTitle } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { Spacing } from '@/constants/spacing';
import { tap } from '@/services/haptics';
import { useSetupChecklist, type ChecklistItem } from '@/view-models/use-setup-checklist';

export function FinishSetup() {
  const { t } = useTranslation();
  const router = useRouter();
  const { items, actions } = useSetupChecklist();
  if (items.length === 0) return null;

  const open = (item: ChecklistItem) => {
    void tap();
    if (item === 'wake') {
      router.push('/(stack)/wake-word');
      return;
    }
    // Looking is the whole of this one, so opening Settings is doing it.
    actions.done('review');
    router.push('/(tabs)/profile');
  };

  return (
    // Flat, as the getting-ready card is: Home spends its raised budget on the Pond card and the offer.
    <InkCard raised={false} contentStyle={styles.card}>
      <InkTitle level={3}>{t('setup.checklist.title')}</InkTitle>
      <InkText tone="secondary">{t('setup.checklist.lead')}</InkText>
      <View>
        {items.map((item, i) => (
          <GPressable key={item} accessibilityRole="button" onPress={() => open(item)}>
            <InkRow
              divided={i > 0}
              label={item === 'wake' ? t('setup.checklist.wake') : t('setup.checklist.review')}
              description={item === 'wake' ? t('setup.checklist.wakeBody') : t('setup.checklist.reviewBody')}
            >
              <GIcon name="chevron-right" size={18} />
            </InkRow>
          </GPressable>
        ))}
      </View>
      <View style={styles.actions}>
        <InkButton variant="quiet" onPress={actions.dismiss}>
          {t('setup.checklist.dismiss')}
        </InkButton>
      </View>
    </InkCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.md },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
