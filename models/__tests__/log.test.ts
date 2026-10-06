/**
 * How the Activity screen reads the Pond's activity log: which filter an event
 * falls under, the row text, and a key for events that carry no id.
 */

import {
  attributeText,
  countsByFilter,
  describeEvent,
  eventKey,
  exportFileName,
  filterOf,
  isProblem,
  logsToCsv,
  parsePondLogTime,
} from '@/models/log';
import type { ActivityEvent, ActivitySummary, EventCategory, LogEntry } from '@/services/types';

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
