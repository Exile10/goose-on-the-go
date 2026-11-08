/**
 * The setting that makes Goose this phone's assistant (`services/phone-assistant.ts`).
 *
 * Android owns the choice: the app can only open the screen where it is made and read the answer
 * back. So the answer is read when the row appears and again each time the app returns to the
 * front, which is how a choice made in Settings reaches the row.
 */

import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useTranslation } from 'react-i18next';

import { assistantSupported, choosePhoneAssistant, isPhoneAssistant } from '@/services/phone-assistant';

export interface UsePhoneAssistant {
  data: {
    /** False on iOS and on an Android build without the assistant. */
    supported: boolean;
    /** Whether Goose is the assistant; null while unknown, or where Android cannot say. */
    held: boolean | null;
    error: string | null;
  };
  actions: {
    /** Open the system screen where the assistant is chosen. */
    choose: () => Promise<void>;
  };
}

export function usePhoneAssistant(): UsePhoneAssistant {
  const { t } = useTranslation();
  const supported = assistantSupported();
  const [held, setHeld] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    let live = true;
    const read = () => {
      void isPhoneAssistant().then((next) => {
        if (live) setHeld(next);
      });
    };
    read();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, [supported]);

  const choose = useCallback(async () => {
    setError(null);
    if (!(await choosePhoneAssistant())) setError(t('settings.phoneAssistant.openFailed'));
  }, [t]);

  return { data: { supported, held, error }, actions: { choose } };
}
