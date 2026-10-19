/**
 * The words for a camera event: what was seen, and how sure the Pond was.
 *
 * `event_type` is a free-form string on the Pond. The documented values are named here, one
 * literal key per branch, because a key assembled at runtime is invisible to the catalogue
 * check in services/__tests__/i18n.test.ts. Anything else is shown as the Pond wrote it.
 */

import i18n, { type TranslationKey } from '@/services/i18n';
import type { CameraEvent } from '@/services/types';

function eventTypeKey(eventType: string): TranslationKey | null {
  switch (eventType) {
    case 'motion':
      return 'cameraEvents.type.motion';
    case 'person':
      return 'cameraEvents.type.person';
    case 'pet':
      return 'cameraEvents.type.pet';
    case 'package':
      return 'cameraEvents.type.package';
    case 'vehicle':
      return 'cameraEvents.type.vehicle';
    default:
      return null;
  }
}

/** "A person", "Movement", or the Pond's own word for a kind it has no name for here. */
export function describeSeen(event: Pick<CameraEvent, 'event_type'>): string {
  const key = eventTypeKey(event.event_type);
  if (key) return i18n.t(key);
  return event.event_type.trim() || i18n.t('cameraEvents.type.unknown');
}

/** "94% sure", or null for an event with no score, such as plain motion. */
export function describeConfidence(event: Pick<CameraEvent, 'confidence'>): string | null {
  const c = event.confidence;
  if (c === null || c === undefined || !Number.isFinite(c)) return null;
  const percent = Math.round(Math.min(Math.max(c, 0), 1) * 100);
  return i18n.t('cameraEvents.confidence', { percent });
}
