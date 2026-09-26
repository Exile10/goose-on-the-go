/**
 * Mic permission state, mirroring `expo-camera`'s `useCameraPermissions()`
 * ergonomics — `expo-audio` only exposes plain async functions
 * (`getRecordingPermissionsAsync`/`requestRecordingPermissionsAsync`), no
 * hook of its own.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  type PermissionResponse,
} from 'expo-audio';

export function useMicrophonePermission(): [PermissionResponse | null, () => Promise<PermissionResponse>] {
  const [permission, setPermission] = useState<PermissionResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRecordingPermissionsAsync().then((p) => {
      if (!cancelled) setPermission(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const requestPermission = useCallback(async () => {
    const p = await requestRecordingPermissionsAsync();
    setPermission(p);
    return p;
  }, []);

  return [permission, requestPermission];
}
