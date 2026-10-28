// pond-desktop's sentences (src/agents/agentWords.ts), so the phone and the dashboard describe an
// agent alike; a schedule is said as the phone's own Schedule screen says one.

import type { InkTone } from '@jarida/ink';

import { HAND_TO, type Activation, type AfterHook } from '@/models/agents';
import { describeCron, formatScheduleTime } from '@/models/schedule';
import i18n, { type TranslationKey } from '@/services/i18n';
import type { AgentPrefill, PrefillStatus } from '@/services/types';

/** "a, b and c", the way the desktop joins a list. */
export function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return i18n.t('agents.words.list', { rest: items.slice(0, -1).join(', '), last: items[items.length - 1] });
}

function isAny(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === '' || v === 'any';
}

/** Who an event names. Member ids are not shown: a profile id is not a name. */
function who(member: string): string {
  if (isAny(member)) return i18n.t('agents.words.someone');
  if (member.trim().toLowerCase() === 'owner') return i18n.t('agents.words.owner');
  return i18n.t('agents.words.member');
}

function describeEvent(e: Extract<Activation, { kind: 'event' }>): string {
  const on = e.on.trim().toLowerCase();
  if (on === 'presence.arrive') return i18n.t('agents.words.arrive', { who: who(e.member) });
  if (on === 'presence.leave') return i18n.t('agents.words.leave', { who: who(e.member) });
  if (on === 'camera.person') {
    return isAny(e.camera) ? i18n.t('agents.words.cameraPerson') : i18n.t('agents.words.namedCameraPerson', { camera: e.camera });
  }
  if (on === 'camera.motion') {
    return isAny(e.camera) ? i18n.t('agents.words.cameraMotion') : i18n.t('agents.words.namedCameraMotion', { camera: e.camera });
  }
  if (on === 'time.daily') {
    return /^\d{1,2}:\d{2}$/.test(e.at.trim())
      ? i18n.t('agents.words.daily', { time: e.at.trim() })
      : i18n.t('agents.words.dailyUnset');
  }
  if (on.startsWith('sensor.') && on.length > 'sensor.'.length) {
    const type = on.slice('sensor.'.length);
    const below = e.below.trim() !== '' && e.above.trim() === '';
    const value = (below ? e.below : e.above).trim() || i18n.t('agents.words.aLimit');
    return below ? i18n.t('agents.words.sensorBelow', { type, value }) : i18n.t('agents.words.sensorAbove', { type, value });
  }
  if (on.startsWith('device.') && on.length > 'device.'.length) {
    return i18n.t('agents.words.deviceChange', { key: on.slice('device.'.length) });
  }
  return i18n.t('agents.words.otherEvent', { on: e.on.trim() });
}

export function describeActivation(a: Activation): string {
  switch (a.kind) {
    case 'delegated':
      return i18n.t('agents.words.delegated');
    case 'task_step':
      return i18n.t('agents.words.taskStep');
    case 'schedule':
      return describeCron(a.cron) ?? i18n.t('agents.words.schedule', { cron: a.cron });
    case 'event':
      return describeEvent(a);
    case 'agent':
      return a.from.length === 0
        ? i18n.t('agents.words.fromAnyAgent')
        : i18n.t('agents.words.fromAgents', { agents: joinWords(a.from), count: a.from.length });
    case 'other':
      return i18n.t('agents.words.other');
  }
}

const BEFORE_WORDS: Readonly<Record<string, TranslationKey>> = {
  today: 'agents.words.beforeToday',
  weather: 'agents.words.beforeWeather',
  presence: 'agents.words.beforePresence',
};

export function describeBefore(hooks: readonly string[]): string | null {
  if (hooks.length === 0) return null;
  const things = hooks.map((h) => (Object.prototype.hasOwnProperty.call(BEFORE_WORDS, h) ? i18n.t(BEFORE_WORDS[h]) : h));
  return i18n.t('agents.words.before', { things: joinWords(things) });
}

const AFTER_WORDS: Readonly<Record<string, TranslationKey>> = {
  notify_owner: 'agents.words.afterNotify',
  save_artifact: 'agents.words.afterSave',
  start_task: 'agents.words.afterTask',
};

export function describeAfter(hooks: readonly AfterHook[]): string | null {
  const named = hooks.filter((h) => h.hook !== '');
  if (named.length === 0) return null;
  const things = named.map((h) => {
    if (h.hook === HAND_TO) return h.agent ? i18n.t('agents.words.afterHand', { agent: h.agent }) : i18n.t('agents.words.afterHandAny');
    return Object.prototype.hasOwnProperty.call(AFTER_WORDS, h.hook) ? i18n.t(AFTER_WORDS[h.hook]) : h.hook;
  });
  return i18n.t('agents.words.after', { things: joinWords(things) });
}

/** The badge for a prefill: one literal key per status, so the key-completeness test sees each. */
export function prefillLabel(status: PrefillStatus): string {
  switch (status) {
    case 'ready':
      return i18n.t('agents.prefill.status.ready');
    case 'building':
      return i18n.t('agents.prefill.status.building');
    case 'queued':
      return i18n.t('agents.prefill.status.queued');
    case 'idle':
      return i18n.t('agents.prefill.status.idle');
    case 'not_built':
      return i18n.t('agents.prefill.status.notBuilt');
    case 'failed':
      return i18n.t('agents.prefill.status.failed');
  }
}

/** Colour only where something is asked of the reader: a failure, and the one compiling now. */
export function prefillTone(status: PrefillStatus): InkTone {
  if (status === 'failed') return 'danger';
  if (status === 'building') return 'info';
  return 'neutral';
}

/** What the status means for the agent's next run, in a sentence. */
export function prefillDetail(status: PrefillStatus, retentionDays: number): string {
  switch (status) {
    case 'ready':
      return i18n.t('agents.prefill.detail.ready');
    case 'building':
      return i18n.t('agents.prefill.detail.building');
    case 'queued':
      return i18n.t('agents.prefill.detail.queued');
    case 'idle':
      return i18n.t('agents.prefill.detail.idle', { days: retentionDays });
    case 'not_built':
      return i18n.t('agents.prefill.detail.notBuilt');
    case 'failed':
      return i18n.t('agents.prefill.detail.failed');
  }
}

/** When a prefill was compiled and last used, for the agent's own screen. Empty when unknown. */
export function prefillTimes(prefill: AgentPrefill, now = new Date()): { compiled: string; used: string } {
  return {
    compiled: prefill.compiled_at ? formatScheduleTime(prefill.compiled_at, now) : '',
    used: prefill.last_used_at ? formatScheduleTime(prefill.last_used_at, now) : '',
  };
}

// The Pond's role names (long_task_roles.rs), and `assistant`, which its own start-up build reports.
const BUILT_IN: Readonly<Record<string, TranslationKey>> = {
  'long-task-planner': 'agents.builtInName.planner',
  'long-task-worker': 'agents.builtInName.worker',
  'long-task-verifier': 'agents.builtInName.verifier',
  assistant: 'agents.builtInName.assistant',
};

/** A shipped agent's name in words; one the phone does not know keeps the Pond's own name. */
export function builtInName(agent: string): string {
  return Object.prototype.hasOwnProperty.call(BUILT_IN, agent) ? i18n.t(BUILT_IN[agent]) : agent;
}
