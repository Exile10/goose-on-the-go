// A long task's whole report, for its reading screen, and sharing it as a file. A Pond without the
// report route still shows the task's result artifact, as the chat card used to, with nothing to share.

import { useCallback, useEffect, useState } from 'react';

import { isEnded, pdfFileName, REPORT_FILES, reportSections, resultArtifact, type ReportSection } from '@/models/long-tasks';
import { useServer } from '@/providers/server-provider';
import { ApiError } from '@/services/api-client';
import i18n, { type TranslationKey } from '@/services/i18n';
import { endedReport, keepEndedReport } from '@/services/long-task-cache';
import { canMakePdf, shareReportFile, shareReportPdf, SharingUnavailableError } from '@/services/report-share';
import type { LongTaskKind, ReportFormat } from '@/services/types';
import { describeApiError } from './describe-error';
import type { LongTasksSource } from '@/models/long-tasks-mock';
import { useLongTasksSource } from './use-long-task';

export interface ShownReport {
  title: string;
  kind: LongTaskKind;
  markdown: string;
  sections: ReportSection[];
  /** From the report route, so it can be exported; false for an older Pond's result artifact. */
  exportable: boolean;
  calendarEvents: number;
  /** Whether the task has ended, after which the report cannot change. */
  final: boolean;
}

/** What the Pond exports, and a PDF the phone prints from the Pond's web page. */
export type ShareFormat = ReportFormat | 'pdf';

export interface ShareOption {
  format: ShareFormat;
  labelKey: TranslationKey;
}

/**
 * The share sheet's choices: a PDF where this build can print one, a document and a web page always,
 * a calendar only when there are dates.
 */
export function shareOptions(report: ShownReport | null, pdf: boolean): ShareOption[] {
  if (!report?.exportable) return [];
  const options: ShareOption[] = [
    ...(pdf ? [{ format: 'pdf', labelKey: 'chat.report.asPdf' } as const] : []),
    { format: 'markdown', labelKey: 'chat.report.asDocument' },
    { format: 'html', labelKey: 'chat.report.asPage' },
  ];
  if (report.calendarEvents > 0) options.push({ format: 'ics', labelKey: 'chat.report.toCalendar' });
  return options;
}

function isMissing(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 501);
}

/**
 * The report, from its route, or from the result artifact when that route is missing. A 404 can
 * mean either, so the task itself is asked: if it is not there either, the task is gone.
 */
export async function loadReport(source: LongTasksSource, id: string): Promise<ShownReport | 'gone'> {
  try {
    const r = await source.report(id);
    return {
      title: r.title,
      kind: r.kind,
      markdown: r.markdown,
      sections: reportSections(r.markdown),
      exportable: true,
      calendarEvents: r.calendar_events,
      final: isEnded(r.state),
    };
  } catch (e) {
    if (!isMissing(e)) throw e;
  }
  let task;
  try {
    task = await source.task(id);
  } catch (e) {
    if (isMissing(e)) return 'gone';
    throw e;
  }
  const answer = resultArtifact(task);
  const body = answer ? (await source.artifact(id, answer.id)).body : '';
  return {
    title: answer?.title || task.goal,
    kind: task.kind,
    markdown: body,
    sections: reportSections(body),
    exportable: false,
    calendarEvents: 0,
    final: isEnded(task.state),
  };
}

export interface UseTaskReport {
  report: ShownReport | null;
  loading: boolean;
  error: string | null;
  gone: boolean;
  /** The format being fetched and shared, or null. */
  sharing: ShareFormat | null;
  shareError: string | null;
  options: ShareOption[];
  actions: {
    retry: () => Promise<void>;
    /** Resolves to whether the share sheet opened. */
    share: (format: ShareFormat) => Promise<boolean>;
  };
}

export function useTaskReport(id: string): UseTaskReport {
  const { hydrated } = useServer();
  const source = useLongTasksSource();
  const [report, setReport] = useState<ShownReport | null>(() => endedReport<ShownReport>(id));
  const [loading, setLoading] = useState(report === null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [sharing, setSharing] = useState<ShareFormat | null>(null);
  const [pdf] = useState(canMakePdf);
  const [shareError, setShareError] = useState<string | null>(null);

  /** Shows what the Pond answered, or why it could not. */
  const settle = useCallback(
    (outcome: { shown: ShownReport | 'gone' } | { failed: unknown }) => {
      setLoading(false);
      if ('failed' in outcome) {
        console.warn('[report] read failed', { status: outcome.failed instanceof ApiError ? outcome.failed.status : 'network' });
        setError(describeApiError(outcome.failed) ?? i18n.t('chat.report.failed'));
        return;
      }
      if (outcome.shown === 'gone') {
        setGone(true);
        return;
      }
      setReport(outcome.shown);
      if (outcome.shown.final) keepEndedReport(id, outcome.shown);
    },
    [id],
  );

  const read = useCallback(async () => {
    try {
      return { shown: await loadReport(source, id) };
    } catch (e) {
      return { failed: e };
    }
  }, [id, source]);

  const retry = useCallback(async () => {
    setLoading(true);
    setError(null);
    settle(await read());
  }, [read, settle]);

  // Read once on opening; an ended task's report kept from before needs no read at all.
  const [opened] = useState(() => report !== null);
  useEffect(() => {
    if (!hydrated || opened) return;
    let live = true;
    void (async () => {
      const outcome = await read();
      if (live) settle(outcome);
    })();
    return () => {
      live = false;
    };
  }, [hydrated, opened, read, settle]);

  const share = useCallback(
    async (format: ShareFormat) => {
      if (sharing) return false;
      setSharing(format);
      setShareError(null);
      try {
        if (format === 'pdf') {
          const page = await source.export(id, 'html');
          await shareReportPdf(pdfFileName(page.name), page.body);
        } else {
          const file = await source.export(id, format);
          await shareReportFile(file.name, file.body, REPORT_FILES[format]);
        }
        return true;
      } catch (e) {
        if (e instanceof SharingUnavailableError) setShareError(i18n.t('chat.report.shareUnavailable'));
        else if (format === 'pdf' && !(e instanceof ApiError)) setShareError(i18n.t('chat.report.pdfFailed'));
        else if (format === 'ics' && e instanceof ApiError && e.status === 404) setShareError(i18n.t('chat.report.noDates'));
        else setShareError(describeApiError(e) ?? i18n.t('chat.report.shareFailed'));
        return false;
      } finally {
        setSharing(null);
      }
    },
    [id, sharing, source],
  );

  return { report, loading, error, gone, sharing, shareError, options: shareOptions(report, pdf), actions: { retry, share } };
}
