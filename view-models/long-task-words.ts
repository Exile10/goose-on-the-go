// A long task's state in the Pond's own words (pond-mcp-server `state_phrase`), except that a
// cancelled task reads "Stopped", because the control that ends it here is called Stop.

import type { IconName } from '@/constants/icons';
import { progressOf } from '@/models/long-tasks';
import i18n from '@/services/i18n';
import type { LongTaskKind, LongTaskState, LongTaskStep, LongTaskStepState } from '@/services/types';

export function taskStateLabel(state: LongTaskState): string {
  switch (state) {
    case 'planning':
      return i18n.t('chat.longTask.state.planning');
    case 'running':
      return i18n.t('chat.longTask.state.running');
    case 'awaiting_approval':
      return i18n.t('chat.longTask.state.awaitingApproval');
    case 'paused':
      return i18n.t('chat.longTask.state.paused');
    case 'completed':
      return i18n.t('chat.longTask.state.completed');
    case 'failed':
      return i18n.t('chat.longTask.state.failed');
    case 'cancelled':
      return i18n.t('chat.longTask.state.cancelled');
  }
}

/** What a waiting state means for the person reading; null where the label says it all. */
export function taskStateNote(state: LongTaskState): string | null {
  if (state === 'awaiting_approval') return i18n.t('chat.longTask.note.awaitingApproval');
  if (state === 'paused') return i18n.t('chat.longTask.note.paused');
  return null;
}

export function taskStateIcon(state: LongTaskState): IconName {
  switch (state) {
    case 'planning':
      return 'sparkle';
    case 'running':
      return 'activity';
    case 'awaiting_approval':
      return 'warn';
    case 'paused':
      return 'pause';
    case 'completed':
      return 'check';
    case 'failed':
      return 'warn';
    case 'cancelled':
      return 'stop';
  }
}

export function stepStateLabel(state: LongTaskStepState): string {
  switch (state) {
    case 'pending':
      return i18n.t('chat.longTask.step.pending');
    case 'running':
      return i18n.t('chat.longTask.step.running');
    case 'completed':
      return i18n.t('chat.longTask.step.completed');
    case 'failed':
      return i18n.t('chat.longTask.step.failed');
    case 'skipped':
      return i18n.t('chat.longTask.step.skipped');
    case 'awaiting_approval':
      return i18n.t('chat.longTask.step.awaitingApproval');
  }
}

/** "2 of 4 steps done", as the Pond counts them. */
export function progressLine(steps: readonly LongTaskStep[]): string {
  const { done, total, skipped } = progressOf(steps);
  if (total === 0) return i18n.t('chat.longTask.noPlan');
  return skipped > 0
    ? i18n.t('chat.longTask.progressSkipped', { done, total, skipped })
    : i18n.t('chat.longTask.progress', { done, total });
}

/** "Deep research" for a task asked for as research; until it is read, the call's id says which. */
export function taskEyebrow(kind: LongTaskKind | null, callId: string): string {
  const research = kind ? kind === 'research' : callId.startsWith('deep-research-');
  return research ? i18n.t('chat.longTask.researchEyebrow') : i18n.t('chat.longTask.eyebrow');
}
