/**
 * Owner setup's model step, for a Pond that will not finish without a chat model: the Pond's own
 * suggestion with its size, fetched only once asked. P4 gives a model the chat job without waiting
 * for its file, so setup finishes as soon as the download starts, and Home's getting-ready card shows
 * the rest. An older Pond refuses to list models before setup, and the step says what is missing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { setupModelChoice, type SetupModelChoice } from '@/models/model-library';
import type { UseOwnerSetup } from './use-owner-setup';
import { useModelLibrary, type UseModelLibrary } from './use-model-library';

export interface UseSetupModel {
  /** Null until the Pond has answered; `unavailable` when it will not list models before setup. */
  choice: SetupModelChoice | null;
  unavailable: boolean;
  /** The model was given the job and the Pond still would not finish: its write did not stick. */
  stalled: boolean;
  retry: () => void;
  library: UseModelLibrary;
}

export function useSetupModel(setup: UseOwnerSetup): UseSetupModel {
  const library = useModelLibrary();
  const choice = library.loaded ? setupModelChoice(library.models, library.downloads) : null;
  const handled = useRef<string | null>(null);
  const [stalled, setStalled] = useState<string | null>(null);
  const kind = choice?.kind ?? null;
  const modelId = choice && choice.kind !== 'none' ? choice.model.id : null;
  const { activate } = library.actions;
  const { finish } = setup.actions;

  // Each model is given the job and finished with once, by itself; after that only Try again asks.
  // Keyed on the model, not on what the list says of it: a Pond that drops the activation would
  // otherwise flip it between ready and held and be asked again on every read.
  useEffect(() => {
    if (!choice || !modelId || (kind !== 'ready' && kind !== 'held' && kind !== 'downloading')) return;
    if (handled.current === modelId) return;
    handled.current = modelId;
    void (async () => {
      if ((choice.kind === 'ready' || choice.kind === 'downloading') && !(await activate(choice.model))) return;
      // The Pond writes chat_model on activation but ignores a failed write, so finishing can still refuse.
      if (!(await finish())) setStalled(modelId);
    })();
  }, [choice, kind, modelId, activate, finish]);

  const retry = useCallback(() => {
    if (!choice || choice.kind === 'none' || choice.kind === 'download') return;
    const model = choice.model;
    setStalled(null);
    handled.current = model.id;
    void (async () => {
      if (!(await activate(model))) return;
      if (!(await finish())) setStalled(model.id);
    })();
  }, [choice, activate, finish]);

  return { choice, unavailable: !library.loaded && !!library.error, stalled: !!modelId && stalled === modelId, retry, library };
}
