/**
 * AutomationsTab — the sensor-triggered rules: list, create, edit, delete,
 * pause and resume.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkEmptyState, InkNotice, InkSpinner, InkText } from '@/components/ui/ink';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import { useReloadOnPull } from '@/view-models/use-pull-to-refresh';
import { AutomationCard } from '@/components/patterns/automation-card';
import { AutomationFormSheet } from '@/components/patterns/automation-form-sheet';
import type { Rule } from '@/services/types';
import { useRules } from '@/view-models/use-rules';
import { Spacing } from '@/constants/spacing';

export function AutomationsTab() {
  const { t } = useTranslation();
  const { data, loading, error, failed, actions } = useRules();
  // The scroll, and so the pull, is the Schedule screen's.
  useReloadOnPull(actions.refresh);
  // A refused refresh with the list still on screen is said above it; a list that never arrived is
  // said once, in its place.
  const state = useContentState({ loading, failed: failed || error !== null, hasContent: data.rules.length > 0 });
  const unavailable = isUnavailable(state);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);

  return (
    <View style={styles.body}>
      <View style={styles.header}>
        <InkButton variant="primary" icon="plus" onPress={() => setCreating(true)}>
          {t('schedule.list.newAutomation')}
        </InkButton>
      </View>

      {loading ? <InkSpinner label={t('schedule.list.loading')} /> : null}

      {unavailable ? (
        <ContentUnavailable state={state} reason={error} onRetry={actions.refresh} />
      ) : error ? (
        <InkNotice tone="danger">{error}</InkNotice>
      ) : null}

      {state === 'empty' ? (
        <InkEmptyState icon="bolt" title={t('schedule.list.noRulesTitle')}>
          <InkText>{t('schedule.list.noRulesBody')}</InkText>
        </InkEmptyState>
      ) : null}

      {data.rules.length > 0 ? (
        <InkText size="sm" tone="tertiary">{t('schedule.list.rulesNote')}</InkText>
      ) : null}

      {data.rules.map((rule) => (
        <AutomationCard key={rule.id} rule={rule} onOpen={setEditing} onSetPaused={actions.setPaused} />
      ))}

      <AutomationFormSheet open={creating} onClose={() => setCreating(false)} onSubmit={actions.create} />
      {editing ? (
        <AutomationFormSheet
          open
          onClose={() => setEditing(null)}
          rule={editing}
          onSubmit={(req) => actions.update(editing, req)}
          onDelete={() => actions.remove(editing)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.md },
  header: { flexDirection: 'row', justifyContent: 'flex-end' },
});
