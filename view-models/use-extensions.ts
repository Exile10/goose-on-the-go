/**
 * The Pond's installed extensions and the curated marketplace to add more.
 *
 * The Pond has no concept of a remote MCP server: it is one process hosting a
 * fixed set of built-in extensions, each enabled or disabled, dispatched
 * through `crates/pond-mcp-server/src/dispatcher.rs`. A marketplace entry is
 * not installed until `POST /marketplace/{id}/install` says so, at which point
 * it belongs in the installed list instead (#92).
 */

import { useCallback, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import type { Extension, MarketplaceExtension } from '@/services/types';
import { describeApiError } from './describe-error';
import { useLive } from './use-live';

/** How often the list is re-read while the screen is in front. */
export const EXTENSIONS_MS = 30_000;

export interface UseExtensions {
  data: {
    installed: Extension[];
    /** Marketplace entries not already installed. */
    available: MarketplaceExtension[];
  };
  loading: boolean;
  error: string | null;
  actions: {
    refresh: () => Promise<void>;
    setEnabled: (name: string, enabled: boolean) => Promise<void>;
    /** Installs a marketplace entry and folds it into `installed` on success. */
    install: (item: MarketplaceExtension) => Promise<boolean>;
  };
}

export function useExtensions(): UseExtensions {
  const [installed, setInstalled] = useState<Extension[]>([]);
  const [available, setAvailable] = useState<MarketplaceExtension[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The base URL and bearer token arrive asynchronously; fetching before they
  // land calls the default address unauthenticated and never retries.
  const { hydrated } = useServer();

  // Whether a read has ever succeeded. After one, a failed poll keeps what is on screen.
  const loaded = useRef(false);

  /** `loud` is a read somebody asked for; a poll is quiet and keeps the last good data. */
  const load = useCallback(async (loud: boolean) => {
    if (loud) {
      setLoading(true);
      setError(null);
    }
    try {
      const [extensions, marketplace] = await Promise.all([
        api.listExtensions(),
        api.listMarketplace(),
      ]);
      const installedNames = new Set(extensions.map((e) => e.name));
      setInstalled(extensions);
      setAvailable(marketplace.filter((m) => !installedNames.has(m.name)));
      loaded.current = true;
      setError(null);
    } catch (e) {
      if (loud || !loaded.current) setError(describeApiError(e));
      else console.warn('[extensions] refresh failed; showing the last list', e instanceof ApiError ? e.status : 'network');
    } finally {
      setLoading(false);
    }
  }, []);

  useLive(() => load(false), EXTENSIONS_MS, hydrated);
  const refresh = useCallback(() => load(true), [load]);

  const setEnabled = useCallback(
    async (name: string, enabled: boolean) => {
      const previous = installed;
      setInstalled((current) => current.map((e) => (e.name === name ? { ...e, enabled } : e)));
      try {
        await api.setExtensionEnabled(name, enabled);
      } catch (e) {
        setInstalled(previous);
        setError(describeApiError(e));
      }
    },
    [installed],
  );

  const install = useCallback(
    async (item: MarketplaceExtension) => {
      setError(null);
      try {
        await api.installMarketplaceExtension(item.id);
        await load(true);
        return true;
      } catch (e) {
        setError(describeApiError(e));
        return false;
      }
    },
    [load],
  );

  return {
    data: { installed, available },
    loading,
    error,
    actions: { refresh, setEnabled, install },
  };
}
