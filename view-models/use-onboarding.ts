/**
 * Whether the first-run flow still has something to say.
 *
 * Paired is the real signal; the stored flag only records someone choosing
 * "set up later", so dismissing it does not strand them on a screen they
 * already refused.
 */

import { useCallback, useEffect, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { Storage } from '@/services/storage';

export interface UseOnboarding {
  data: { show: boolean; paired: boolean };
  loading: boolean;
  actions: { dismiss: () => void; reset: () => void };
}

export function useOnboarding(): UseOnboarding {
  const { token, hydrated } = useServer();
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void Storage.get('onboardingDone').then((v) => {
      if (active) setDismissed(v === 'true');
    });
    return () => {
      active = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    void Storage.set('onboardingDone', 'true');
  }, []);

  const reset = useCallback(() => {
    setDismissed(false);
    void Storage.remove('onboardingDone');
  }, []);

  const paired = Boolean(token);
  const loading = !hydrated || dismissed === null;

  return {
    data: { show: !loading && !paired && !dismissed, paired },
    loading,
    actions: { dismiss, reset },
  };
}
