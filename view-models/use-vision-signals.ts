/**
 * What the automation form offers a camera rule to listen for: every signal the pond can match, one
 * entry per household member by name, and the cameras there are when there is more than one.
 *
 * Read once when the form opens, not polled: the form only exists while it is open, and what it
 * lists does not move under a finger. A pond that cannot be asked offers the signals it can match
 * without the people, so the form still works.
 */

import { useEffect, useMemo, useState } from 'react';

import { signalOptions, type SignalOption } from '@/models/vision';
import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';
import { useFaces } from './use-faces';
import { usePondSettings } from './use-pond-settings';

export interface UseVisionSignals {
  options: SignalOption[];
  /** Camera ids, empty until read or when the pond reports none. */
  cameras: string[];
  nameOf: (profileId: string) => string | null;
}

export function useVisionSignals(): UseVisionSignals {
  const { hydrated } = useServer();
  const faces = useFaces();
  const { settings } = usePondSettings();
  const [cameras, setCameras] = useState<string[]>([]);

  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    api.listCameras().then(
      (list) => live && setCameras(list.map((c) => c.id)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [hydrated]);

  const options = useMemo(
    () =>
      signalOptions(
        faces.data.people,
        settings?.vision_event_types ?? [],
        settings?.vision_face_recognition_enabled ?? true,
      ),
    [faces.data.people, settings?.vision_event_types, settings?.vision_face_recognition_enabled],
  );

  return { options, cameras, nameOf: faces.nameOf };
}
