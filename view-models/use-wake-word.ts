/**
 * The wake phrase on a screen of its own, for after setup: read from and saved to the Pond's record
 * through the shared settings store, so Settings shows the change at once. A save is confirmed in
 * the snackbar; a refusal is the field's own error, beside it.
 */

import { useState } from 'react';

import { wakeChoiceValid, wakeDraftFrom, wakePhrase, type SetupDraft } from '@/models/owner-setup';
import { useServer } from '@/providers/server-provider';
import { confirm } from '@/services/haptics';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import { finishChecklistItem } from './use-setup-checklist';
import { usePondSettings } from './use-pond-settings';

type WakeChoice = Pick<SetupDraft, 'wakeWord' | 'wakeWordCustom'>;

export interface UseWakeWord {
  data: { draft: WakeChoice; saved: string | null; valid: boolean; changed: boolean };
  loading: boolean;
  saving: boolean;
  failed: boolean;
  error: string | null;
  actions: { patch: (change: Partial<WakeChoice>) => void; save: () => Promise<void>; reload: () => Promise<void> };
}

export function useWakeWord(): UseWakeWord {
  const { profileId } = useServer();
  const pond = usePondSettings();
  const saved = pond.settings?.voice_wake_word?.trim() || null;
  const [edits, setEdits] = useState<WakeChoice | null>(null);
  const draft = edits ?? wakeDraftFrom(saved);
  const phrase = wakePhrase(draft);
  const { update, refresh } = pond.actions;

  const patch = (change: Partial<WakeChoice>) => setEdits({ ...draft, ...change });

  const save = async () => {
    if (!wakeChoiceValid(draft) || !phrase) return;
    if (await update('voice_wake_word', phrase)) {
      void confirm();
      setEdits(null);
      showSnackbar({ message: i18n.t('setup.wake.saved', { phrase }) });
      if (profileId) void finishChecklistItem(profileId, 'wake');
    }
  };

  return {
    data: { draft, saved, valid: wakeChoiceValid(draft) && !!phrase, changed: phrase !== (saved ?? '') },
    loading: !pond.settings && pond.loading,
    saving: !!pond.saving.voice_wake_word,
    failed: pond.failed,
    error: pond.fieldErrors.voice_wake_word ?? null,
    actions: { patch, save, reload: refresh },
  };
}
