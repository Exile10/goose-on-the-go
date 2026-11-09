/**
 * The "Listen for Hey Goose" switch (`services/phone-wake.ts`).
 *
 * The wake word opens the assistant's voice orb, so it needs Goose to be the phone's assistant and
 * the microphone; turning it on asks for both first and says which is missing. Android owns the
 * service, which can stop on its own (a refusal, the notification's Stop, the assistant changed),
 * so the state is read when the row appears and again each time the app returns to the front.
 */

import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useTranslation } from 'react-i18next';

import { isPhoneAssistant } from '@/services/phone-assistant';
import type { TranslationKey } from '@/services/i18n';
import {
  choosePhoneWake,
  CNN_PHRASE,
  phoneWakeState,
  phoneWakeSupported,
  wakeMode,
  type PhoneWakeState,
  type WakeMode,
  type WakeRefusal,
} from '@/services/phone-wake';
import { wakeNotificationWords } from '@/services/phone-wake-pond';
import { requestMicrophone } from '@/services/voice-io';
import { usePondSettings } from './use-pond-settings';

export interface UsePhoneWake {
  data: {
    /** False on iOS, on a build without the detector, and before Android 8. */
    supported: boolean;
    /** The household's phrase, as set on the Pond; "hey goose" until the settings are read. */
    phrase: string;
    /** Whether this phone hears the phrase itself or asks the Pond. */
    mode: WakeMode;
    /** The switch: the person's choice. */
    on: boolean;
    busy: boolean;
    /** Why it is not listening when it should be, or why turning it on failed. */
    error: string | null;
  };
  actions: {
    set: (on: boolean) => Promise<void>;
  };
}

const REFUSAL: Record<WakeRefusal, TranslationKey> = {
  start_refused: 'settings.phoneWake.refused.start',
  no_microphone: 'settings.phoneWake.microphone',
  model_failed: 'settings.phoneWake.refused.model',
  not_assistant: 'settings.phoneWake.refused.notAssistant',
};

/** The words the error line shows for this state, or null when there is nothing to explain. */
export function wakeProblem(state: PhoneWakeState | null): TranslationKey | null {
  return state?.refusal ? REFUSAL[state.refusal] : null;
}

export function usePhoneWake(): UsePhoneWake {
  const { t } = useTranslation();
  const supported = phoneWakeSupported();
  const phrase = usePondSettings().settings?.voice_wake_word?.trim() || CNN_PHRASE;
  const [state, setState] = useState<PhoneWakeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    (next: PhoneWakeState | null) => {
      setState(next);
      const problem = wakeProblem(next);
      setError(problem ? t(problem) : null);
    },
    [t],
  );
  const read = useCallback(() => phoneWakeState().then(apply), [apply]);

  useEffect(() => {
    if (!supported) return;
    let live = true;
    const refresh = () => {
      void phoneWakeState().then((next) => {
        if (live) apply(next);
      });
    };
    refresh();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, [supported, apply]);

  const set = useCallback(
    async (on: boolean) => {
      setError(null);
      setBusy(true);
      try {
        if (on) {
          if ((await isPhoneAssistant()) === false) {
            setError(t('settings.phoneWake.needsAssistant'));
            return;
          }
          const mic = await requestMicrophone();
          if (!mic.granted) {
            setError(t(mic.canAskAgain ? 'settings.phoneWake.microphone' : 'settings.phoneWake.microphoneSettings'));
            return;
          }
        }
        const accepted = await choosePhoneWake(on, wakeNotificationWords(phrase));
        await read();
        if (!accepted) setError((current) => current ?? t('settings.phoneWake.refused.start'));
      } finally {
        setBusy(false);
      }
    },
    [read, t, phrase],
  );

  return {
    data: { supported, phrase, mode: wakeMode(phrase), on: state?.chosen ?? false, busy, error },
    actions: { set },
  };
}
