/**
 * Owner setup's model step, for a Pond that will not finish without a chat model: the Pond's own
 * suggestion with its size, fetched only once asked, then given the chat job, then setup finishes.
 * P4 lets a paired phone read and change models before setup is done; an older Pond refuses, and the
 * step says what is missing instead.
 */

import { useEffect, useRef } from 'react';

import { setupModelChoice, type SetupModelChoice } from '@/models/model-library';
import type { UseOwnerSetup } from './use-owner-setup';
import { useModelLibrary, type UseModelLibrary } from './use-model-library';

export interface UseSetupModel {
  /** Null until the Pond has answered; `unavailable` when it will not list models before setup. */
  choice: SetupModelChoice | null;
  unavailable: boolean;
  library: UseModelLibrary;
}

export function useSetupModel(setup: UseOwnerSetup): UseSetupModel {
  const library = useModelLibrary();
  const choice = library.loaded ? setupModelChoice(library.models, library.downloads) : null;
  const handled = useRef<string | null>(null);
  const kind = choice?.kind ?? null;
  const modelId = choice && choice.kind !== 'none' ? choice.model.id : null;
  const { activate } = library.actions;
  const { finish } = setup.actions;

  // A model on the Pond is given the job, and a model holding it lets setup finish, each once.
  useEffect(() => {
    if (!choice || !modelId || (kind !== 'ready' && kind !== 'held')) return;
    const key = `${kind}:${modelId}`;
    if (handled.current === key) return;
    handled.current = key;
    void (async () => {
      if (kind === 'ready' && choice.kind === 'ready' && !(await activate(choice.model))) return;
      await finish();
    })();
  }, [choice, kind, modelId, activate, finish]);

  return { choice, unavailable: !library.loaded && !!library.error, library };
}
