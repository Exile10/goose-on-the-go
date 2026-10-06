/**
 * Export — the Pond's operational log as a CSV, handed to the share sheet
 * (issue #15). From `GET /logs/export`, which takes no filters: it is the
 * whole log, up to the Pond's 10,000 most recent rows.
 *
 * Behind the Developer toggle for `logs`: on mock, the sample problems go
 * through the same file and share sheet, so the path is the one a real export takes.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import { SharingUnavailableError, shareLogsCsv } from '@/services/log-export';
import { SAMPLE_PROBLEMS, logsToCsv } from '@/models/log';
import { describeApiError } from './describe-error';

export interface UseLogExport {
  exporting: boolean;
  error: string | null;
  actions: { exportLogs: () => Promise<void> };
}

export function useLogExport(): UseLogExport {
  const { t } = useTranslation();
  const { isScreenReal } = useServer();
  const real = isScreenReal('logs');

  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportLogs = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      const csv = real ? await api.exportLogsCsv() : logsToCsv(SAMPLE_PROBLEMS);
      await shareLogsCsv(csv);
    } catch (e) {
      if (e instanceof SharingUnavailableError) setError(t('activity.export.noShare'));
      // 501: the Pond was started without its operational log.
      else if (e instanceof ApiError && e.status === 501) setError(t('activity.export.noLog'));
      // Somebody pressed a button: a failure says so even when the banner explains why.
      else setError(describeApiError(e) ?? t('activity.export.failed'));
    } finally {
      setExporting(false);
    }
  }, [real, t]);

  return { exporting, error, actions: { exportLogs } };
}
