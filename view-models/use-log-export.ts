/**
 * Export — the Pond's operational log as a CSV, handed to the share sheet
 * (issue #15). From `GET /logs/export`, which takes no filters: it is the
 * whole log, up to the Pond's 10,000 most recent rows.
 *
 * Behind the Developer toggle for `logs`: on mock, the sample problems go
 * through the same file and share sheet, so the path is the one a real export takes.
 *
 * A failure is said in the snackbar: the share sheet is what success looks like, and a refusal is
 * about the button just pressed, not about the page.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import { SharingUnavailableError, shareLogsCsv } from '@/services/log-export';
import { showSnackbar } from '@/services/snackbar';
import { SAMPLE_PROBLEMS, logsToCsv } from '@/models/log';
import { describeActivityError } from './use-activity';

export interface UseLogExport {
  exporting: boolean;
  actions: { exportLogs: () => Promise<void> };
}

export function useLogExport(): UseLogExport {
  const { t } = useTranslation();
  const { isScreenReal } = useServer();
  const real = isScreenReal('logs');

  const [exporting, setExporting] = useState(false);
  // What the snackbar's Try again calls: the current `exportLogs`, set below once it is made.
  const retry = useRef<() => Promise<void>>(async () => {});

  const exportLogs = useCallback(async () => {
    setExporting(true);
    try {
      const csv = real ? await api.exportLogsCsv() : logsToCsv(SAMPLE_PROBLEMS);
      await shareLogsCsv(csv);
    } catch (e) {
      console.warn('[log-export] failed', e instanceof ApiError ? e.status : e instanceof Error ? e.name : 'unknown');
      // Neither a phone that cannot share nor a Pond with no log changes by asking again.
      if (e instanceof SharingUnavailableError) showSnackbar({ message: t('activity.export.noShare'), tone: 'danger' });
      // 501: the Pond was started without its operational log.
      else if (e instanceof ApiError && e.status === 501) showSnackbar({ message: t('activity.export.noLog'), tone: 'danger' });
      // Somebody pressed a button: a failure says so even when the banner explains why.
      else {
        showSnackbar({
          message: describeActivityError(e) ?? t('activity.export.failed'),
          tone: 'danger',
          action: { label: t('common.retry'), onPress: () => void retry.current() },
        });
      }
    } finally {
      setExporting(false);
    }
  }, [real, t]);
  useEffect(() => {
    retry.current = exportLogs;
  }, [exportLogs]);

  return { exporting, actions: { exportLogs } };
}
