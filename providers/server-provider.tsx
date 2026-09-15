/**
 * ServerProvider — server connection state for the GIAP companion link.
 *
 * Holds `serverUrl`, `online`, `token`, `refreshToken`, plus a `pair()`
 * method that runs the two-phase handshake with the user-supplied 6-digit
 * pairing code shown on the server's CLI / dashboard.
 *
 * On mount:
 *   - server URL is loaded from AsyncStorage (`@goose/server-url`)
 *   - tokens are loaded from SecureStorage (Keychain / EncryptedSharedPrefs)
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import { Storage } from '@/services/storage';
import { SecureStorage } from '@/services/secure-storage';
import { api, type HandshakeResponse } from '@/services/api-client';

const DEFAULT_SERVER_URL = 'http://127.0.0.1:4000';

interface PairOptions {
  clientId: string;
  pairingCode: string;
  deviceName?: string;
}

interface ServerContextValue {
  serverUrl: string;
  online: boolean;
  token: string | null;
  refreshToken: string | null;
  setServerUrl: (url: string) => void;
  setToken: (token: string | null) => void;
  /**
   * Probe `/health` and update `online` from the answer.
   *
   * `online` has no manual setter on purpose: it should say whether the Pond
   * actually answered, not whether something once believed it would.
   */
  checkHealth: () => Promise<boolean>;
  /** Execute the GIAP two-phase handshake. Returns the server response. */
  pair: (opts: PairOptions) => Promise<HandshakeResponse>;
  /** Revoke the current session token (server-side + local). */
  signOut: () => Promise<void>;
}

const ServerContext = createContext<ServerContextValue | null>(null);

export function ServerProvider({ children }: PropsWithChildren) {
  const [serverUrl, setServerUrlRaw] = useState(DEFAULT_SERVER_URL);
  const [online, setOnline] = useState(false);
  const [token, setTokenState] = useState<string | null>(null);
  const [refreshToken, setRefreshTokenState] = useState<string | null>(null);
  const hydrated = useRef(false);

  /**
   * Guards against an older probe landing after a newer one. Changing the server
   * URL starts a second check while the first is still in flight, and without a
   * sequence number the slower answer — about the previous address — wins.
   */
  const healthSeq = useRef(0);

  const checkHealth = useCallback(async () => {
    const seq = ++healthSeq.current;
    const { ok } = await api.health();
    if (seq === healthSeq.current) setOnline(ok);
    return ok;
  }, []);


  // Hydrate from persistent storage on first mount.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    (async () => {
      const [storedUrl, storedToken, storedRefresh] = await Promise.all([
        Storage.get('serverUrl'),
        SecureStorage.get('sessionToken'),
        SecureStorage.get('refreshToken'),
      ]);
      if (storedUrl) {
        setServerUrlRaw(storedUrl);
        api.setBaseUrl(storedUrl);
      }
      if (storedToken) {
        setTokenState(storedToken);
        api.setToken(storedToken);
      }
      if (storedRefresh) {
        setRefreshTokenState(storedRefresh);
        api.setRefreshToken(storedRefresh);
      }
      // Only worth probing once there is an address to probe.
      if (storedUrl) void checkHealth();
    })();
  }, [checkHealth]);

  // Persist token rotations triggered inside the api client (refresh flow).
  useEffect(() => {
    api.setOnTokensRotated((session, refresh) => {
      setTokenState(session);
      setRefreshTokenState(refresh);
      void SecureStorage.set('sessionToken', session);
      void SecureStorage.set('refreshToken', refresh);
    });
    return () => api.setOnTokensRotated(null);
  }, []);

  const setServerUrl = useCallback(
    (url: string) => {
      const trimmed = url.replace(/\/+$/, '');
      setServerUrlRaw(trimmed);
      api.setBaseUrl(trimmed);
      void Storage.set('serverUrl', trimmed);
      void checkHealth();
    },
    [checkHealth],
  );

  const setToken = useCallback((next: string | null) => {
    setTokenState(next);
    api.setToken(next);
    if (next) void SecureStorage.set('sessionToken', next);
    else void SecureStorage.remove('sessionToken');
  }, []);

  const pair = useCallback(
    async ({ clientId, pairingCode, deviceName }: PairOptions) => {
      const resp = await api.pair({ clientId, pairingCode, deviceName });
      if (resp.accepted && resp.session_token) {
        setTokenState(resp.session_token);
        await SecureStorage.set('sessionToken', resp.session_token);
        if (resp.refresh_token) {
          setRefreshTokenState(resp.refresh_token);
          await SecureStorage.set('refreshToken', resp.refresh_token);
        }
        setOnline(true);
      }
      return resp;
    },
    [],
  );

  const signOut = useCallback(async () => {
    await api.handshakeRevoke().catch(() => undefined);
    setTokenState(null);
    setRefreshTokenState(null);
    await SecureStorage.remove('sessionToken');
    await SecureStorage.remove('refreshToken');
    setOnline(false);
  }, []);

  const value = useMemo<ServerContextValue>(
    () => ({
      serverUrl,
      online,
      token,
      refreshToken,
      setServerUrl,
      setToken,
      checkHealth,
      pair,
      signOut,
    }),
    [serverUrl, online, token, refreshToken, setServerUrl, setToken, checkHealth, pair, signOut],
  );

  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

/**
 * Access server connection state.
 * Must be called within a `<ServerProvider>`.
 */
export function useServer(): ServerContextValue {
  const ctx = useContext(ServerContext);
  if (!ctx) {
    throw new Error('useServer must be used within a <ServerProvider>');
  }
  return ctx;
}
