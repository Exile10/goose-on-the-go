// One agent, or a new one with no `name`. When it runs, its hooks and sharing are said in words and
// kept as they are; the dashboard changes those.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkSpinner, InkText, inkText, useInkTheme } from '@jarida/ink/native';

import { radioRows, SwitchRow } from '@/components/settings/setting-controls';
import { SettingsGroup, SettingsMessage, SettingsRow } from '@/components/settings/settings-list';
import { SettingsNotice, SettingsScroll } from '@/components/settings/settings-scroll';
import { useSettingsColors, useSettingsStyles, type SettingsColors, type SettingsMetrics, type SettingsType } from '@/components/settings/settings-theme';
import type { IconName } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import { AGENT_TOOL_GROUPS, canRebuild, DEFAULT_ACTIVATIONS, DEFAULT_RETENTION_DAYS, startsByItself, type Activation } from '@/models/agents';
import { useConfirm } from '@/providers/confirm-provider';
import { confirm, reject, tap } from '@/services/haptics';
import { describeActivation, describeAfter, describeBefore, prefillDetail, prefillLabel, prefillTimes } from '@/view-models/agent-words';
import { useAgentEditor } from '@/view-models/use-agent-editor';

const ACTIVATION_ICON: Record<Activation['kind'], IconName> = {
  delegated: 'chat',
  task_step: 'check',
  schedule: 'schedule',
  event: 'bolt',
  agent: 'link',
  other: 'info',
};

/** A field typed on every keystroke, unlike `TextRow`, which saves when typing ends. */
function FieldRow({
  label,
  description,
  error,
  value,
  onChange,
  placeholder,
  multiline,
  numeric,
  plain,
  disabled,
}: {
  label: string;
  description?: string | null;
  error?: string | null;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  numeric?: boolean;
  /** A name, not words: no capitals, no corrections. */
  plain?: boolean;
  disabled?: boolean;
}) {
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  return (
    <SettingsRow label={label} description={description} error={error}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        multiline={multiline}
        editable={!disabled}
        keyboardType={numeric ? 'number-pad' : 'default'}
        autoCapitalize={plain ? 'none' : 'sentences'}
        autoCorrect={!plain}
        accessibilityLabel={label}
        style={[multiline ? styles.area : styles.input, error ? { borderColor: colors.danger } : null]}
      />
    </SettingsRow>
  );
}

export default function AgentScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const ask = useConfirm();
  const theme = useInkTheme();
  const params = useLocalSearchParams<{ name?: string }>();
  const [name] = useState(() => (typeof params.name === 'string' && params.name !== '' ? params.name : null));
  const { data, load, saving, deleting, rebuilding, error, notice, actions } = useAgentEditor(name);
  const [leaving, setLeaving] = useState(false);

  const title = data.agent ? data.form.title.trim() || data.agent.name : t('screens.newAgent');
  const errorText = inkText(theme, { size: 'sm', weight: theme.weight.medium, color: theme.color.dangerFg });

  // Typed instructions are the one thing here that is slow to write again.
  const guard = data.dirty && !leaving;
  const letGo = useRef(false);
  useEffect(() => {
    if (!guard) return;
    return navigation.addListener('beforeRemove', (e) => {
      if (letGo.current) return;
      e.preventDefault();
      void ask({
        title: t('agents.editor.leaveTitle'),
        message: t('agents.editor.leaveBody'),
        confirmLabel: t('agents.editor.leave'),
        destructive: true,
      }).then((yes) => {
        if (!yes) return;
        letGo.current = true;
        navigation.dispatch(e.data.action);
      });
    });
  }, [ask, guard, navigation, t]);

  const save = useCallback(async () => {
    void tap();
    const saved = await actions.save();
    void (saved ? confirm() : reject());
  }, [actions]);

  const remove = useCallback(async () => {
    const yes = await ask({
      title: t('agents.editor.deleteConfirmTitle', { title }),
      message: t('agents.editor.deleteConfirmBody'),
      confirmLabel: t('agents.editor.delete'),
      destructive: true,
    });
    if (!yes) return;
    const gone = await actions.remove();
    void (gone ? confirm() : reject());
    if (gone) {
      setLeaving(true);
      setTimeout(() => router.back(), 0);
    }
  }, [actions, ask, router, t, title]);

  const rebuild = useCallback(async () => {
    void tap();
    const ok = await actions.rebuild();
    void (ok ? confirm() : reject());
  }, [actions]);

  if (load !== 'ready') {
    return (
      <SettingsScroll>
        <Stack.Screen options={{ title: t('screens.agent') }} />
        {load === 'loading' ? <InkSpinner label={t('agents.editor.loading')} /> : null}
        {load === 'failed' ? (
          <View style={styles.centre}>
            <SettingsMessage tone="danger">{t('agents.editor.loadFailed')}</SettingsMessage>
            <InkButton variant="quiet" icon="refresh" onPress={() => void actions.retry()}>
              {t('common.retry')}
            </InkButton>
          </View>
        ) : null}
        {load === 'gone' ? <SettingsMessage>{t('agents.editor.gone')}</SettingsMessage> : null}
      </SettingsScroll>
    );
  }

  const { form, reading, fieldErrors } = data;
  // A new agent is written with the Pond's two defaults, so those are what it shows.
  const activations = reading?.activations ?? DEFAULT_ACTIVATIONS;
  const before = reading ? describeBefore(reading.before) : null;
  const after = reading ? describeAfter(reading.after) : null;
  const runs = !reading
    ? t('agents.editor.runsNew')
    : startsByItself(reading.activations)
      ? t('agents.editor.runsByItself')
      : t('agents.editor.runsAsked');
  const kept = form.toolGroups.filter((g) => !AGENT_TOOL_GROUPS.some((known) => known.name === g));
  const times = data.prefill ? prefillTimes(data.prefill) : null;
  const busy = saving || deleting;

  return (
    <SettingsScroll typing>
      {/* A swipe back cannot be asked about once it has started, so it waits until nothing is unsaved. */}
      <Stack.Screen options={{ title, gestureEnabled: !guard }} />

      <View accessibilityLiveRegion="polite">{notice ? <SettingsNotice tone="success">{notice}</SettingsNotice> : null}</View>

      {data.unreadable ? (
        <SettingsNotice tone="warning">
          {data.unreadable.line ? t('agents.editor.unreadableLine', { line: data.unreadable.line }) : t('agents.editor.unreadable')}
        </SettingsNotice>
      ) : (
        <>
          <SettingsGroup title={t('agents.editor.purposeTitle')} footer={t('agents.editor.purposeLead')}>
            <FieldRow
              label={t('agents.editor.name')}
              value={form.title}
              onChange={(text) => actions.setField('title', text)}
              placeholder={t('agents.editor.namePlaceholder')}
              error={fieldErrors.title}
              disabled={busy}
            />
            {data.nameLocked ? (
              <SettingsRow label={t('agents.editor.savedAs')} value={data.name} description={t('agents.editor.savedAsFixed')} />
            ) : (
              <FieldRow
                label={t('agents.editor.savedAs')}
                description={t('agents.editor.savedAsHint')}
                value={data.name}
                onChange={actions.setName}
                error={data.nameProblem}
                plain
                disabled={busy}
              />
            )}
            <FieldRow
              label={t('agents.editor.description')}
              description={t('agents.editor.descriptionHint')}
              value={form.description}
              onChange={(text) => actions.setField('description', text)}
              error={fieldErrors.description}
              disabled={busy}
            />
            <FieldRow
              label={t('agents.editor.instructions')}
              description={t('agents.editor.instructionsHint')}
              value={form.instructions}
              onChange={(text) => actions.setField('instructions', text)}
              placeholder={t('agents.editor.instructionsPlaceholder')}
              error={fieldErrors.instructions}
              multiline
              disabled={busy}
            />
            <FieldRow
              label={t('agents.editor.maxTurns')}
              description={t('agents.editor.maxTurnsHint')}
              value={form.maxTurns}
              onChange={(text) => actions.setField('maxTurns', text)}
              error={fieldErrors.maxTurns}
              numeric
              disabled={busy}
            />
          </SettingsGroup>

          <SettingsGroup title={t('agents.editor.toolsTitle')} footer={fieldErrors.toolGroups ?? t('agents.editor.toolsLead')}>
            {AGENT_TOOL_GROUPS.map((group) => (
              <SwitchRow
                key={group.name}
                label={t(group.labelKey)}
                value={form.toolGroups.includes(group.name)}
                onChange={() => actions.toggleTool(group.name)}
                disabled={busy}
              />
            ))}
            {kept.map((group) => (
              <SwitchRow
                key={group}
                label={group}
                description={t('agents.editor.toolKept')}
                value
                onChange={() => actions.toggleTool(group)}
                disabled={busy}
              />
            ))}
          </SettingsGroup>

          <SettingsGroup title={t('agents.editor.dataTitle')} footer={fieldErrors.personalData ?? t('agents.editor.dataLead')}>
            {radioRows({
              name: 'personal-data',
              value: form.personalData,
              options: [
                { value: 'inherit', labelKey: 'agents.editor.dataInherit', hintKey: 'agents.editor.dataInheritBody' },
                { value: 'deny', labelKey: 'agents.editor.dataDeny', hintKey: 'agents.editor.dataDenyBody' },
              ],
              onChange: (value) => actions.setField('personalData', value),
              disabled: busy,
              t,
            })}
          </SettingsGroup>

          <SettingsGroup title={t('agents.editor.runsTitle')} footer={runs}>
            {activations.length === 0 ? (
              <SettingsRow label={t('agents.editor.runsNothing')} />
            ) : (
              activations.map((a, i) => <SettingsRow key={i} icon={ACTIVATION_ICON[a.kind]} tile="indigo" label={describeActivation(a)} />)
            )}
            {before ? <SettingsRow label={before} /> : null}
            {after ? <SettingsRow label={after} /> : null}
            {reading?.shared ? <SettingsRow icon="link" tile="blue" label={t('agents.editor.shared')} /> : null}
          </SettingsGroup>

          {data.otherErrors.length > 0 ? (
            <SettingsGroup title={t('agents.editor.otherProblems')}>
              {data.otherErrors.map((e, i) => (
                <SettingsRow key={`${e.path}:${i}`} label={e.message} description={e.path || null} />
              ))}
            </SettingsGroup>
          ) : null}
        </>
      )}

      {data.agent && data.prefillsReported ? (
        <SettingsGroup title={t('agents.editor.copyTitle')} footer={canRebuild(data.prefill) ? t('agents.prefill.rebuildHint') : null}>
          <SettingsRow
            label={data.prefill ? prefillLabel(data.prefill.status) : t('agents.prefill.status.unknown')}
            description={
              data.prefill
                ? prefillDetail(data.prefill.status, data.retentionDays ?? DEFAULT_RETENTION_DAYS)
                : t('agents.prefill.detail.unknown')
            }
            destructive={data.prefill?.status === 'failed'}
          />
          {times ? <SettingsRow label={t('agents.prefill.compiled')} value={times.compiled || t('agents.prefill.never')} /> : null}
          {times ? <SettingsRow label={t('agents.prefill.lastUsed')} value={times.used || t('agents.prefill.never')} /> : null}
          {canRebuild(data.prefill) ? (
            <SettingsRow
              label={rebuilding ? t('agents.prefill.rebuilding') : t('agents.prefill.rebuild')}
              icon="refresh"
              tile="indigo"
              action
              disabled={rebuilding || busy}
              onPress={() => void rebuild()}
            />
          ) : null}
        </SettingsGroup>
      ) : null}

      {error ? (
        <Text accessibilityRole="alert" style={[errorText.style, styles.error]}>
          {error}
        </Text>
      ) : null}

      {data.unreadable ? null : (
        <View style={styles.footer}>
          <View style={styles.state}>
            <InkText size="sm" tone="secondary">
              {saving ? t('agents.editor.saving') : data.dirty ? t('agents.editor.unsaved') : t('agents.editor.noChanges')}
            </InkText>
          </View>
          <InkButton variant="primary" icon="check" onPress={() => void save()} disabled={busy || !data.dirty}>
            {t('common.save')}
          </InkButton>
        </View>
      )}

      {data.agent ? (
        <SettingsGroup>
          <SettingsRow
            label={deleting ? t('agents.editor.deleting') : t('agents.editor.delete')}
            icon="trash"
            tile="red"
            destructive
            disabled={busy}
            onPress={() => void remove()}
          />
        </SettingsGroup>
      ) : null}
    </SettingsScroll>
  );
}

const makeStyles = (c: SettingsColors, type: SettingsType, m: SettingsMetrics) => ({
  input: {
    ...type.body,
    marginTop: Spacing.sm,
    borderRadius: m.radius.md,
    borderWidth: m.hairline,
    borderColor: c.edge,
    backgroundColor: c.group,
    paddingHorizontal: m.gap,
    paddingVertical: Spacing.sm,
    minHeight: 44,
  },
  area: {
    ...type.body,
    marginTop: Spacing.sm,
    minHeight: 160,
    textAlignVertical: 'top' as const,
    borderRadius: m.radius.md,
    borderWidth: m.hairline,
    borderColor: c.edge,
    backgroundColor: c.group,
    paddingHorizontal: m.gap,
    paddingVertical: Spacing.sm,
  },
});

const styles = StyleSheet.create({
  centre: { alignItems: 'center', gap: Spacing.md },
  error: { marginBottom: Spacing.md },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, marginBottom: Spacing.xl },
  state: { flexShrink: 1 },
});
