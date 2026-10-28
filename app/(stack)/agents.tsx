// The household's agents, the Pond's suggestions, and where each start-up copy (prefill) stands. Rebuild
// all asks first, because every agent is slower until its copy is back.

import React, { useCallback } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { InkBadge, InkButton, InkCard, InkSpinner, InkText, InkTitle, inkText, useInkTheme } from '@jarida/ink/native';

import { AgentsBuildingCard } from '@/components/patterns/agents-building';
import { SettingsGroup, SettingsHeader, SettingsMessage, SettingsRow } from '@/components/settings/settings-list';
import { SettingsNotice, SettingsScroll } from '@/components/settings/settings-scroll';
import { useSettingsColors } from '@/components/settings/settings-theme';
import { GIcon } from '@/components/ui/g-icon';
import { Spacing } from '@/constants/spacing';
import { canRebuild, type AgentRow } from '@/models/agents';
import { useConfirm } from '@/providers/confirm-provider';
import { confirm, reject, selectionTick, tap } from '@/services/haptics';
import type { AgentPrefill, AgentSuggestion } from '@/services/types';
import { builtInName, prefillDetail, prefillLabel } from '@/view-models/agent-words';
import { useAgents } from '@/view-models/use-agents';

/** What the value slot cannot say: a paused agent, and one that starts with nobody asking. */
function AgentBadges({ row }: { row: AgentRow }) {
  const { t } = useTranslation();
  if (!row.paused && !row.startsByItself) return null;
  return (
    <View style={styles.badges}>
      {row.paused ? <InkBadge>{t('agents.paused')}</InkBadge> : <InkBadge>{t('agents.startsByItself')}</InkBadge>}
    </View>
  );
}

/** How an agent's prefill stands, in the row's value slot, so a screen reader hears it with the name. */
function statusOf(row: AgentRow, reported: boolean, t: TFunction): string | null {
  const prefill = row.prefill;
  // The Pond keeps no copy for a paused agent, and its Paused badge already says why.
  if (!reported || (prefill === null && row.paused)) return null;
  return prefill ? prefillLabel(prefill.status) : t('agents.prefill.status.unknown');
}

function SuggestionCard({
  suggestion,
  enabling,
  busy,
  error,
  onEnable,
  onDismiss,
}: {
  suggestion: AgentSuggestion;
  enabling: boolean;
  busy: boolean;
  error: string | undefined;
  onEnable: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const errorText = inkText(theme, { size: 'sm', weight: theme.weight.medium, color: theme.color.dangerFg });
  return (
    <InkCard raised={false} contentStyle={styles.suggestion}>
      <InkTitle level={3}>{suggestion.title}</InkTitle>
      <InkText>{suggestion.description}</InkText>
      <View style={styles.fact}>
        <InkText size="sm" weight="semibold">{t('agents.suggested.why')}</InkText>
        <InkText size="sm" tone="secondary">{suggestion.why}</InkText>
      </View>
      <View style={styles.fact}>
        <InkText size="sm" weight="semibold">{t('agents.suggested.when')}</InkText>
        <InkText size="sm" tone="secondary">{suggestion.activations_summary}</InkText>
      </View>
      {suggestion.needs.length > 0 ? (
        <View style={styles.fact}>
          <InkText size="sm" weight="semibold">{t('agents.suggested.uses')}</InkText>
          <InkText size="sm" tone="secondary">{suggestion.needs.join(', ')}</InkText>
        </View>
      ) : null}
      {/* Said where a member turns one on: nothing about it starts before that tap. */}
      <InkText size="sm">{t('agents.suggested.promise')}</InkText>
      {error ? (
        <Text accessibilityRole="alert" style={errorText.style}>
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <InkButton variant="primary" icon="power" onPress={onEnable} disabled={busy}>
          {enabling ? t('agents.suggested.turningOn') : t('agents.suggested.turnOn')}
        </InkButton>
        <InkButton variant="quiet" onPress={onDismiss} disabled={busy}>
          {t('agents.suggested.dismiss')}
        </InkButton>
      </View>
    </InkCard>
  );
}

function BuiltInRow({
  prefill,
  retentionDays,
  rebuilding,
  busy,
  onRebuild,
}: {
  prefill: AgentPrefill;
  retentionDays: number;
  rebuilding: boolean;
  busy: boolean;
  onRebuild: () => void;
}) {
  const { t } = useTranslation();
  const colors = useSettingsColors();
  const name = builtInName(prefill.agent);
  return (
    <SettingsRow
      label={name}
      // Only where the status alone does not say what happens next.
      description={prefill.status === 'idle' || prefill.status === 'failed' ? prefillDetail(prefill.status, retentionDays) : null}
      value={rebuilding ? t('agents.prefill.rebuilding') : prefillLabel(prefill.status)}
      trailing={
        canRebuild(prefill) ? (
          <Pressable
            onPress={onRebuild}
            disabled={busy}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('agents.prefill.rebuildOne', { name })}
            style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: colors.pressed }, busy && styles.dim]}
          >
            <GIcon name="refresh" size={18} color={colors.accent} />
          </Pressable>
        ) : null
      }
    />
  );
}

export default function AgentsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const ask = useConfirm();
  const { data, loading, refreshing, failed, error, notice, rebuilding, enabling, suggestionErrors, actions } = useAgents();

  const busy = rebuilding !== null || enabling !== null;

  const open = useCallback(
    (name?: string) => {
      void selectionTick();
      router.push((name ? { pathname: '/(stack)/agent', params: { name } } : '/(stack)/agent') as never);
    },
    [router],
  );

  const rebuild = useCallback(
    async (name: string) => {
      void tap();
      const ok = await actions.rebuild(name);
      void (ok ? confirm() : reject());
    },
    [actions],
  );

  const rebuildAll = useCallback(async () => {
    const yes = await ask({
      title: t('agents.prefill.rebuildAllConfirmTitle'),
      message: t('agents.prefill.rebuildAllConfirmBody'),
      confirmLabel: t('agents.prefill.rebuildAll'),
    });
    if (!yes) return;
    const ok = await actions.rebuildAll();
    void (ok ? confirm() : reject());
  }, [actions, ask, t]);

  const enable = useCallback(
    async (template: string) => {
      void tap();
      const recipe = await actions.enableSuggestion(template);
      void (recipe ? confirm() : reject());
    },
    [actions],
  );

  return (
    <SettingsScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void actions.refresh()} />}>
      <SettingsHeader icon="agent" tile="indigo" title={t('screens.agents')} description={t('agents.intro')} />

      {data.building ? (
        <View style={styles.block}>
          <AgentsBuildingCard building={data.building} name={data.buildingName} />
        </View>
      ) : null}

      {/* Polite, so a rebuild or a suggestion turned on is announced as the line appears. */}
      <View accessibilityLiveRegion="polite">{notice ? <SettingsNotice tone="success">{notice}</SettingsNotice> : null}</View>
      {error && !failed ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}

      {loading ? (
        <InkSpinner label={t('agents.loading')} />
      ) : failed ? (
        <View style={styles.failed}>
          <SettingsMessage tone="danger">{error ?? t('agents.loadFailed')}</SettingsMessage>
          <InkButton variant="quiet" icon="refresh" onPress={() => void actions.refresh()}>
            {t('common.retry')}
          </InkButton>
        </View>
      ) : (
        <>
          <SettingsGroup
            title={t('agents.yours')}
            footer={
              <View style={styles.footerAction}>
                <InkButton variant="primary" icon="plus" onPress={() => open()}>
                  {t('agents.new')}
                </InkButton>
              </View>
            }
          >
            {data.agents.length === 0 ? <SettingsRow label={t('agents.empty')} /> : null}
            {data.agents.map((row) => (
              <SettingsRow
                key={row.id}
                label={row.title}
                description={row.purpose || t('agents.noPurpose')}
                value={statusOf(row, data.prefillsReported, t)}
                error={row.prefill?.status === 'failed' ? t('agents.prefill.failedRow') : null}
                accessory="next"
                onPress={() => open(row.name)}
              >
                <AgentBadges row={row} />
              </SettingsRow>
            ))}
          </SettingsGroup>

          {data.suggestions.length > 0 ? (
            <View style={styles.block}>
              <InkTitle level={3}>{t('agents.suggested.title')}</InkTitle>
              <InkText size="sm" tone="secondary">
                {t('agents.suggested.intro')}
              </InkText>
              {data.suggestions.map((s) => (
                <SuggestionCard
                  key={s.template}
                  suggestion={s}
                  enabling={enabling === s.template}
                  busy={busy}
                  error={suggestionErrors[s.template]}
                  onEnable={() => void enable(s.template)}
                  onDismiss={() => void actions.dismissSuggestion(s.template)}
                />
              ))}
            </View>
          ) : null}

          {data.prefillsReported ? (
            <>
              {data.builtIn.length > 0 ? (
                <SettingsGroup title={t('agents.builtIn')} footer={t('agents.builtInIntro')}>
                  {data.builtIn.map((p) => (
                    <BuiltInRow
                      key={p.agent}
                      prefill={p}
                      retentionDays={data.retentionDays}
                      rebuilding={rebuilding === p.agent}
                      busy={busy}
                      onRebuild={() => void rebuild(p.agent)}
                    />
                  ))}
                </SettingsGroup>
              ) : null}
              <SettingsGroup
                title={t('agents.prefill.title')}
                footer={t('agents.prefill.explain', { days: data.retentionDays })}
              >
                <SettingsRow
                  label={rebuilding === '*' ? t('agents.prefill.rebuilding') : t('agents.prefill.rebuildAll')}
                  description={t('agents.prefill.rebuildAllHint')}
                  icon="refresh"
                  tile="indigo"
                  action
                  disabled={busy}
                  onPress={() => void rebuildAll()}
                />
              </SettingsGroup>
            </>
          ) : (
            <SettingsNotice tone="neutral">{t('agents.prefill.notReported')}</SettingsNotice>
          )}
        </>
      )}
    </SettingsScroll>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.md, marginBottom: Spacing.xl },
  failed: { alignItems: 'center', gap: Spacing.md },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs },
  suggestion: { gap: Spacing.sm },
  fact: { gap: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap', marginTop: Spacing.xs },
  iconButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.4 },
  footerAction: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: Spacing.md },
});
