/**
 * One picture from the Pond for a row or a sheet: its data URI once it has loaded, and whether it
 * could not. Loaded through `services/pond-images.ts`, which keeps what it has read.
 */

import { useEffect, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { loadPondImage, peekPondImage } from '@/services/pond-images';

export interface PondImage {
  uri: string | null;
  failed: boolean;
}

/** @param path The picture's Pond path, or null for an event that kept none. */
export function usePondImage(path: string | null, version = ''): PondImage {
  const { hydrated } = useServer();
  const key = path === null ? null : `${path}#${version}`;
  const [loaded, setLoaded] = useState<{ key: string | null; uri: string | null; failed: boolean }>(() => ({
    key,
    uri: path === null ? null : peekPondImage(path, version),
    failed: false,
  }));

  // Another picture is not this one: start over, as the lists do for their own source.
  if (loaded.key !== key) {
    setLoaded({ key, uri: path === null ? null : peekPondImage(path, version), failed: false });
  }

  useEffect(() => {
    if (!hydrated || path === null || peekPondImage(path, version) !== null) return;
    let live = true;
    loadPondImage(path, version).then(
      (uri) => live && setLoaded({ key: `${path}#${version}`, uri, failed: false }),
      () => live && setLoaded({ key: `${path}#${version}`, uri: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [hydrated, path, version]);

  return { uri: loaded.key === key ? loaded.uri : null, failed: loaded.key === key && loaded.failed };
}
