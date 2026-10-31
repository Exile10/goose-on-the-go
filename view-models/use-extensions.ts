/**
 * The Pond's installed extensions and the curated marketplace to add more.
 *
 * The Pond has no concept of a remote MCP server: it is one process hosting a
 * fixed set of built-in extensions, each enabled or disabled, dispatched
 * through `crates/pond-mcp-server/src/dispatcher.rs`. A marketplace entry is
 * not installed until `POST /marketplace/{id}/install` says so, at which point
 * it belongs in the installed list instead (#92).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import type { Extension, MarketplaceExtension, SecretRequirement } from '@/services/types';
import { describeApiError } from './describe-error';
import { useLive } from './use-live';

/** How often the list is re-read while the screen is in front. */
export const EXTENSIONS_MS = 30_000;

/**
 * What the credentials form asks for. A sign-in is not typed, and `advanced` and
 * `host_only` keys are developer overrides and the Pond's own keys, not setup.
 */
export function credentialFields(item: MarketplaceExtension): SecretRequirement[] {
  return item.required_secrets.filter((s) => s.kind !== 'oauth_flow' && !s.advanced && !s.host_only);
}

export interface UseExtensions {
  data: {
    installed: Extension[];
    /** Marketplace entries not already installed. */
    available: MarketplaceExtension[];
    /** The whole marketplace, installed or not, so an installed card can find its requirements. */
    marketplace: MarketplaceExtension[];
  };
  loading: boolean;
  /**
   * Why the last read failed, in words. A refused toggle, install, save or removal is said in the
   * snackbar instead: it is about the control just used, not about the list.
   */
  error: string | null;
  /** The first read failed and nothing has loaded, so an empty list says nothing about the Pond. */
  failed: boolean;
  actions: {
    refresh: () => Promise<void>;
    setEnabled: (name: string, enabled: boolean) => Promise<void>;
    /** Installs a marketplace entry, with any credentials it was given, and folds it into `installed` on success. */
    install: (item: MarketplaceExtension, secrets?: Record<string, string>) => Promise<boolean>;
    /** Stores an installed extension's credentials; the Pond restarts it so it reads them. */
    saveSecrets: (name: string, secrets: Record<string, string>) => Promise<boolean>;
    /** Removes an installed marketplace extension, returning it to the marketplace. */
    remove: (name: string) => Promise<void>;
  };
}

export function useExtensions(): UseExtensions {
  const [installed, setInstalled] = useState<Extension[]>([]);
  const [marketplace, setMarketplace] = useState<MarketplaceExtension[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

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
      const [extensions, entries] = await Promise.all([
        api.listExtensions(),
        api.listMarketplace(),
      ]);
      // The Pond lists from a hash map, in a different order on every read; unsorted,
      // each poll reshuffled the cards.
      setInstalled(extensions.sort((a, b) => a.name.localeCompare(b.name)));
      setMarketplace(entries);
      loaded.current = true;
      setError(null);
      setFailed(false);
    } catch (e) {
      if (loud || !loaded.current) setError(describeApiError(e));
      else console.warn('[extensions] refresh failed; showing the last list', e instanceof ApiError ? e.status : 'network');
      if (!loaded.current) setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useLive(() => load(false), EXTENSIONS_MS, hydrated);
  const refresh = useCallback(() => load(true), [load]);

  // An installed marketplace extension is named by its marketplace id, not its display name.
  const available = useMemo(() => {
    const installedNames = new Set(installed.map((e) => e.name));
    return marketplace.filter((m) => !installedNames.has(m.id));
  }, [installed, marketplace]);

  // What the snackbar's Try again calls: the current toggle and removal, set below once made.
  const retry = useRef<Pick<UseExtensions['actions'], 'setEnabled' | 'remove'>>({
    setEnabled: async () => {},
    remove: async () => {},
  });

  const setEnabled = useCallback(
    async (name: string, enabled: boolean) => {
      const previous = installed;
      setInstalled((current) => current.map((e) => (e.name === name ? { ...e, enabled } : e)));
      try {
        await api.setExtensionEnabled(name, enabled);
      } catch (e) {
        setInstalled(previous);
        console.warn('[extensions] toggle refused', name, e instanceof ApiError ? e.status : 'network');
        // The switch has gone back; say why rather than let it look like a missed tap.
        showSnackbar({
          message: describeApiError(e) ?? i18n.t('errors.generic'),
          tone: 'danger',
          action: { label: i18n.t('common.retry'), onPress: () => void retry.current.setEnabled(name, enabled) },
        });
      }
    },
    [installed],
  );

  const install = useCallback(
    async (item: MarketplaceExtension, secrets?: Record<string, string>) => {
      try {
        await api.installMarketplaceExtension(item.id, secrets);
        await load(true);
        return true;
      } catch (e) {
        console.warn('[extensions] install refused', item.id, e instanceof ApiError ? e.status : 'network');
        // A timed-out install is no ApiError, so `describeApiError` has nothing to say, and
        // minutes of "Installing" must not end in silence. No Try again: an install can take
        // minutes, and the Install button is still there.
        showSnackbar({ message: describeApiError(e) ?? i18n.t('errors.generic'), tone: 'danger' });
        return false;
      }
    },
    [load],
  );

  const saveSecrets = useCallback(
    async (name: string, secrets: Record<string, string>) => {
      try {
        const result = await api.setExtensionSecrets(name, secrets);
        await load(false);
        // Stored either way, but an extension that did not restart still runs on the old values.
        if (result?.restart_error) {
          console.warn('[extensions] saved, restart failed', name);
          showSnackbar({ message: i18n.t('extensions.restartFailed'), tone: 'danger' });
        }
        return true;
      } catch (e) {
        console.warn('[extensions] credentials refused', name, e instanceof ApiError ? e.status : 'network');
        // A restart can run as long as an install, and a timeout is no ApiError. The form stays
        // open with what was typed, so its Save button is the way to try again.
        showSnackbar({ message: describeApiError(e) ?? i18n.t('errors.generic'), tone: 'danger' });
        return false;
      }
    },
    [load],
  );

  /** Taken off the list only once the Pond confirms: a refused removal must not look done. */
  const remove = useCallback(async (name: string) => {
    try {
      await api.removeExtension(name);
      setInstalled((current) => current.filter((e) => e.name !== name));
    } catch (e) {
      console.warn('[extensions] removal refused', name, e instanceof ApiError ? e.status : 'network');
      showSnackbar({
        message: describeApiError(e) ?? i18n.t('errors.generic'),
        tone: 'danger',
        action: { label: i18n.t('common.retry'), onPress: () => void retry.current.remove(name) },
      });
    }
  }, []);
  useEffect(() => {
    retry.current = { setEnabled, remove };
  }, [setEnabled, remove]);

  return {
    data: { installed, available, marketplace },
    loading,
    error,
    failed,
    actions: { refresh, setEnabled, install, saveSecrets, remove },
  };
}
