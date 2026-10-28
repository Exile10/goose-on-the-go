/**
 * VisionAutomationsScreen -- the rules that act on what the camera sees, and starters to add in a
 * tap.
 *
 * A starter is built from what the pond is watching for and who it knows by face, so it is offered
 * only when the pond would ever produce what it listens for, and it goes once it is added. The
 * rules are the same ones the Schedule screen lists among every other automation, narrowed to the
 * camera's, and edited in the same form.
 */

import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkEmptyState, InkNotice, InkSpinner, InkText } from '@jarida/ink/native';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import { AutomationCard } from '@/components/patterns/automation-card';
import { AutomationFormSheet } from '@/components/patterns/automation-form-sheet';
import { SettingsGroup, SettingsHeader, SettingsRow } from '@/components/settings/settings-list';
import { SettingsNotice, SettingsScroll } from '@/components/settings/settings-scroll';
import { useSettingsStyles, type SettingsType } from '@/components/settings/settings-theme';
import { Spacing } from '@/constants/spacing';
import type { PeopleBlock, Starter } from '@/models/vision';
import { confirm, reject, selectionTick } from '@/services/haptics';
import type { Rule, RuleRequest } from '@/services/types';
import { useVisionAutomations } from '@/view-models/use-vision-automations';

/** A new rule that starts on the camera, with nothing else chosen. */
const NEW_CAMERA_RULE: RuleRequest = { name: '', source: { kind: 'camera' }, actions: [] };

function blockedKey(block: Exclude<PeopleBlock, null>) {
  switch (block) {
    case 'recognitionOff':
      return 'visionAutomations.peopleBlocked.recognitionOff' as const;
    case 'unavailable':
      return 'visionAutomations.peopleBlocked.unavailable' as const;
    case 'nobody':
      return 'visionAutomations.peopleBlocked.nobody' as const;
    case 'typeOff':
      return 'visionAutomations.peopleBlocked.typeOff' as const;
  }
}

export default function VisionAutomationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useSettingsStyles(makeStyles);
  const { data, loading, error, failed, adding, addError, actions } = useVisionAutomations();
  const state = useContentState({ loading, failed: failed || error !== null, hasContent: data.rules.length > 0 });
  const unavailable = isUnavailable(state);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);

  const addStarter = useCallback(
    async (starter: Starter) => {
      void selectionTick();
      void ((await actions.add(starter)) ? confirm() : reject());
    },
    [actions],
  );

  const block = data.peopleBlock;
  // Faces fixes a person nobody knows by face; the others are settings of the camera.
  const blockFix = block === 'nobody' ? '/(stack)/faces' : '/(stack)/settings-cameras';
  const blockLabel = block === 'nobody' ? t('visionAutomations.peopleBlocked.openFaces') : t('visionAutomations.peopleBlocked.openCameras');

  const blockedNote = block ? (
    <View style={styles.footer}>
      <InkText size="sm" tone="secondary">
        {t(blockedKey(block))}
      </InkText>
      <InkButton variant="quiet" onPress={() => router.push(blockFix as never)}>
        {blockLabel}
      </InkButton>
    </View>
  ) : null;

  return (
    <SettingsScroll>
      <SettingsHeader icon="bolt" tile="amber" title={t('screens.visionAutomations')} description={t('visionAutomations.intro')} />

      <View style={styles.actions}>
        <InkButton variant="primary" icon="plus" onPress={() => setCreating(true)}>
          {t('visionAutomations.new')}
        </InkButton>
      </View>

      {addError ? (
        <View style={styles.block}>
          <InkNotice tone="danger">{addError}</InkNotice>
        </View>
      ) : null}

      {data.starters.length > 0 || blockedNote ? (
        <SettingsGroup title={t('visionAutomations.startersTitle')} footer={blockedNote}>
          {data.starters.map((starter) => (
            <SettingsRow
              key={starter.id}
              label={starter.title}
              description={starter.detail}
              trailing={
                <InkButton variant="quiet" icon="plus" disabled={adding.has(starter.id)} onPress={() => void addStarter(starter)}>
                  {adding.has(starter.id) ? t('visionAutomations.adding') : t('visionAutomations.add')}
                </InkButton>
              }
            />
          ))}
        </SettingsGroup>
      ) : null}

      {loading ? <InkSpinner label={t('visionAutomations.loading')} /> : null}

      {unavailable ? (
        <ContentUnavailable state={state} reason={error} onRetry={actions.refresh} />
      ) : error ? (
        <SettingsNotice tone="danger">{error}</SettingsNotice>
      ) : null}

      {state === 'empty' ? (
        <InkEmptyState icon="bolt" title={t('visionAutomations.emptyTitle')}>
          <InkText>{t('visionAutomations.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}

      {data.rules.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.title} accessibilityRole="header">
            {t('visionAutomations.yoursTitle')}
          </Text>
          {data.rules.map((rule) => (
            <AutomationCard
              key={rule.id}
              rule={rule}
              raised={false}
              nameOf={data.nameOf}
              onOpen={setEditing}
              onSetPaused={actions.setPaused}
            />
          ))}
        </View>
      ) : null}

      <AutomationFormSheet
        open={creating}
        prefill={NEW_CAMERA_RULE}
        onClose={() => setCreating(false)}
        onSubmit={actions.create}
      />
      {editing ? (
        <AutomationFormSheet
          open
          onClose={() => setEditing(null)}
          rule={editing}
          onSubmit={(req) => actions.update(editing, req)}
          onDelete={() => actions.remove(editing)}
        />
      ) : null}
    </SettingsScroll>
  );
}

const makeStyles = (_c: unknown, type: SettingsType) => ({
  actions: { flexDirection: 'row' as const, justifyContent: 'flex-start' as const, marginBottom: Spacing.xl },
  block: { gap: Spacing.sm, marginBottom: Spacing.xl },
  list: { gap: Spacing.md },
  footer: { gap: Spacing.xs, alignItems: 'flex-start' as const, marginTop: Spacing.sm },
  title: type.eyebrow,
});
