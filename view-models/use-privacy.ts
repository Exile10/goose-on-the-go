/**
 * The privacy screen's one live fact: the town web search sends to Brave, when Nearby places is on.
 *
 * Everything else the screen says is fixed copy, checked against the Pond (`docs/PRIVACY-SCREEN.md`).
 * This is the Pond's own report from `GET /api/v1/web-search`, read once when the screen opens. A
 * failed read, an older Pond or the Developer toggle on mock leave the fixed copy to stand alone,
 * and that copy already says nearby places sends the town.
 */

import { useEffect, useState } from 'react';

import { townSent } from '@/models/web-search';
import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';

export interface UsePrivacy {
  data: {
    /** The town each web search sends, or null when none is sent or it is not known. */
    nearbyTown: string | null;
  };
}

export function usePrivacy(): UsePrivacy {
  const { hydrated, isScreenReal } = useServer();
  const real = isScreenReal('webSearch');
  const [town, setTown] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated || !real) return;
    let live = true;
    api
      .webSearchState()
      .then((state) => {
        if (live) setTown(townSent(state.local_results));
      })
      .catch((e: unknown) => {
        console.warn('[privacy] web search status unreadable; showing the fixed copy', e instanceof Error ? e.name : 'unknown');
      });
    return () => {
      live = false;
    };
  }, [hydrated, real]);

  return { data: { nearbyTown: real ? town : null } };
}
