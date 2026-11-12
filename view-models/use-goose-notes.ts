// What Goose wrote down for itself about working for this member: the member reads the notes and
// deletes any, and never writes one (pond docs/architecture/my-goose-hub.md, part 0b).

import { useCallback, useEffect, useRef } from 'react';

import { EMPTY_NOTES, type GooseNote, type GooseNotes } from '@/models/goose-notes';
import { api } from '@/services/api-client';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import { hubAction, useHubRead } from './hub-read';

export const NOTES_MS = 5 * 60_000;

export function useGooseNotes() {
  const notes = useHubRead<GooseNotes>('goose-notes', () => api.gooseNotes(), EMPTY_NOTES, NOTES_MS);
  const { data, setData } = notes;
  const latest = useRef(data);
  useEffect(() => {
    latest.current = data;
  });

  const remove = useCallback(
    async (note: GooseNote) => {
      const list = latest.current.lessons.some((n) => n.id === note.id) ? 'lessons' : 'notes';
      const at = latest.current[list].findIndex((n) => n.id === note.id);
      if (at < 0) return;
      setData((d) => ({ ...d, [list]: d[list].filter((n) => n.id !== note.id) }));
      const gone = await hubAction('goose-notes', () => api.deleteGooseNote(note.id).then(() => true));
      if (!gone) {
        setData((d) => (d[list].some((n) => n.id === note.id) ? d : { ...d, [list]: [...d[list].slice(0, at), note, ...d[list].slice(at)] }));
        return;
      }
      showSnackbar({ message: i18n.t('goose.notes.deleted'), tone: 'success' });
    },
    [setData],
  );

  return { ...notes, actions: { reload: notes.reload, remove } };
}

export type UseGooseNotes = ReturnType<typeof useGooseNotes>;
