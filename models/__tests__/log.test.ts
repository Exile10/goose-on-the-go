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
  countsByFilter,
  describeEvent,
  eventFilter,
  eventKeys,
  exportFileName,
  filterOf,
  inFilter,
  isProblem,
  logsToCsv,
  newestFirst,
  logTimeOfDay,
  parsePondLogTime,
} from '@/models/log';
import type { ActivityEvent, ActivitySummary, EventCategory, LogEntry } from '@/services/types';

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

  it('shows a log row’s time of day on the phone’s clock', () => {
    const local = new Date('2026-10-05T09:04:05Z');
    const two = (n: number) => String(n).padStart(2, '0');
    const expected = `${two(local.getHours())}:${two(local.getMinutes())}:${two(local.getSeconds())}`;
    expect(logTimeOfDay('2026-10-05 09:04:05')).toBe(expected);
  });

  it('leaves a time it cannot read as it came', () => {
    expect(logTimeOfDay('soon')).toBe('soon');
  });
});

describe('countsByFilter', () => {
  function summary(by_category: ActivitySummary['by_category']): ActivitySummary {
    return { window: 'day', since: '2026-10-05T09:00:00Z', total: 0, by_category };
  }

  it('adds categories that share a filter into one count', () => {
    expect(countsByFilter(summary({ sensor: 2, camera: 1, device: 4 }))).toEqual([{ filter: 'home', count: 7 }]);
  });

  it('puts the largest first', () => {
    expect(countsByFilter(summary({ tool: 1, agent: 5, auth: 3 }))).toEqual([
      { filter: 'action', count: 5 },
      { filter: 'system', count: 3 },
      { filter: 'mcp', count: 1 },
    ]);
  });

  it('leaves out filters with nothing in them', () => {
    expect(countsByFilter(summary({ tool: 0, device: 2 }))).toEqual([{ filter: 'home', count: 2 }]);
  });

  it('is empty for a quiet day', () => {
    expect(countsByFilter(summary({}))).toEqual([]);
  });
});

describe('exporting the operational log', () => {
  it('names the file for the day, in the phone\'s own time', () => {
    expect(exportFileName(new Date(2026, 0, 5, 23, 30))).toBe('pond-logs-2026-01-05.csv');
  });

  it('writes a header and one row per entry', () => {
    const csv = logsToCsv([
      { id: 7, timestamp: '2026-10-05 09:00:00', level: 'WARN', source: 'tools', message: 'slow', metadata: null },
    ]);
    expect(csv).toBe('id,timestamp,level,source,message,metadata\n7,2026-10-05 09:00:00,WARN,tools,slow,\n');
  });

  it('quotes a field that holds a comma, quote or line break', () => {
    const csv = logsToCsv([
      { id: 1, timestamp: 't', level: 'ERROR', source: 's', message: 'said "no", then\nstopped', metadata: '{"a":1}' },
    ]);
    expect(csv.split('\n').slice(1).join('\n')).toBe('1,t,ERROR,s,"said ""no"", then\nstopped","{""a"":1}"\n');
  });
});
