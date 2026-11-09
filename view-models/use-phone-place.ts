/**
 * The "Tell Goose where this phone is" switch (`services/phone-place.ts`). This phone's own
 * choice, like haptics, so it lives here and not in the Pond's settings. Turning it on asks for
 * location permission; a refusal leaves it off and says how to allow it.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { phonePlaceEnabled, savePhonePlacePreference } from '@/services/phone-place';

export interface UsePhonePlace {
  data: { on: boolean; busy: boolean; error: string | null };
  actions: { set: (on: boolean) => Promise<void> };
}

export function usePhonePlace(): UsePhonePlace {
  const { t } = useTranslation();
  const [on, setOn] = useState(phonePlaceEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = useCallback(
    async (next: boolean) => {
      setError(null);
      setBusy(true);
      try {
        const now = await savePhonePlacePreference(next);
        setOn(now);
        if (next && !now) setError(t('settings.phonePlace.allow'));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  return { data: { on, busy, error }, actions: { set } };
}
