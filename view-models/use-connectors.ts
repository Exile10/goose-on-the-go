// The services the Pond connects to: the list, connecting one from the fields it names, and
// making a webhook whose address is shown once (docs/MY-GOOSE-HUB.md, part 5).

import { useCallback, useState } from 'react';

import type { Connector } from '@/models/connectors';
import { ApiError } from '@/services/api-client';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import { describeApiError, logFailure, refusalReason } from './describe-error';
import { hubAction, useHubRead } from './hub-read';

export const CONNECTORS_MS = 10 * 60_000;

export function useConnectors(enabled = true) {
  const list = useHubRead<Connector[]>('connectors', (s) => s.connectors(), [], CONNECTORS_MS, enabled);
  const { source, setData } = list;
  const [busy, setBusy] = useState<string | null>(null);
  /** A form's refusal, kept beside the form rather than in the snackbar. */
  const [formError, setFormError] = useState<string | null>(null);

  const put = useCallback((c: Connector) => setData((all) => (all.some((x) => x.id === c.id) ? all.map((x) => (x.id === c.id ? c : x)) : [...all, c])), [setData]);

  const connect = useCallback(
    async (id: string, fields: Record<string, string | boolean>) => {
      setBusy(id);
      setFormError(null);
      try {
        const done = await source.connectConnector(id, fields);
        put(done);
        showSnackbar({ message: i18n.t('goose.connectors.connected', { name: done.name }), tone: 'success' });
        return done;
      } catch (e) {
        logFailure('connectors', 'connect failed', e);
        setFormError(
          e instanceof ApiError && e.status === 400
            ? refusalReason(e) === 'missing_fields' || e.detail === 'missing_fields'
              ? i18n.t('goose.connectors.missing')
              : i18n.t('goose.connectors.refused')
            : (describeApiError(e) ?? i18n.t('goose.errors.action')),
        );
        return null;
      } finally {
        setBusy(null);
      }
    },
    [put, source],
  );

  const disconnect = useCallback(
    async (id: string) => {
      setBusy(id);
      const done = await hubAction('connectors', () => source.disconnectConnector(id));
      setBusy(null);
      if (done) {
        put(done);
        showSnackbar({ message: i18n.t('goose.connectors.disconnected', { name: done.name }), tone: 'success' });
      }
      return done;
    },
    [put, source],
  );

  /** The new webhook; its address is on this answer only, so the caller shows it now. */
  const makeWebhook = useCallback(
    async (name: string) => {
      setBusy('webhook');
      const made = await hubAction('connectors', () => source.makeWebhook(name.trim()));
      setBusy(null);
      if (made) put({ ...made, webhookUrl: null });
      return made;
    },
    [put, source],
  );

  return { ...list, busy, formError, actions: { reload: list.reload, connect, disconnect, makeWebhook, clearFormError: () => setFormError(null) } };
}

export type UseConnectors = ReturnType<typeof useConnectors>;
