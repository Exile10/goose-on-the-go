/**
 * What the pond's vision pipeline is doing and what it noticed, in a household's words.
 *
 * Everything here is pure and reads only what the Pond sent. Where the Pond's own field means two
 * things, the words follow the meaning rather than the name: an event's `confidence` is the
 * detector's score for a person, a pet or a package, and for plain movement it is how much of the
 * picture changed, so the two are never both called "sure".
 *
 * Keys are written out one literal per branch, because a key assembled at runtime is invisible
 * to the catalogue check in services/__tests__/i18n.test.ts.
 */

import i18n, { type TranslationKey } from '@/services/i18n';
import type {
  CameraEvent,
  FacePerson,
  Rule,
  RuleRequest,
  TriggerCondition,
  VisionCapture,
  VisionStatus,
} from '@/services/types';
import { formatScheduleTime } from './schedule';

// ── The kinds of thing the pond records ───────────────────────

/** Every kind of event the pond can record, which an empty `vision_event_types` means all of. */
export const EVENT_TYPES = [
  'motion',
  'person',
  'pet',
  'vehicle',
  'package',
  'face_detected',
  'face_recognized',
  'face_unknown',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** The face kinds only happen while face recognition is on. */
export const FACE_EVENT_TYPES: readonly EventType[] = ['face_detected', 'face_recognized', 'face_unknown'];

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

/** What is actually recorded: the stored list, or every kind when it is empty. */
export function watchedTypes(stored: readonly string[]): string[] {
  return stored.length === 0 ? [...EVENT_TYPES] : [...stored];
}

/** Known kinds in their usual order, then anything else the Pond holds, so nothing it stored is lost. */
function inOrder(types: readonly string[]): string[] {
  const known = EVENT_TYPES.filter((type) => types.includes(type));
  return [...known, ...types.filter((type) => !isEventType(type))];
}

/**
 * The list to store once one kind is turned on or off, or null when that would leave none: an empty
 * list means "every kind" to the Pond, so switching off the last one would switch everything on.
 */
export function toggleWatchedType(stored: readonly string[], type: string, on: boolean): string[] | null {
  const current = watchedTypes(stored);
  const next = on ? [...new Set([...current, type])] : current.filter((t) => t !== type);
  return next.length === 0 ? null : inOrder(next);
}

export function eventTypeLabelKey(type: string): TranslationKey | null {
  switch (type) {
    case 'motion':
      return 'visionEvents.type.motion';
    case 'person':
      return 'visionEvents.type.person';
    case 'pet':
      return 'visionEvents.type.pet';
    case 'package':
      return 'visionEvents.type.package';
    case 'vehicle':
      return 'visionEvents.type.vehicle';
    case 'face_detected':
      return 'visionEvents.type.face_detected';
    case 'face_recognized':
      return 'visionEvents.type.face_recognized';
    case 'face_unknown':
      return 'visionEvents.type.face_unknown';
    default:
      return null;
  }
}

/** "A person", "Movement", or the Pond's own word for a kind it has no name for here. */
export function describeSeen(event: Pick<CameraEvent, 'event_type'>): string {
  const key = eventTypeLabelKey(event.event_type);
  if (key) return i18n.t(key);
  return event.event_type.trim() || i18n.t('visionEvents.type.unknown');
}

// ── Faces in an event ─────────────────────────────────────────

export interface EventFace {
  /** A face was found, whoever it was. */
  detected: boolean;
  /** A face was found and matched nobody. */
  unknown: boolean;
  /** The household member it matched, as a profile id. */
  profileId: string | null;
  /** How closely it matched, 0 to 1. For an unknown face, how close its nearest candidate came. */
  confidence: number | null;
}

/** What the pipeline noted about a face. Both the metadata and the event kind can say so. */
export function faceOf(event: Pick<CameraEvent, 'event_type' | 'metadata'>): EventFace {
  const meta = event.metadata;
  const profileId = typeof meta?.identified_profile === 'string' && meta.identified_profile ? meta.identified_profile : null;
  const unknown = !profileId && (meta?.face_unknown === true || event.event_type === 'face_unknown');
  const detected = !!profileId || unknown || meta?.face_detected === true || event.event_type.startsWith('face_');
  const confidence = typeof meta?.face_confidence === 'number' && Number.isFinite(meta.face_confidence) ? meta.face_confidence : null;
  return { detected, unknown, profileId, confidence };
}

/** The title of an event: who, when the pond knows, or else what. */
export function describeEvent(event: CameraEvent, nameOf: (profileId: string) => string | null): string {
  const face = faceOf(event);
  if (face.profileId) {
    const name = nameOf(face.profileId);
    return name ? i18n.t('visionEvents.title.known', { name }) : i18n.t('visionEvents.title.knownGone');
  }
  if (face.unknown) return i18n.t('visionEvents.title.unknownFace');
  // An event that is only a face: the face is the news.
  if (face.detected && event.event_type.startsWith('face_')) return i18n.t('visionEvents.title.face');
  return describeSeen(event);
}

function percent(fraction: number): number {
  return Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
}

function finite(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * How the pond measured what it saw, each as its own line. Movement reports how much of the
 * picture changed, a detection how sure the detector was, and a face how closely it matched.
 */
export function describeMeasures(event: Pick<CameraEvent, 'event_type' | 'confidence' | 'metadata'>): string[] {
  const lines: string[] = [];
  const face = faceOf(event);
  if (event.event_type === 'motion') {
    const changed = event.metadata?.changed_fraction ?? event.confidence;
    if (finite(changed)) lines.push(i18n.t('visionEvents.changed', { percent: percent(changed) }));
  } else if (finite(event.confidence)) {
    lines.push(i18n.t('visionEvents.confidence', { percent: percent(event.confidence) }));
  }
  if (face.confidence !== null) {
    lines.push(
      i18n.t(face.profileId ? 'visionEvents.faceMatch' : 'visionEvents.faceClosest', { percent: percent(face.confidence) }),
    );
  }
  return lines;
}

export interface EventFact {
  label: string;
  value: string;
}

/**
 * Everything the pond recorded about an event, as labelled facts for the sheet: what, how it was
 * measured, who, where and when. A fact the pond did not record is not listed, rather than shown
 * empty.
 */
export function describeFacts(event: CameraEvent, nameOf: (profileId: string) => string | null): EventFact[] {
  const facts: EventFact[] = [{ label: i18n.t('visionEvents.sheet.detected'), value: describeSeen(event) }];
  const pct = (fraction: number) => i18n.t('visionEvents.sheet.percent', { percent: percent(fraction) });

  if (event.event_type === 'motion') {
    const changed = event.metadata?.changed_fraction ?? event.confidence;
    if (finite(changed)) facts.push({ label: i18n.t('visionEvents.sheet.change'), value: pct(changed) });
  } else if (finite(event.confidence)) {
    facts.push({ label: i18n.t('visionEvents.sheet.detector'), value: pct(event.confidence) });
  }

  const face = faceOf(event);
  if (face.detected) {
    let who = i18n.t('visionEvents.sheet.faceUnknown');
    if (face.profileId) {
      const name = nameOf(face.profileId);
      who = name ? i18n.t('visionEvents.sheet.faceKnown', { name }) : i18n.t('visionEvents.sheet.faceKnownGone');
    }
    facts.push({ label: i18n.t('visionEvents.sheet.face'), value: who });
    if (face.confidence !== null) {
      facts.push({
        label: i18n.t(face.profileId ? 'visionEvents.sheet.faceMatch' : 'visionEvents.sheet.faceClosest'),
        value: pct(face.confidence),
      });
    }
  }

  if (event.camera_id) facts.push({ label: i18n.t('visionEvents.sheet.camera'), value: event.camera_id });
  const when = whenOf(event);
  if (when) facts.push({ label: i18n.t('visionEvents.sheet.when'), value: when });
  return facts;
}

/** The one line a list row carries under its title: the most telling measure there is. */
export function summaryLine(event: Pick<CameraEvent, 'event_type' | 'confidence' | 'metadata'>): string | null {
  const face = faceOf(event);
  const lines = describeMeasures(event);
  if (face.confidence !== null && lines.length > 1) return lines[lines.length - 1];
  return lines[0] ?? null;
}

export function whenOf(event: Pick<CameraEvent, 'created_at'>): string {
  return formatScheduleTime(event.created_at);
}

// ── Filters ───────────────────────────────────────────────────

export const EVENT_FILTERS = [
  'all',
  'people',
  'faces',
  'unknownFaces',
  'motion',
  'pets',
  'vehicles',
  'packages',
  'unacknowledged',
] as const;
export type EventFilter = (typeof EVENT_FILTERS)[number];

export function matchesFilter(event: CameraEvent, filter: EventFilter): boolean {
  const face = faceOf(event);
  switch (filter) {
    case 'all':
      return true;
    case 'people':
      return event.event_type === 'person' || face.detected;
    case 'faces':
      return face.detected;
    case 'unknownFaces':
      return face.unknown;
    case 'motion':
      return event.event_type === 'motion' && !face.detected;
    case 'pets':
      return event.event_type === 'pet';
    case 'vehicles':
      return event.event_type === 'vehicle';
    case 'packages':
      return event.event_type === 'package';
    case 'unacknowledged':
      return !event.acknowledged;
  }
}

export function filterLabel(filter: EventFilter): string {
  switch (filter) {
    case 'all':
      return i18n.t('visionEvents.filter.all');
    case 'people':
      return i18n.t('visionEvents.filter.people');
    case 'faces':
      return i18n.t('visionEvents.filter.faces');
    case 'unknownFaces':
      return i18n.t('visionEvents.filter.unknownFaces');
    case 'motion':
      return i18n.t('visionEvents.filter.motion');
    case 'pets':
      return i18n.t('visionEvents.filter.pets');
    case 'vehicles':
      return i18n.t('visionEvents.filter.vehicles');
    case 'packages':
      return i18n.t('visionEvents.filter.packages');
    case 'unacknowledged':
      return i18n.t('visionEvents.filter.unacknowledged');
  }
}

/** The count a list header shows. */
export function unacknowledgedCount(events: readonly CameraEvent[]): number {
  return events.filter((e) => !e.acknowledged).length;
}

// ── What the pipeline is doing ────────────────────────────────

export interface VisionSentence {
  /** The one sentence that says what is happening. */
  sentence: string;
  /** The short word for the state, for a badge. */
  label: string;
  /** What deserves a badge's colour: nothing is wrong, something is waiting, or something is off. */
  tone: 'success' | 'warning' | 'neutral';
  /** Privacy is what holds it back, so the way to fix it is on the Privacy page. */
  privacy: boolean;
  /** Further lines under it: which camera, the last event, restarts. */
  details: string[];
}

function ago(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return i18n.t('vision.ago.seconds', { count: s });
  const minutes = Math.round(s / 60);
  if (minutes < 90) return i18n.t('vision.ago.minutes', { count: minutes });
  return i18n.t('vision.ago.hours', { count: Math.round(minutes / 60) });
}

function secondsSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : (now - at) / 1000;
}

const CAPTURE_LINE: Record<VisionCapture, TranslationKey> = {
  camera_jpeg: 'vision.detail.capture.camera_jpeg',
  hardware: 'vision.detail.capture.hardware',
  software: 'vision.detail.capture.software',
};

/** The status in words. `now` is when the status was read, so a dropped stream's age is honest. */
export function describeVision(status: VisionStatus, now: number): VisionSentence {
  const camera = status.camera_id || i18n.t('visionEvents.type.unknown');
  const details: string[] = [];
  if (status.source) {
    details.push(
      status.source_kind === 'discovered'
        ? i18n.t('vision.detail.discovered', { source: status.source })
        : i18n.t('vision.detail.configured', { source: status.source }),
    );
  }
  if (status.last_event_at && formatScheduleTime(status.last_event_at)) {
    details.push(i18n.t('vision.detail.lastEvent', { when: formatScheduleTime(status.last_event_at) }));
  }
  if (status.state === 'running' && status.capture) details.push(i18n.t(CAPTURE_LINE[status.capture]));
  if (status.restarts > 0) details.push(i18n.t('vision.detail.restarts', { count: status.restarts }));
  if (status.state === 'running' && !status.classifier.available) details.push(i18n.t('vision.detail.noDetector'));

  switch (status.state) {
    case 'running': {
      const sentence = status.fps
        ? i18n.t('vision.sentence.running', { camera, count: status.fps })
        : i18n.t('vision.sentence.runningNoRate', { camera });
      return { sentence, label: i18n.t('vision.state.running'), tone: 'success', privacy: false, details };
    }
    case 'starting':
      return {
        sentence: i18n.t('vision.sentence.starting', { camera }),
        label: i18n.t('vision.state.starting'),
        tone: 'neutral',
        privacy: false,
        details,
      };
    case 'no_camera':
      return {
        sentence: i18n.t('vision.sentence.noCamera'),
        label: i18n.t('vision.state.noCamera'),
        tone: 'warning',
        privacy: false,
        details: [],
      };
    case 'reconnecting': {
      const since = secondsSince(status.last_frame_at, now);
      const error = status.last_error?.trim() || null;
      let sentence: string;
      if (since === null) {
        sentence = error
          ? i18n.t('vision.sentence.reconnectingFirstWhy', { camera, error })
          : i18n.t('vision.sentence.reconnectingFirst', { camera });
      } else {
        sentence = error
          ? i18n.t('vision.sentence.reconnectingWhy', { ago: ago(since), error })
          : i18n.t('vision.sentence.reconnecting', { ago: ago(since) });
      }
      return { sentence, label: i18n.t('vision.state.reconnecting'), tone: 'warning', privacy: false, details };
    }
    case 'off':
      return {
        sentence: i18n.t('vision.sentence.off'),
        label: i18n.t('vision.state.off'),
        tone: 'neutral',
        privacy: false,
        details: [],
      };
    case 'consent_off':
      return {
        sentence: i18n.t('vision.sentence.consentOff'),
        label: i18n.t('vision.state.consentOff'),
        tone: 'warning',
        privacy: true,
        details: [],
      };
  }
}

// ── Signals an automation can listen for ──────────────────────

/** The value of a signal that names one household member's face. */
export const FACE_SIGNAL_PREFIX = 'face:';

export function faceSignal(profileId: string): string {
  return `${FACE_SIGNAL_PREFIX}${profileId}`;
}

export function profileOfSignal(signal: string | undefined | null): string | null {
  return signal && signal.startsWith(FACE_SIGNAL_PREFIX) ? signal.slice(FACE_SIGNAL_PREFIX.length) : null;
}

/** The signal that fits an event, so an automation made from it fires for the same kind of thing. */
export function signalOfEvent(event: Pick<CameraEvent, 'event_type' | 'metadata'>): string {
  const face = faceOf(event);
  if (face.profileId) return faceSignal(face.profileId);
  if (face.unknown) return 'face_unknown';
  return event.event_type;
}

/** What a signal's confidence condition compares, which decides what the form calls it. */
export type Measure = 'sure' | 'match' | 'change';

export function measureOfSignal(signal: string | undefined | null): Measure {
  if (!signal) return 'sure';
  if (signal === 'motion') return 'change';
  if (signal === 'face_detected' || signal === 'face_recognized' || signal === 'face_unknown') return 'match';
  return profileOfSignal(signal) !== null ? 'match' : 'sure';
}

/** The clause an automation's trigger reads as: "a package is seen", "Amina is seen". */
export function describeSignal(signal: string | undefined | null, nameOf: (profileId: string) => string | null): string {
  if (!signal) return i18n.t('visionAutomations.signal.any');
  const profile = profileOfSignal(signal);
  if (profile !== null) {
    const name = nameOf(profile);
    return name
      ? i18n.t('visionAutomations.signal.someone', { name })
      : i18n.t('visionAutomations.signal.someoneUnnamed');
  }
  switch (signal) {
    case 'motion':
      return i18n.t('visionAutomations.signal.motion');
    case 'person':
      return i18n.t('visionAutomations.signal.person');
    case 'pet':
      return i18n.t('visionAutomations.signal.pet');
    case 'vehicle':
      return i18n.t('visionAutomations.signal.vehicle');
    case 'package':
      return i18n.t('visionAutomations.signal.package');
    case 'face_detected':
      return i18n.t('visionAutomations.signal.face_detected');
    case 'face_recognized':
      return i18n.t('visionAutomations.signal.face_recognized');
    case 'face_unknown':
      return i18n.t('visionAutomations.signal.face_unknown');
    default:
      return signal;
  }
}

function opWord(op: NonNullable<TriggerCondition['op']>): string {
  switch (op) {
    case 'gte':
      return i18n.t('visionAutomations.op.gte');
    case 'gt':
      return i18n.t('visionAutomations.op.gt');
    case 'lt':
      return i18n.t('visionAutomations.op.lt');
    case 'lte':
      return i18n.t('visionAutomations.op.lte');
    case 'eq':
      return i18n.t('visionAutomations.op.eq');
  }
}

function measureWord(measure: Measure): string {
  switch (measure) {
    case 'sure':
      return i18n.t('visionAutomations.what.sure');
    case 'match':
      return i18n.t('visionAutomations.what.match');
    case 'change':
      return i18n.t('visionAutomations.what.change');
  }
}

/** A camera rule's trigger in one line: "When a person is seen, at least 80% sure, after 22:00". */
export function describeCameraTrigger(
  rule: Pick<Rule, 'source' | 'condition'>,
  nameOf: (profileId: string) => string | null,
): string {
  const parts = [i18n.t('schedule.card.when', { subject: describeSignal(rule.source.signal, nameOf) })];
  const { op, value, after, before } = rule.condition ?? {};
  if (op && value != null) {
    parts.push(
      i18n.t('visionAutomations.compare', {
        op: opWord(op),
        percent: percent(value),
        what: measureWord(measureOfSignal(rule.source.signal)),
      }),
    );
  }
  if (after && before) parts.push(i18n.t('visionAutomations.window.between', { after, before }));
  else if (after) parts.push(i18n.t('visionAutomations.window.after', { time: after }));
  else if (before) parts.push(i18n.t('visionAutomations.window.before', { time: before }));
  return parts.join(', ');
}

/** A fraction the Pond compares, as the percent it is typed and read in: 0.825 is "82.5". */
export function percentText(fraction: number): string {
  return String(Math.round(fraction * 1000) / 10);
}

/** The percent somebody typed as the fraction the Pond compares, or null for anything but 0 to 100. */
export function fractionFromPercent(typed: number): number | null {
  return Number.isFinite(typed) && typed >= 0 && typed <= 100 ? Number((typed / 100).toFixed(4)) : null;
}

export interface SignalOption {
  /** The signal the Pond matches; empty is "any". */
  value: string;
  label: string;
  /** Why this one may not do anything yet, or what it means for a person. */
  hint: string | null;
}

function typeOptionLabel(type: EventType): string {
  switch (type) {
    case 'motion':
      return i18n.t('visionAutomations.pick.motion');
    case 'person':
      return i18n.t('visionAutomations.pick.person');
    case 'pet':
      return i18n.t('visionAutomations.pick.pet');
    case 'vehicle':
      return i18n.t('visionAutomations.pick.vehicle');
    case 'package':
      return i18n.t('visionAutomations.pick.package');
    case 'face_detected':
      return i18n.t('visionAutomations.pick.face_detected');
    case 'face_recognized':
      return i18n.t('visionAutomations.pick.face_recognized');
    case 'face_unknown':
      return i18n.t('visionAutomations.pick.face_unknown');
  }
}

/**
 * Every signal the pond can match, then one per household member by name. A kind the pond is not
 * watching for is still offered, with the reason it would never fire: an automation made ahead of
 * the setting is not wrong, only idle.
 */
export function signalOptions(
  people: readonly Pick<FacePerson, 'profile_id' | 'name' | 'enrollments'>[],
  watched: readonly string[],
  faceRecognition: boolean,
): SignalOption[] {
  const on = new Set(watchedTypes(watched));
  const idle = i18n.t('visionAutomations.pick.notWatched');
  const options: SignalOption[] = [{ value: '', label: i18n.t('visionAutomations.pick.any'), hint: null }];
  for (const type of EVENT_TYPES) {
    const off = !on.has(type) || (FACE_EVENT_TYPES.includes(type) && !faceRecognition);
    options.push({ value: type, label: typeOptionLabel(type), hint: off ? idle : null });
  }
  for (const person of people) {
    options.push({
      value: faceSignal(person.profile_id),
      label: person.name,
      hint: person.enrollments > 0 ? i18n.t('visionAutomations.pick.personHint') : i18n.t('visionAutomations.pick.personHintNone'),
    });
  }
  return options;
}

// ── Starters ──────────────────────────────────────────────────

export interface Starter {
  id: string;
  title: string;
  detail: string;
  request: RuleRequest;
}

/** Why no starter about a person is offered, or null when one is. */
export type PeopleBlock = 'recognitionOff' | 'unavailable' | 'nobody' | 'typeOff' | null;

export interface StarterInputs {
  people: readonly Pick<FacePerson, 'profile_id' | 'name' | 'enrollments'>[];
  /** The pond's stored `vision_event_types`. */
  watched: readonly string[];
  faceRecognition: boolean;
  /** Whether the pond has a face model at all. */
  facesAvailable: boolean;
  /** The rules there already are, so a starter that exists is not offered twice. */
  rules: readonly Rule[];
}

function covers(rules: readonly Rule[], starter: Starter): boolean {
  const want = starter.request.source;
  const after = starter.request.condition?.after;
  return rules.some(
    (rule) =>
      rule.source.kind === 'camera' &&
      (rule.source.signal ?? '') === (want.signal ?? '') &&
      (!after || rule.condition?.after === after),
  );
}

export function peopleBlock(input: StarterInputs): PeopleBlock {
  if (!input.facesAvailable) return 'unavailable';
  if (!input.faceRecognition) return 'recognitionOff';
  if (!watchedTypes(input.watched).includes('face_recognized')) return 'typeOff';
  if (!input.people.some((p) => p.enrollments > 0)) return 'nobody';
  return null;
}

/**
 * Starters the household can add in one tap, built from the kinds the pond watches for and the
 * people it knows by face. A starter whose signal the pond would never produce is not offered, and
 * one that already exists is not offered again.
 */
export function buildStarters(input: StarterInputs): Starter[] {
  const on = new Set(watchedTypes(input.watched));
  const starters: Starter[] = [];

  if (input.facesAvailable && input.faceRecognition && on.has('face_unknown')) {
    starters.push({
      id: 'unknown-face',
      title: i18n.t('visionAutomations.starter.unknownFace.title'),
      detail: i18n.t('visionAutomations.starter.unknownFace.detail'),
      request: {
        name: i18n.t('visionAutomations.starter.unknownFace.name'),
        source: { kind: 'camera', signal: 'face_unknown' },
        actions: [
          {
            type: 'notify',
            title: i18n.t('visionAutomations.starter.unknownFace.notifyTitle'),
            body: i18n.t('visionAutomations.starter.unknownFace.notifyBody'),
          },
        ],
        cooldown_secs: 300,
      },
    });
  }

  if (on.has('package')) {
    starters.push({
      id: 'package',
      title: i18n.t('visionAutomations.starter.package.title'),
      detail: i18n.t('visionAutomations.starter.package.detail'),
      request: {
        name: i18n.t('visionAutomations.starter.package.name'),
        source: { kind: 'camera', signal: 'package' },
        actions: [
          {
            type: 'notify',
            title: i18n.t('visionAutomations.starter.package.notifyTitle'),
            body: i18n.t('visionAutomations.starter.package.notifyBody'),
          },
        ],
        cooldown_secs: 600,
      },
    });
  }

  if (peopleBlock(input) === null) {
    for (const person of input.people) {
      if (person.enrollments <= 0) continue;
      starters.push({
        id: `greet:${person.profile_id}`,
        title: i18n.t('visionAutomations.starter.greet.title', { name: person.name }),
        detail: i18n.t('visionAutomations.starter.greet.detail', { name: person.name }),
        request: {
          name: i18n.t('visionAutomations.starter.greet.name', { name: person.name }),
          source: { kind: 'camera', signal: faceSignal(person.profile_id) },
          actions: [
            { type: 'agent_prompt', prompt: i18n.t('visionAutomations.starter.greet.prompt', { name: person.name }) },
          ],
          cooldown_secs: 1800,
        },
      });
    }
  }

  if (on.has('motion')) {
    starters.push({
      id: 'night',
      title: i18n.t('visionAutomations.starter.night.title'),
      detail: i18n.t('visionAutomations.starter.night.detail'),
      request: {
        name: i18n.t('visionAutomations.starter.night.name'),
        source: { kind: 'camera', signal: 'motion' },
        condition: { after: '22:00', before: '06:00' },
        actions: [
          {
            type: 'notify',
            title: i18n.t('visionAutomations.starter.night.notifyTitle'),
            body: i18n.t('visionAutomations.starter.night.notifyBody'),
          },
        ],
        cooldown_secs: 300,
      },
    });
  }

  return starters.filter((starter) => !covers(input.rules, starter));
}

/** An automation prefilled from an event: the same kind of thing, a notice titled as the event is. */
export function requestFromEvent(event: CameraEvent, title: string): RuleRequest {
  return {
    name: title,
    source: { kind: 'camera', ...(event.camera_id ? { device_id: event.camera_id } : {}), signal: signalOfEvent(event) },
    actions: [{ type: 'notify', title, body: i18n.t('visionAutomations.fromEvent.body', { camera: event.camera_id }) }],
    cooldown_secs: 60,
  };
}

/** The rules that listen to a camera. */
export function cameraRules(rules: readonly Rule[]): Rule[] {
  return rules.filter((rule) => rule.source.kind === 'camera');
}
