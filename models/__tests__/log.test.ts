/**
 * How the Activity screen reads the Pond's activity log: which filter an event
 * falls under, the row text, and a key for events that carry no id.
 */

import { attributeText, describeEvent, eventKey, filterOf, isProblem, parsePondLogTime } from '@/models/log';
import type { ActivityEvent, EventCategory, LogEntry } from '@/services/types';

function event(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    category: 'device',
    action: 'device.set_power',
    timestamp: '2026-10-05T09:00:00Z',
    privacy_sensitivity: 'internal',
    attributes: {},
    ...overrides,
  };
}

describe('filterOf', () => {
  it.each<[EventCategory, string]>([
    ['agent', 'action'],
    ['inference', 'action'],
    ['tool', 'mcp'],
    ['sensor', 'home'],
    ['camera', 'home'],
    ['device', 'home'],
    ['auth', 'system'],
    ['network', 'system'],
    ['system', 'system'],
  ])('puts %s under %s', (category, filter) => {
    expect(filterOf(category)).toBe(filter);
  });
});

describe('attributeText', () => {
  /** The Pond tags every value with its type; the row wants the value. */
  it('unwraps each tag', () => {
    expect(attributeText({ text: 'lamp' })).toBe('lamp');
    expect(attributeText({ int: 3 })).toBe('3');
    expect(attributeText({ bool: false })).toBe('false');
  });

  it('rounds a float to two places', () => {
    expect(attributeText({ float: 21.456 })).toBe('21.46');
  });
});

describe('describeEvent', () => {
  it('titles the row from the last segment of the action', () => {
    expect(describeEvent(event({ action: 'device.set_power' })).title).toBe('Set power');
  });

  it('names what the event was about, leaving out the redaction count', () => {
    const e = event({
      attributes: {
        device_name: { text: 'Living room lamp' },
        redacted: { int: 2 },
        value: { float: 1 },
      },
    });
    expect(describeEvent(e).detail).toBe('Living room lamp · 1');
  });

  it('has no detail when no attribute names a subject', () => {
    expect(describeEvent(event({ attributes: { redacted: { int: 1 } } })).detail).toBeNull();
  });
});

describe('eventKey', () => {
  /** Two events can share a timestamp and an action; the position tells them apart. */
  it('differs for identical events at different positions', () => {
    const e = event({});
    expect(eventKey(e, 0)).not.toBe(eventKey(e, 1));
  });
});

describe('the operational log', () => {
  function entry(level: string): LogEntry {
    return { id: 1, timestamp: '2026-10-05 09:00:00', level, source: 's', message: 'm', metadata: null };
  }

  /** INFO rows are trace chatter; Problems is for what went wrong. */
  it('counts WARN and ERROR as problems, in any case, and not INFO', () => {
    expect(isProblem(entry('WARN'))).toBe(true);
    expect(isProblem(entry('error'))).toBe(true);
    expect(isProblem(entry('INFO'))).toBe(false);
  });

  /** SQLite writes UTC without saying so; read as local it would be hours out. */
  it('reads a SQLite timestamp as UTC', () => {
    expect(parsePondLogTime('2026-10-05 09:00:00')).toBe('2026-10-05T09:00:00Z');
    expect(new Date(parsePondLogTime('2026-10-05 09:00:00')).getUTCHours()).toBe(9);
  });

  it('leaves a timestamp that already carries a zone alone', () => {
    expect(parsePondLogTime('2026-10-05T09:00:00+03:00')).toBe('2026-10-05T09:00:00+03:00');
  });
});
