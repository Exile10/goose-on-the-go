// The household's long tasks and what each saved. The member's own tasks open their report; another
// member's task is shown by its size and dates only.

import React, { useCallback, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkBadge, InkButton, InkEdge, InkEyebrow, InkSegmented, InkSpinner, inkText, useInkTheme } from '@/components/ui/ink';

import { AdminLockView } from '@/components/pond/admin-lock';
import { DangerQuietButton } from '@/components/pond/danger-quiet-button';
import { SettingsMessage } from '@/components/settings/settings-list';
import { SettingsNotice, SettingsScroll } from '@/components/settings/settings-scroll';
import { useSettingsColors, useSettingsStyles, type SettingsColors, type SettingsMetrics, type SettingsType } from '@/components/settings/settings-theme';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { Spacing } from '@/constants/spacing';
import { approxWords, isTaskFinished, type TaskFilter } from '@/models/pond-admin';
import { confirm, selectionTick } from '@/services/haptics';
import type { AdminTask, AdminTaskArtifact } from '@/services/types';
import { adminTaskState, artifactKindLabel, taskKindLabel, taskMetaWords, taskStateTone } from '@/view-models/pond-admin-words';
import { taskName, usePondTasks } from '@/view-models/use-pond-tasks';

/** Enough to see what a task saved without the list running on past the next task. */
const ARTIFACTS_SHOWN = 2;

function ArtifactRow({
  artifact,
  removing,
  onRemove,
}: {
  artifact: AdminTaskArtifact;
  removing: string | null;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  const kind = artifactKindLabel(artifact.kind);
  const words = approxWords(artifact.tokens);
  const name = artifact.title ?? kind;
  return (
    <View style={styles.artifact}>
      <View style={styles.artifactText}>
        <Text style={styles.artifactName}>{name}</Text>
        <Text style={styles.small}>{[kind, words === null ? null : t('myPond.tasks.aboutWords', { count: words, words: words.toLocaleString() })].filter(Boolean).join(t('myPond.dot'))}</Text>
      </View>
      <GPressable
        disabled={removing !== null}
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={t('myPond.tasks.deleteArtifactNamed', { name })}
        style={styles.trash}
      >
        {removing === artifact.id ? (
          <InkSpinner label={t('myPond.tasks.deleting')} size={16} />
        ) : (
          <GIcon name="trash" size={17} color={colors.danger} />
        )}
      </GPressable>
    </View>
  );
}

function TaskCard({
  task,
  lead,
  removing,
  onOpen,
  onRemove,
  onRemoveArtifact,
}: {
  task: AdminTask;
  lead: boolean;
  removing: string | null;
  onOpen: (task: AdminTask) => void;
  onRemove: (task: AdminTask) => void;
  onRemoveArtifact: (task: AdminTask, artifact: AdminTaskArtifact) => void;
}) {
  const { t } = useTranslation();
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  const theme = useInkTheme();
  const [expanded, setExpanded] = useState(false);
  const finished = isTaskFinished(task.state);
  const goal = inkText(theme, { size: 'md', weight: theme.weight.bold, leading: 'snug' }).style;
  const listed = finished && !task.another_member ? task.artifacts : [];
  const shown = expanded ? listed : listed.slice(0, ARTIFACTS_SHOWN);
  const hidden = listed.length - shown.length;

  return (
    // Raised only for the report the screen leads with, so the edge still means something here.
    <InkEdge raised={lead} radius={theme.radius.lg} style={styles.cardWrap} contentStyle={styles.card}>
      <View style={styles.top}>
        <View style={styles.chips}>
          <InkBadge tone={task.kind === 'research' ? 'brand' : 'neutral'}>{taskKindLabel(task)}</InkBadge>
          <InkBadge tone={taskStateTone(task.state)}>{adminTaskState(task.state)}</InkBadge>
        </View>
        {task.another_member ? (
          <View style={styles.withIcon}>
            <GIcon name="eye-off" size={16} color={colors.textSecondary} />
            <Text style={[goal, { color: colors.textSecondary }]}>{t('myPond.tasks.anotherMember')}</Text>
          </View>
        ) : (
          <Text style={goal}>{taskName(task)}</Text>
        )}
        <Text style={styles.small}>{taskMetaWords(task, new Date())}</Text>
        {finished ? (
          <View style={styles.actions}>
            {!task.another_member && task.has_report ? (
              <InkButton variant={lead ? 'primary' : 'quiet'} icon="file" onPress={() => onOpen(task)}>
                {t('myPond.tasks.openReport')}
              </InkButton>
            ) : null}
            <DangerQuietButton disabled={removing !== null} onPress={() => onRemove(task)}>
              {removing === task.id ? t('myPond.tasks.deleting') : t('myPond.tasks.deleteTask')}
            </DangerQuietButton>
          </View>
        ) : (
          <View style={styles.withIcon}>
            <GIcon name="info" size={14} color={colors.textSecondary} />
            <Text style={styles.small}>{t('myPond.tasks.activeHint')}</Text>
          </View>
        )}
      </View>

      {listed.length > 0 ? (
        <View style={[styles.artifacts, { backgroundColor: theme.color.content }]}>
          <View style={styles.artifactsTitle}>
            <InkEyebrow>{t('myPond.tasks.artifactsTitle')}</InkEyebrow>
          </View>
          {shown.map((artifact, i) => (
            <View key={artifact.id}>
              {i > 0 ? <View style={styles.hairline} /> : null}
              <ArtifactRow artifact={artifact} removing={removing} onRemove={() => onRemoveArtifact(task, artifact)} />
            </View>
          ))}
          {hidden > 0 || expanded ? (
            <GPressable
              onPress={() => {
                void selectionTick();
                setExpanded((e) => !e);
              }}
              accessibilityRole="button"
              style={styles.more}
            >
              <Text style={styles.moreText}>{hidden > 0 ? t('myPond.tasks.showOthers', { count: hidden }) : t('myPond.tasks.showFewer')}</Text>
            </GPressable>
          ) : null}
        </View>
      ) : null}
    </InkEdge>
  );
}

export default function PondTasksScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useSettingsStyles(makeStyles);
  const { gate, tasks, filter, counts, lead, loading, failed, error, notice, removing, actions } = usePondTasks();

  const openReport = useCallback(
    (task: AdminTask) => {
      void selectionTick();
      router.push({ pathname: '/(stack)/task-report', params: { id: task.id } } as never);
    },
    [router],
  );

  const removeTask = useCallback(
    async (task: AdminTask) => {
      if (await actions.removeTask(task)) void confirm();
    },
    [actions],
  );

  const removeArtifact = useCallback(
    async (task: AdminTask, artifact: AdminTaskArtifact) => {
      if (await actions.removeArtifact(task, artifact)) void confirm();
    },
    [actions],
  );

  if (gate.phase !== 'unlocked' && gate.phase !== 'checking') {
    return (
      <SettingsScroll typing>
        <AdminLockView onRetry={() => void actions.refresh()} />
      </SettingsScroll>
    );
  }

  const empty =
    filter === 'finished' ? t('myPond.tasks.noneFinished') : filter === 'working' ? t('myPond.tasks.noneWorking') : t('myPond.tasks.none');

  return (
    <SettingsScroll refreshControl={<RefreshControl refreshing={false} onRefresh={() => void actions.refresh()} />}>
      <InkSegmented<TaskFilter>
        label={t('myPond.tasks.filter')}
        value={filter}
        options={[
          { value: 'all', label: t('myPond.tasks.all'), meta: String(counts.all) },
          { value: 'finished', label: t('myPond.tasks.finishedFilter'), meta: String(counts.finished) },
          { value: 'working', label: t('myPond.tasks.working'), meta: String(counts.working) },
        ]}
        onChange={(next) => {
          void selectionTick();
          actions.setFilter(next);
        }}
        style={styles.filter}
      />
      <View accessibilityLiveRegion="polite">{notice ? <SettingsNotice tone="success">{notice}</SettingsNotice> : null}</View>
      {error && !failed ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}

      {loading ? (
        <InkSpinner label={t('myPond.tasks.loading')} />
      ) : failed ? (
        <View style={styles.failed}>
          <SettingsMessage tone="danger">{error ?? t('myPond.tasks.readFailed')}</SettingsMessage>
          <InkButton variant="quiet" icon="refresh" onPress={() => void actions.refresh()}>
            {t('common.retry')}
          </InkButton>
        </View>
      ) : tasks.length === 0 ? (
        <SettingsMessage>{empty}</SettingsMessage>
      ) : (
        tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            lead={task.id === lead}
            removing={removing}
            onOpen={openReport}
            onRemove={(x) => void removeTask(x)}
            onRemoveArtifact={(x, a) => void removeArtifact(x, a)}
          />
        ))
      )}
    </SettingsScroll>
  );
}

const makeStyles = (c: SettingsColors, type: SettingsType, m: SettingsMetrics) => ({
  filter: { marginBottom: Spacing.lg },
  failed: { alignItems: 'center' as const, gap: Spacing.md },
  cardWrap: { marginBottom: Spacing.md },
  card: { overflow: 'hidden' as const },
  top: { gap: Spacing.sm, paddingHorizontal: m.rowH, paddingVertical: Spacing.md + 2 },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, alignItems: 'center' as const, gap: Spacing.sm },
  withIcon: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  small: { ...type.description, flexShrink: 1 },
  actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: Spacing.sm + 2, marginTop: Spacing.xs },
  artifacts: { borderTopWidth: m.hairline, borderTopColor: c.line },
  artifactsTitle: { paddingHorizontal: m.rowH, paddingTop: Spacing.sm + 2, paddingBottom: Spacing.xs },
  artifact: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Spacing.sm + 2,
    minHeight: 48,
    paddingLeft: m.rowH,
    paddingRight: 6,
    paddingVertical: 6,
  },
  artifactText: { flex: 1, minWidth: 0 },
  artifactName: type.label,
  hairline: { height: m.hairline, backgroundColor: c.line },
  trash: { width: m.tapMin, height: m.tapMin, alignItems: 'center' as const, justifyContent: 'center' as const },
  more: { minHeight: m.tapMin, justifyContent: 'center' as const, paddingHorizontal: m.rowH, paddingBottom: 6 },
  moreText: { ...type.label, color: c.accent },
});
