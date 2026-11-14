// The Pond's pictures for the pages an answer cites or read, asked once per set of pages: a
// conversation scrolls back over the same answers, and each would otherwise ask again.

import { useEffect, useState } from 'react';

import type { ReportImage } from '@/models/web-watches';
import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';

const asked = new Map<string, Promise<ReportImage[]>>();

export function usePagePictures(pages: string[], enabled: boolean): ReportImage[] {
  const { hydrated } = useServer();
  const [pictures, setPictures] = useState<ReportImage[]>([]);
  const key = pages.join('\n');
  useEffect(() => {
    if (!hydrated || !enabled || key === '') return;
    let live = true;
    let ask = asked.get(key);
    if (!ask) {
      // A Pond that cannot answer shows no pictures; the answer itself is unaffected. The failure is
      // not kept, so the answer asks again when next drawn, by when the Pond may have kept them.
      ask = api.pagePictures(key.split('\n')).catch(() => {
        asked.delete(key);
        return [];
      });
      asked.set(key, ask);
    }
    void ask.then((found) => {
      if (live) setPictures(found);
    });
    return () => {
      live = false;
    };
  }, [hydrated, enabled, key]);
  return pictures;
}
