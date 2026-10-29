// The household's long tasks and what each saved. The member's own tasks open their report; another
// member's task is shown by its size and dates only.

import React, { useCallback } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkSpinner } from '@jarida/ink/native';

import { AdminLockView } from '@/components/pond/admin-lock';
import { SettingsGroup, SettingsHeader, SettingsMessage, SettingsRow } from '@/components/settings/settings-list';
import { SettingsNotice, SettingsScroll } from '@/components/settings/settings-scroll';
import { useSettingsColors } from '@/components/settings/settings-theme';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { Spacing } from '@/constants/spacing';
import { isTaskFinished } from '@/models/pond-admin';
import { confirm, selectionTick } from '@/services/haptics';
import type { AdminTask, AdminTaskArtifact } from '@/services/types';
import { taskEyebrow, taskStateIcon } from '@/view-models/long-task-words';
import { adminTaskState, artifactKindLabel, whenWords } from '@/view-models/pond-admin-words';
import { taskName, usePondTasks } from '@/view-models/use-pond-tasks';

export default function PondTasksScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useSettingsColors();
  const { gate, tasks, loading, failed, error, notice, removing, actions } = usePondTasks();

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

  return (
    <SettingsScroll refreshControl={<RefreshControl refreshing={false} onRefresh={() => void actions.refresh()} />}>
      <SettingsHeader icon="logs" tile="indigo" title={t('screens.pondTasks')} description={t('myPond.tasks.intro')} />
      <View accessibilityLiveRegion="polite">{notice ? <SettingsNotice tone="success">{notice}</SettingsNotice> : null}</View>
      {error && !failed ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}

      {loading ? (
        <InkSpinner label={t('myPond.tasks.loading')} />
      ) : failed ? (
        <View>
          <SettingsMessage tone="danger">{error ?? t('myPond.tasks.readFailed')}</SettingsMessage>
          <InkButton variant="quiet" icon="refresh" onPress={() => void actions.refresh()}>
            {t('common.retry')}
          </InkButton>
        </View>
      ) : tasks.length === 0 ? (
        <SettingsMessage>{t('myPond.tasks.none')}</SettingsMessage>
      ) : (
        tasks.map((task) => {
          const finished = isTaskFinished(task.state);
          const started = whenWords(task.created_at);
          const ended = whenWords(task.finished_at);
          const dates = [
            started ? t('myPond.tasks.started', { when: started }) : null,
            ended ? t('myPond.tasks.finished', { when: ended }) : null,
          ]
            .filter(Boolean)
            .join('\n');
          const ownReport = !task.another_member && task.has_report;
          return (
            <SettingsGroup
              key={task.id}
              title={taskEyebrow(task.kind, '')}
              footer={
                finished ? (
                  <View style={styles.footer}>
                    <InkButton variant="quiet" icon="trash" disabled={removing !== null} onPress={() => void removeTask(task)}>
                      {removing === task.id ? t('myPond.tasks.deleting') : t('myPond.tasks.deleteTask')}
                    </InkButton>
                  </View>
                ) : (
                  t('myPond.tasks.activeHint')
                )
              }
            >
              <SettingsRow
                label={taskName(task)}
                icon={task.state ? taskStateIcon(task.state) : 'info'}
                tile={task.another_member ? 'slate' : 'indigo'}
                description={adminTaskState(task.state)}
                value={t('myPond.tasks.artifacts', { count: task.artifacts.length })}
                note={dates || null}
                accessory={ownReport ? 'next' : 'none'}
                onPress={ownReport ? () => openReport(task) : undefined}
              />
              {task.artifacts.map((artifact) => {
                const when = whenWords(artifact.created_at);
                return (
                  <SettingsRow
                    key={artifact.id}
                    label={artifact.title ?? artifactKindLabel(artifact.kind)}
                    description={[artifactKindLabel(artifact.kind), when].filter(Boolean).join(' · ')}
                    value={t('myPond.tasks.tokens', { count: artifact.tokens })}
                    trailing={
                      finished ? (
                        <GPressable
                          hitSlop={10}
                          disabled={removing !== null}
                          onPress={() => void removeArtifact(task, artifact)}
                          accessibilityRole="button"
                          accessibilityLabel={t('myPond.tasks.deleteArtifactNamed', {
                            name: artifact.title ?? artifactKindLabel(artifact.kind),
                          })}
                          style={styles.delete}
                        >
                          {removing === artifact.id ? (
                            <InkSpinner label={t('myPond.tasks.deleting')} size={16} />
                          ) : (
                            <GIcon name="trash" size={18} color={colors.danger} />
                          )}
                        </GPressable>
                      ) : null
                    }
                  />
                );
              })}
            </SettingsGroup>
          );
        })
      )}
    </SettingsScroll>
  );
}

const styles = StyleSheet.create({
  footer: { alignItems: 'flex-start', marginTop: Spacing.sm },
  delete: { padding: Spacing.xs },
});
