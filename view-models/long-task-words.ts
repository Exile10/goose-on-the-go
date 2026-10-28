// A long task's state in the Pond's own words (pond-mcp-server `state_phrase`), except that a
// cancelled task reads "Stopped", because the control that ends it here is called Stop.

import type { IconName } from '@/constants/icons';
import { isOwnAhead, isWaiting, progressOf } from '@/models/long-tasks';
import i18n from '@/services/i18n';
import type { LongTask, LongTaskAhead, LongTaskKind, LongTaskState, LongTaskStep, LongTaskStepState } from '@/services/types';

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

/** English ordinals, chosen here rather than by the platform's plural rules, which Hermes may not have. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return i18n.t('chat.longTask.queue.ordinal.other', { n });
  switch (n % 10) {
    case 1:
      return i18n.t('chat.longTask.queue.ordinal.one', { n });
    case 2:
      return i18n.t('chat.longTask.queue.ordinal.two', { n });
    case 3:
      return i18n.t('chat.longTask.queue.ordinal.few', { n });
    default:
      return i18n.t('chat.longTask.queue.ordinal.other', { n });
  }
}

/** Where a task stands in the line: the one under way, or its place. */
export function placeWords(position: number): string {
  return position <= 1 ? i18n.t('chat.longTask.queue.workingNow') : i18n.t('chat.longTask.queue.inLine', { ordinal: ordinal(position) });
}

/** The card's state line. A task behind others says where it is in line, not that it is planning. */
export function taskLabel(task: Pick<LongTask, 'state' | 'queue'>): string {
  if (task.queue && isWaiting(task)) return i18n.t('chat.longTask.queue.waiting', { place: placeWords(task.queue.position) });
  return taskStateLabel(task.state);
}

export function taskIcon(task: Pick<LongTask, 'state' | 'queue'>): IconName {
  return isWaiting(task) ? 'schedule' : taskStateIcon(task.state);
}

/** Who is ahead, without naming another member's task: "Ahead of this one: 2 of your tasks and 1 for another member." */
export function aheadWords(ahead: readonly LongTaskAhead[]): string {
  const yours = ahead.filter(isOwnAhead).length;
  const others = ahead.length - yours;
  const mine = yours > 0 ? i18n.t('chat.longTask.queue.aheadYours', { count: yours }) : null;
  const theirs = others > 0 ? i18n.t('chat.longTask.queue.aheadOthers', { count: others }) : null;
  const who = mine && theirs ? i18n.t('chat.longTask.queue.aheadBoth', { yours: mine, others: theirs }) : (mine ?? theirs ?? '');
  return i18n.t('chat.longTask.queue.ahead', { who });
}

/** "Plan a weekend away (this one)" for the task whose card this is; any other by its goal. */
export function choiceGoal(goal: string, isThis: boolean): string {
  return isThis ? i18n.t('chat.longTask.queue.thisOne', { goal }) : goal;
}

export function stopPickedLabel(count: number): string {
  return i18n.t('chat.longTask.queue.apply', { count });
}

export function stoppedWords(count: number): string {
  return i18n.t('chat.longTask.queue.stopped', { count });
}

/** "Could not stop Plan a weekend away: your Pond is busy. Try again." */
export function stopFailedWords(failures: readonly { goal: string; reason: string }[]): string {
  const each = failures.map((f) => i18n.t('chat.longTask.queue.failure', { goal: f.goal, reason: f.reason }));
  return i18n.t('chat.longTask.queue.failed', { failures: each.join('; ') });
}
