/**
 * The ngrok screen: set the household's authtoken, reserve an address, and switch between the
 * built-in network and ngrok. The Pond decides what is allowed; this hook says it in words.
 *
 * The authtoken exists on the phone only as what has been typed, until the Pond has it. The state
 * is re-read while the tunnel starts, and every half minute otherwise, since the Pond can fall
 * back to the built-in network on its own when an unreserved address changes.
 */

import * as WebBrowser from 'expo-web-browser';
import { useCallback, useRef, useState } from 'react';

import { isReservedAddress, type RemoteRoute, type RouteState } from '@/models/ngrok-tunnel';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import { describeApiError, failureKind } from './describe-error';
import { useLive, MIN_POLL_MS } from './use-live';

const POLL_MS = 30_000;

/** What a write changed, for its log line. */
type WriteKind = 'authtoken' | 'authtoken_removal' | 'reserved_address' | 'route';
/** While the tunnel starts: the floor every poll keeps. */
const STARTING_POLL_MS = MIN_POLL_MS;

/** The `code` a Pond refusal on these routes carries. */
function refusalCode(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  const code = (e.body as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/** A refusal in words, one literal key per code so the key-completeness test sees them. */
export function refusalText(e: unknown): string | null {
  switch (refusalCode(e)) {
    case 'authtoken_refused':
    case 'invalid_authtoken':
      return i18n.t('ngrok.error.tokenRefused');
    case 'at_home_only':
      return i18n.t('ngrok.error.atHomeOnly');
    case 'needs_reserved_address':
      return i18n.t('ngrok.error.needsReserved');
    case 'no_authtoken':
      return i18n.t('ngrok.error.noToken');
    case 'invalid_config':
      return i18n.t('ngrok.error.badAddress');
    case 'built_in_unavailable':
      return i18n.t('ngrok.error.builtInUnavailable');
    default:
      return describeApiError(e);
  }
}

export interface UseNgrokTunnel {
  state: RouteState | null;
  loading: boolean;
  /** The first read failed, in words; null when the connection banner already says it. */
  error: string | null;
  failed: boolean;
  /** The Pond answered 404: it predates choosing the route from a phone. */
  unsupported: boolean;
  tokenDraft: string;
  addressDraft: string;
  tokenError: string | null;
  addressError: string | null;
  switchError: string | null;
  savingToken: boolean;
  removingToken: boolean;
  savingAddress: boolean;
  switching: boolean;
  actions: {
    refresh: () => Promise<void>;
    setTokenDraft: (text: string) => void;
    setAddressDraft: (text: string) => void;
    saveToken: () => Promise<boolean>;
    removeToken: () => Promise<boolean>;
    saveAddress: () => Promise<boolean>;
    choose: (route: RemoteRoute) => Promise<boolean>;
    open: (url: string) => void;
  };
}

export function useNgrokTunnel(): UseNgrokTunnel {
  const [state, setState] = useState<RouteState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [tokenDraft, setTokenDraftText] = useState('');
  const [addressDraft, setAddressDraftText] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [savingToken, setSavingToken] = useState(false);
  const [removingToken, setRemovingToken] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [switching, setSwitching] = useState(false);
  const known = useRef(false);
  // A read that started before a change must not undo it when it lands.
  const writes = useRef(0);

  const load = useCallback(async (loud: boolean) => {
    if (loud) setLoading(true);
    const startedAt = writes.current;
    try {
      const next = await api.remoteRoute();
      if (startedAt !== writes.current) return;
      setState(next);
      known.current = true;
      setError(null);
      setFailed(false);
      setUnsupported(false);
    } catch (e) {
      if (startedAt !== writes.current) return;
      if (e instanceof ApiError && e.status === 404) {
        setUnsupported(true);
        return;
      }
      console.warn('[ngrok] could not read the remote access route', failureKind(e));
      if (loud || !known.current) setError(describeApiError(e));
      if (!known.current) setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const starting = state?.route === 'ngrok' && state.status.state === 'starting';
  useLive(() => load(false), () => (starting ? STARTING_POLL_MS : POLL_MS));

  const write = useCallback(async (
    run: () => Promise<RouteState>,
    setBusy: (busy: boolean) => void,
    setFieldError: (text: string | null) => void,
    what: WriteKind,
  ): Promise<boolean> => {
    writes.current += 1;
    setBusy(true);
    setFieldError(null);
    try {
      setState(await run());
      known.current = true;
      console.info(`[ngrok] ${what} saved`);
      return true;
    } catch (e) {
      console.warn(`[ngrok] ${what} refused`, failureKind(e), refusalCode(e));
      setFieldError(refusalText(e) ?? i18n.t('errors.generic'));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const saveToken = useCallback(async () => {
    const token = tokenDraft.trim();
    if (!token) return false;
    const saved = await write(() => api.setNgrokAuthtoken(token), setSavingToken, setTokenError, 'authtoken');
    if (saved) setTokenDraftText('');
    return saved;
  }, [tokenDraft, write]);

  const removeToken = useCallback(
    () => write(() => api.forgetNgrokAuthtoken(), setRemovingToken, setTokenError, 'authtoken_removal'),
    [write],
  );

  const saveAddress = useCallback(async () => {
    const address = (addressDraft ?? '').trim();
    if (!isReservedAddress(address)) {
      setAddressError(i18n.t('ngrok.error.badAddress'));
      return false;
    }
    const route = state?.route ?? 'built_in';
    const saved = await write(() => api.chooseRemoteRoute(route, address), setSavingAddress, setAddressError, 'reserved_address');
    if (saved) setAddressDraftText(null);
    return saved;
  }, [addressDraft, state?.route, write]);

  const choose = useCallback(
    (route: RemoteRoute) => write(() => api.chooseRemoteRoute(route), setSwitching, setSwitchError, 'route'),
    [write],
  );

  const open = useCallback((url: string) => {
    void WebBrowser.openBrowserAsync(url).catch((e: unknown) => console.warn('[ngrok] could not open the browser', e));
  }, []);

  return {
    state,
    loading,
    error,
    failed,
    unsupported,
    tokenDraft,
    addressDraft: addressDraft ?? state?.reservedAddress ?? '',
    tokenError,
    addressError,
    switchError,
    savingToken,
    removingToken,
    savingAddress,
    switching,
    actions: {
      refresh: () => load(true),
      setTokenDraft: (text) => {
        setTokenDraftText(text);
        setTokenError(null);
      },
      setAddressDraft: (text) => {
        setAddressDraftText(text);
        setAddressError(null);
      },
      saveToken,
      removeToken,
      saveAddress,
      choose,
      open,
    },
  };
}
