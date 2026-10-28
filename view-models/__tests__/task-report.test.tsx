// A long task's report: read whole from the Pond, or the result alone from an older one; and shared as
// a file whose name and type are the export's, with the calendar offered only for a plan with dates.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import * as Sharing from 'expo-sharing';

import { readLongTaskReport, reportFileName, reportSections } from '@/models/long-tasks';
import { ApiError, api } from '@/services/api-client';
import { forgetLongTasks } from '@/services/long-task-cache';
import type { LongTask, LongTaskReportWire } from '@/services/types';
import { builtInName } from '@/view-models/agent-words';
import { shareOptions, useTaskReport, type ShownReport, type UseTaskReport } from '@/view-models/use-task-report';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true, online: true, isScreenReal: () => true }) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { longTaskReport: jest.fn(), longTaskExport: jest.fn(), longTask: jest.fn(), longTaskArtifact: jest.fn() } };
});
const written: { name: string; body: string }[] = [];
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'cache://' },
  File: class {
    name: string;
    uri: string;
    constructor(_dir: string, name: string) {
      this.name = name;
      this.uri = `cache://${name}`;
    }
    create() {}
    write(body: string) {
      written.push({ name: this.name, body });
    }
  },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

const pond = jest.mocked(api);
const sharing = jest.mocked(Sharing);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = 'task-0001-aaaa';
const MARKDOWN = `# A weekend in Mombasa

Two nights by the beach.

## Day 1: Saturday

- 08:00 Train

\`\`\`text
## not a section
\`\`\`

## Meals

| Day | Dinner |
| --- | --- |
| Saturday | Fish |

## Sources

- [Timetable](https://metickets.krc.co.ke)
`;

const REPORT: LongTaskReportWire = {
  id: ID,
  title: 'A weekend in Mombasa',
  state: 'completed',
  kind: 'research',
  markdown: MARKDOWN,
  sections: 2,
  sources: [{ title: 'Timetable', url: 'https://metickets.krc.co.ke' }],
  calendar_events: 2,
};

const TASK: LongTask = {
  id: ID,
  kind: 'general',
  goal: 'Plan a weekend in Mombasa',
  state: 'completed',
  origin_session_id: 's1',
  created_at: '',
  updated_at: '',
  finished_at: '',
  steps: [],
  artifacts: [{ id: 'art1', task_id: ID, step_key: 'c', kind: 'draft', title: 'Weekend plan', summary: 'By train.', tokens: 10, created_at: '' }],
  result_artifact_id: 'art1',
};

async function mount() {
  let latest!: UseTaskReport;
  const Probe = () => {
    latest = useTaskReport(ID);
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return {
    get vm() {
      return latest;
    },
    unmount: () => act(() => tree.unmount()),
  };
}

let warn: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  forgetLongTasks();
  written.length = 0;
  pond.longTaskReport.mockResolvedValue(REPORT);
  sharing.isAvailableAsync.mockResolvedValue(true);
  sharing.shareAsync.mockResolvedValue(undefined);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

describe('reading the report', () => {
  it('shows the whole report, cut into the sections it can jump between', async () => {
    const m = await mount();
    expect(m.vm.report).toMatchObject({ title: 'A weekend in Mombasa', kind: 'research', exportable: true, calendarEvents: 2, final: true });
    expect(m.vm.report?.sections.map((s) => s.title)).toEqual(['', 'Day 1: Saturday', 'Meals', 'Sources']);
    expect(pond.longTask).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('shows the result alone on a Pond without the report route, with nothing to share', async () => {
    pond.longTaskReport.mockRejectedValue(new ApiError('GET → 404', 404, null));
    pond.longTask.mockResolvedValue(TASK);
    pond.longTaskArtifact.mockResolvedValue({ id: 'art1', title: 'Weekend plan', kind: 'draft', summary: 'By train.', body: '## Plan\n\nBy train.' });
    const m = await mount();
    expect(pond.longTaskArtifact).toHaveBeenCalledWith(ID, 'art1');
    expect(m.vm.report).toMatchObject({ title: 'Weekend plan', markdown: '## Plan\n\nBy train.', exportable: false });
    expect(m.vm.options).toEqual([]);
    await m.unmount();
  });

  it('says the report is gone when the task is not there either', async () => {
    pond.longTaskReport.mockRejectedValue(new ApiError('GET → 404', 404, null));
    pond.longTask.mockRejectedValue(new ApiError('GET → 404', 404, null));
    const m = await mount();
    expect(m.vm.gone).toBe(true);
    expect(m.vm.report).toBeNull();
    await m.unmount();
  });

  it('asks nothing again for an ended task’s report it has already read', async () => {
    const first = await mount();
    await first.unmount();
    const again = await mount();
    expect(pond.longTaskReport).toHaveBeenCalledTimes(1);
    expect(again.vm.report?.title).toBe('A weekend in Mombasa');
    await again.unmount();
  });
});

describe('sharing it', () => {
  it.each([
    ['markdown', 'mombasa-weekend.md', 'text/markdown'],
    ['html', 'mombasa-weekend.html', 'text/html'],
    ['ics', 'mombasa-weekend.ics', 'text/calendar'],
  ] as const)('shares %s as a file named by the Pond, of its own type', async (format, name, mimeType) => {
    pond.longTaskExport.mockResolvedValue({ name, body: `the ${format} body` });
    const m = await mount();
    let shared = false;
    await act(async () => {
      shared = await m.vm.actions.share(format);
    });
    expect(shared).toBe(true);
    expect(pond.longTaskExport).toHaveBeenCalledWith(ID, format);
    expect(written).toEqual([{ name, body: `the ${format} body` }]);
    expect(sharing.shareAsync).toHaveBeenCalledWith(`cache://${name}`, expect.objectContaining({ mimeType }));
    await m.unmount();
  });

  it('says so when the phone has no share sheet, and writes nothing', async () => {
    sharing.isAvailableAsync.mockResolvedValue(false);
    pond.longTaskExport.mockResolvedValue({ name: 'r.md', body: 'x' });
    const m = await mount();
    await act(async () => {
      await m.vm.actions.share('markdown');
    });
    expect(written).toEqual([]);
    expect(m.vm.shareError).toBe('This phone has no share sheet to hand the file to.');
    await m.unmount();
  });

  it('says a plan has no dates when the calendar export finds none', async () => {
    pond.longTaskExport.mockRejectedValue(new ApiError('GET → 404', 404, null));
    const m = await mount();
    await act(async () => {
      await m.vm.actions.share('ics');
    });
    expect(m.vm.shareError).toBe('This report has no dated events for a calendar.');
    expect(sharing.shareAsync).not.toHaveBeenCalled();
    await m.unmount();
  });
});

describe('the share choices', () => {
  const shown = (over: Partial<ShownReport>): ShownReport => ({
    title: 't',
    kind: 'general',
    markdown: '',
    sections: [],
    exportable: true,
    calendarEvents: 0,
    final: true,
    ...over,
  });

  it('offers the calendar only for a report with dated events, and nothing for an older Pond', () => {
    expect(shareOptions(shown({})).map((o) => o.format)).toEqual(['markdown', 'html']);
    expect(shareOptions(shown({ calendarEvents: 3 })).map((o) => o.format)).toEqual(['markdown', 'html', 'ics']);
    expect(shareOptions(shown({ exportable: false, calendarEvents: 3 }))).toEqual([]);
    expect(shareOptions(null)).toEqual([]);
  });
});

describe('the pieces it is built from', () => {
  it("takes the Pond's file name only when it is a plain one of the format's kind", () => {
    expect(reportFileName('attachment; filename="a-weekend-in-mombasa.ics"', 'ics')).toBe('a-weekend-in-mombasa.ics');
    expect(reportFileName('attachment; filename="../../etc/passwd.md"', 'markdown')).toBe('report.md');
    expect(reportFileName('attachment; filename="plan.html"', 'markdown')).toBe('report.md');
    expect(reportFileName(null, 'html')).toBe('report.html');
  });

  it('reads the report, and a missing count as none', () => {
    expect(readLongTaskReport({ id: ID, markdown: '# T', title: 'T', state: 'running' })).toMatchObject({ sections: 0, calendar_events: 0, kind: 'general', sources: [] });
    expect(readLongTaskReport({ id: ID })).toBeNull();
  });

  it('cuts at headings outside code, keeping the title with the summary', () => {
    expect(reportSections('# Title\n\nSummary\n\n```\n# not this\n```\n').map((s) => s.title)).toEqual(['']);
    expect(reportSections('# Title\n\n## **Day 1**\n\nx\n').map((s) => s.title)).toEqual(['', 'Day 1']);
  });

  it('names the composer that builds plans', () => {
    expect(builtInName('long-task-composer')).toBe('Nestmaker Goose');
  });
});
