import { useCallback, useEffect, useRef, useState } from 'react';
import { useServer } from '@/providers/server-provider';
import { cancelRemoteAccess, enableRemoteAccess, RemoteInfrastructureUnavailableError, type RemoteProgress } from '@/services/remote-access';
import i18n from '@/services/i18n';
export function useRemoteAccess() {
  const { profileId, serverUrl, setRemoteEndpoint, keepLocalOnly, remoteEnabled } = useServer();
  const [progress, setProgress] = useState<RemoteProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [setupUnavailable, setSetupUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; void cancelRemoteAccess().catch(() => undefined); }; }, []);
  const start = useCallback(async (recovery = false) => {
    if (busy) return;
    setBusy(true); setError(null); setReviewId(null); setProgress(null); setSetupUnavailable(false);
    try {
      await enableRemoteAccess(profileId, serverUrl, (next) => { if (alive.current) setProgress(next); },
        async (endpoint, control, current) => {
          if (!alive.current) throw new Error(i18n.t('remote.cancelled'));
          await setRemoteEndpoint(endpoint, control, current);
        }, recovery ? { onReview: (id) => { if (alive.current) setReviewId(id); } } : undefined);
    } catch (cause) {
      if (alive.current) {
        setSetupUnavailable(cause instanceof RemoteInfrastructureUnavailableError);
        setError(cause instanceof Error ? cause.message : i18n.t('remote.failed'));
      }
    } finally { if (alive.current) setBusy(false); }
  }, [busy, profileId, serverUrl, setRemoteEndpoint, keepLocalOnly, remoteEnabled]);
  const localOnly = useCallback(async () => {
    try { await keepLocalOnly(); return true; }
    catch { if (alive.current) setError(i18n.t('remote.failed')); return false; }
  }, [keepLocalOnly]);
  return { setupUnavailable, reviewId, recover: () => start(true), progress: remoteEnabled ? 'enabled' as const : progress, error, busy, enable: () => start(false), localOnly };
}
