// The Pond's data directory, one folder at a time. Nothing is deleted without a confirmation that
// names the entry and its size; the Pond still has the last word on what may go.

import { useCallback, useState } from 'react';

import { breadcrumbs, sizeWords, type Crumb } from '@/models/pond-admin';
import { useConfirm } from '@/providers/confirm-provider';
import i18n from '@/services/i18n';
import type { AdminFileEntry, AdminKeepReason } from '@/services/types';
import { describeApiError } from './describe-error';
import { adminRefusal } from './pond-admin-source';
import { keepReasonWords } from './pond-admin-words';
import { useAdminGate, useAdminLoad, type AdminGate } from './use-admin-gate';

export interface UsePondFiles {
  gate: AdminGate;
  path: string;
  crumbs: Crumb[];
  entries: AdminFileEntry[];
  /** What the folder on screen holds in all. */
  total: number;
  /** Nothing is known yet about the folder on screen. */
  loading: boolean;
  /** The folder could not be read, so an empty list says nothing about it. */
  failed: boolean;
  error: string | null;
  /** What the last delete did. */
  notice: string | null;
  /** The path being deleted, or null. */
  removing: string | null;
  actions: {
    refresh: () => Promise<void>;
    /** Into a folder; anything else is not opened. */
    open: (entry: AdminFileEntry) => void;
    /** To a folder on the way back to the data directory. */
    goTo: (path: string) => void;
    /** Asks first; resolves to whether it was deleted. */
    remove: (entry: AdminFileEntry) => Promise<boolean>;
  };
}

function parentOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

function refusalWords(e: unknown): string {
  const code = adminRefusal(e);
  if (code === 'protected_path') {
    const reason = (e as { body?: { reason?: unknown } }).body?.reason;
    return reason === 'in_use' || reason === 'managed_by_models' ? keepReasonWords(reason as AdminKeepReason) : keepReasonWords('protected');
  }
  if (code === 'not_found') return i18n.t('myPond.files.gone');
  if (code === 'invalid_path') return i18n.t('myPond.files.invalidPath');
  return describeApiError(e) ?? i18n.t('myPond.files.deleteFailed');
}

export function usePondFiles(): UsePondFiles {
  const ask = useConfirm();
  const { gate, source, noteFailure, touch } = useAdminGate();
  const [path, setPath] = useState('');
  const [shown, setShown] = useState<{ path: string; entries: AdminFileEntry[] } | null>(null);
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const read = useCallback(
    async (start: string) => {
      setReading(true);
      setError(null);
      let at = start;
      try {
        for (;;) {
          try {
            const listing = await source.files(at);
            setShown({ path: at, entries: listing.entries });
            setPath(at);
            setFailed(false);
            touch();
            return;
          } catch (e) {
            if (noteFailure(e)) return;
            const code = adminRefusal(e);
            // A folder deleted or replaced elsewhere: the one above it is the nearest thing still there.
            if ((code === 'not_found' || code === 'not_a_directory' || code === 'invalid_path') && at !== '') {
              setNotice(i18n.t('myPond.files.folderGone'));
              at = parentOf(at);
              continue;
            }
            setFailed(true);
            setError(describeApiError(e) ?? i18n.t('myPond.files.readFailed'));
            return;
          }
        }
      } finally {
        setReading(false);
      }
    },
    [noteFailure, source, touch],
  );

  useAdminLoad(() => read(path), gate);

  const goTo = useCallback(
    (next: string) => {
      setNotice(null);
      setPath(next);
      void read(next);
    },
    [read],
  );

  const open = useCallback(
    (entry: AdminFileEntry) => {
      if (entry.kind === 'directory') goTo(entry.path);
    },
    [goTo],
  );

  const remove = useCallback(
    async (entry: AdminFileEntry) => {
      if (!entry.deletable || removing) return false;
      const size = sizeWords(entry.bytes);
      const yes = await ask({
        title: i18n.t('myPond.files.deleteTitle', { name: entry.name }),
        message:
          entry.kind === 'directory'
            ? i18n.t('myPond.files.deleteFolderBody', { size })
            : i18n.t('myPond.files.deleteFileBody', { size }),
        confirmLabel: i18n.t('myPond.files.deleteSize', { size }),
        cancelLabel: i18n.t('myPond.keepIt'),
        destructive: true,
      });
      if (!yes) return false;
      setRemoving(entry.path);
      setNotice(null);
      setError(null);
      try {
        const freed = await source.deleteFile(entry.path);
        touch();
        setNotice(i18n.t('myPond.files.deleted', { name: entry.name, size: sizeWords(freed) }));
        await read(path);
        return true;
      } catch (e) {
        if (noteFailure(e)) return false;
        setError(refusalWords(e));
        if (adminRefusal(e) === 'not_found') await read(path);
        return false;
      } finally {
        setRemoving(null);
      }
    },
    [ask, noteFailure, path, read, removing, source, touch],
  );

  const entries = shown && shown.path === path ? shown.entries : [];
  return {
    gate,
    path,
    crumbs: breadcrumbs(path),
    entries,
    total: entries.reduce((sum, e) => sum + e.bytes, 0),
    loading: reading && (shown === null || shown.path !== path),
    failed,
    error,
    notice,
    removing,
    actions: { refresh: () => read(path), open, goTo, remove },
  };
}
