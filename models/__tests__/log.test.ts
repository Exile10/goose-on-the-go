/**
 * How the Activity screen reads the Pond's activity log: which filter an event
 * falls under, the row text, and a key for events that carry no id.
 */

import type { TFunction } from 'i18next';

import i18n from '@/services/i18n';
import en from '@/services/i18n/locales/en.json';
import {
  attributeText,
  categoriesOf,
  describeEvent,
  eventFilter,
  eventKeys,
  filterOf,
  inFilter,
  newestFirst,
} from '@/models/log';
import type { ActivityEvent, EventCategory } from '@/services/types';

const t = i18n.t as unknown as TFunction;

function event(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    category: 'device',
    action: 'device.state_changed',
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

describe('categoriesOf', () => {
  /** The Pond takes one category per request, so these are the requests a filter makes. */
  it('names every category a filter spans', () => {
    expect(categoriesOf('action')).toEqual(['agent', 'inference']);
    expect(categoriesOf('mcp')).toEqual(['tool']);
    expect(categoriesOf('home')).toEqual(['sensor', 'camera', 'device']);
    expect(categoriesOf('system')).toEqual(['auth', 'network', 'system']);
  });
});

describe('eventFilter', () => {
  it('keeps presence and session events out of Actions, and under All', () => {
    for (const action of ['presence.profile', 'session.lifecycle']) {
      const e = event({ category: 'agent', action });
      expect(eventFilter(e)).toBeNull();
      expect(inFilter(e, 'action')).toBe(false);
      expect(inFilter(e, 'all')).toBe(true);
    }
    expect(eventFilter(event({ category: 'agent', action: 'agent.turn' }))).toBe('action');
  });
});

describe('newestFirst', () => {
  /** Text order would put `.5Z` before `Z`: the Pond's fractional seconds vary in length. */
  it('merges reads by time, newest first, and caps them', () => {
    const at = (timestamp: string) => event({ timestamp });
    const merged = newestFirst(
      [at('2026-10-05T09:00:00Z'), at('2026-10-05T08:59:00Z'), at('2026-10-05T09:00:00.5Z')],
      2,
    );
    expect(merged.map((e) => e.timestamp)).toEqual(['2026-10-05T09:00:00.5Z', '2026-10-05T09:00:00Z']);
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
  const titles: string[] = Object.values(en.activity.event);

  it.each([
    'agent.turn',
    'inference.completion',
    'tool.call',
    'sensor.reading',
    'camera.event',
    'device.state_changed',
    'time.tick',
    'presence.profile',
    'session.lifecycle',
    'egress.http',
    'egress.denied',
    'auth.device_paired',
    'auth.pairing_verify_failed',
    'security.audit',
  ])('titles %s, which the Pond emits, from the catalogue', (action) => {
    const { title } = describeEvent(event({ action }), t);
    expect(titles).toContain(title);
    expect(title).not.toBe(en.activity.event.other);
  });

  it('titles an action it does not know with the fallback, never its raw segment', () => {
    expect(describeEvent(event({ action: 'device.set_power' }), t).title).toBe(en.activity.event.other);
  });

  it('names what the event was about, leaving out the redaction count', () => {
    const e = event({
      attributes: {
        device_name: { text: 'Living room lamp' },
        redacted: { int: 2 },
        value: { float: 1 },
      },
    });
    expect(describeEvent(e, t).detail).toBe('Living room lamp · 1');
  });

  it('names a tool as the conversation does', () => {
    const call = (tool: string) =>
      describeEvent(event({ category: 'tool', action: 'tool.call', attributes: { tool: { text: tool } } }), t);
    expect(call('get_current_weather').detail).toBe(en.chat.tools.weather);
    expect(call('open_garage_door').detail).toBe('Open garage door');
  });

  it('reads a sensor value with its unit, and a bool reading without one', () => {
    const reading = (sensor: string, value: number, unit: string) =>
      describeEvent(
        event({
          category: 'sensor',
          action: 'sensor.reading',
          attributes: {
            device_id: { text: 'hallway' },
            sensor_type: { text: sensor },
            value: { float: value },
            unit: { text: unit },
          },
        }),
        t,
      ).detail;
    expect(reading('temperature', 21.5, 'C')).toBe('hallway · temperature · 21.5 C');
    expect(reading('motion', 1, 'bool')).toBe('hallway · motion · 1');
  });

  it('has no detail when no attribute names a subject', () => {
    expect(describeEvent(event({ attributes: { redacted: { int: 1 } } }), t).detail).toBeNull();
  });
});

describe('eventKeys', () => {
  /** Two events can share a timestamp and an action; their place among such twins tells them apart. */
  it('tells identical events apart', () => {
    const e = event({});
    const [a, b] = eventKeys([e, e]);
    expect(a).not.toBe(b);
  });

  it('keeps every key when a poll adds newer events above', () => {
    const older = event({ timestamp: '2026-10-05T09:00:00Z' });
    const newer = event({ timestamp: '2026-10-05T09:05:00Z' });
    const before = eventKeys([older, older]);
    const after = eventKeys([newer, newer, older, older]);
    expect(after.slice(2)).toEqual(before);
  });
});
