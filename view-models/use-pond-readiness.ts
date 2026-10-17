/**
 * Whether a Pond just set up can answer yet: its chat model on disk and warmed, or still on its way.
 * Readable only once setup is done, since the Pond refuses its model routes until then.
 */

import { useCallback, useEffect, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';
import type { DeviceSelf, ModelEntry, WarmupStatus } from '@/services/types';
import { downloadsByModel, holderOf, isDownloaded, pondModelId, recommendations, roleOf, type ModelDownload } from '@/models/model-library';
import { useLive } from './use-live';
import { useModelLibrary, type UseModelLibrary } from './use-model-library';

export type Readiness = 'checking' | 'ready' | 'warming' | 'downloading' | 'notDownloaded' | 'noModel';

export interface UsePondReadiness {
  readiness: Readiness;
  /** The model doing the chat job. */
  chat: ModelEntry | null;
  /** Its download, while one is moving or paused. */
  download: ModelDownload | null;
  /** What the Pond suggests when nothing is doing the chat job. */
  suggestion: ModelEntry | null;
  warmup: WarmupStatus | null;
  /** Which member the Pond attributes this phone to; null is nobody, which is the truth until the Pond can say otherwise. */
  self: DeviceSelf | null;
  library: UseModelLibrary;
}

export function readinessOf(chat: ModelEntry | null, download: ModelDownload | null, warmup: WarmupStatus | null, loaded: boolean): Readiness {
  if (!loaded) return 'checking';
  if (download) return 'downloading';
  if (!chat) return 'noModel';
  if (!isDownloaded(chat)) return 'notDownloaded';
  return warmup?.state === 'warming' ? 'warming' : 'ready';
}

const WARMUP_MS = 5_000;

export function usePondReadiness(): UsePondReadiness {
  const { hydrated } = useServer();
  const library = useModelLibrary();
  const [warmup, setWarmup] = useState<WarmupStatus | null>(null);
  const [self, setSelf] = useState<DeviceSelf | null>(null);

  const readWarmup = useCallback(async () => {
    try {
      setWarmup(await api.warmup());
    } catch {
      // Warming is a nicety on top of the model being there; an unanswered read changes nothing.
    }
  }, []);
  useLive(readWarmup, WARMUP_MS, hydrated);

  useEffect(() => {
    if (!hydrated) return;
    void api.deviceSelf().then(setSelf).catch(() => setSelf(null));
  }, [hydrated]);

  const chat = holderOf(library.models, 'chat');
  const live = downloadsByModel(library.downloads).filter((d) => d.status === 'downloading' || d.status === 'paused');
  // Only a chat model's download keeps Goose from answering; a voice fetching meanwhile does not.
  const chatIds = new Set(library.models.filter((m) => roleOf(m) === 'chat').map(pondModelId));
  const download = live.find((d) => (chat ? d.modelId === pondModelId(chat) : chatIds.has(d.modelId))) ?? null;
  const suggestion = chat ? null : recommendations(library.models).find((m) => roleOf(m) === 'chat') ?? null;

  return {
    readiness: readinessOf(chat, download, warmup, library.loaded),
    chat,
    download,
    suggestion,
    warmup,
    self,
    library,
  };
}
