// The read every My Goose hub screen makes: through the hub source, gated on `hydrated`, polled
// with `useLive` while the screen is in front, and reporting a failed read as a flag.

import { useCallback, useEffect, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import { describeApiError, logFailure } from './describe-error';
import { useHubSource, type HubSource } from './hub-source';
import { useLive } from './use-live';

export interface HubRead<T> {
  data: T;
  /** Replace what is shown, after an action answered with the new value. */
  setData: (update: T | ((current: T) => T)) => void;
  /** Nothing read yet, and a read is out. */
  loading: boolean;
  /** The last read failed and nothing was ever read: the screen draws `ContentUnavailable`. */
  failed: boolean;
  /** Something to say about that failure, or null when the connection strip already says it. */
  error: string | null;
  reload: () => Promise<void>;
  source: HubSource;
}

/**
 * `delay` may read the data, so a screen polls quickly while the Pond is writing something and
 * slowly otherwise. `enabled` holds the read off, as for a part this Pond does not serve.
 */
export function useHubRead<T>(
  scope: string,
  read: (source: HubSource) => Promise<T>,
  initial: T,
  delay: number | ((data: T) => number),
  enabled = true,
): HubRead<T> {
  const { hydrated } = useServer();
  const source = useHubSource();
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const had = useRef(false);
  const dataRef = useRef(data);
  const readRef = useRef(read);
  useEffect(() => {
    dataRef.current = data;
    readRef.current = read;
  });

  // The Developer toggle swaps the Pond for the mock: what one said is not the other's.
  const lastSource = useRef(source);
  useEffect(() => {
    if (lastSource.current === source) return;
    lastSource.current = source;
    had.current = false;
    setData(initial);
    setLoading(true);
    // `initial` is a fresh literal each render; only a change of source resets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const reload = useCallback(async () => {
    try {
      const next = await readRef.current(source);
      had.current = true;
      setData(next);
      setFailed(false);
      setError(null);
    } catch (e) {
      logFailure(scope, 'read failed', e);
      setError(describeApiError(e));
      setFailed(!had.current);
    } finally {
      setLoading(false);
    }
  }, [scope, source]);

  useLive(reload, () => (typeof delay === 'function' ? delay(dataRef.current) : delay), hydrated && enabled);

  return { data, setData, loading: loading && enabled, failed, error, reload, source };
}

/**
 * Run an action against the Pond, saying in the snackbar what went wrong if it did. Resolves with
 * the action's answer, or null when it failed. `retry` offers Try again for a cheap request.
 */
export async function hubAction<T>(scope: string, run: () => Promise<T>, options: { retry?: boolean } = {}): Promise<T | null> {
  try {
    return await run();
  } catch (e) {
    logFailure(scope, 'action failed', e);
    showSnackbar({
      message: describeApiError(e) ?? i18n.t('goose.errors.action'),
      tone: 'danger',
      ...(options.retry ? { action: { label: i18n.t('goose.errors.tryAgain'), onPress: () => void hubAction(scope, run) } } : {}),
    });
    return null;
  }
}
