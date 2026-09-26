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

import { forgetAllCards } from '@/services/card-cache';
import { Storage, purgeLegacyStorage } from '@/services/storage';
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
  /** Per-screen mock/real backend flags (dev only) — see MIGRATION_SCREENS. */
  screenModes: ScreenModes;
  /** The screen's toggle in dev, its default in a release build — see `resolveScreenReal`. */
  isScreenReal: (screen: MigrationScreen) => boolean;
  setScreenMode: (screen: MigrationScreen, useReal: boolean) => void;
  /**
   * Whether the stored base URL and tokens have been read back yet.
   *
   * Hydration is async, so a view-model that fetches on mount would otherwise
   * race it and call the default `http://127.0.0.1:4000` with no bearer token,
   * fail, and — with nothing to re-trigger it — stay failed for the session.
   */
  hydrated: boolean;
}

/**
 * Screens whose data-fetching hook can still be switched between mock data and
 * the real PondApiClient (issue #21).
 *
 * `devices` was on this list and is not any more: #30 wired the Devices and
 * Home tabs to the Pond's real device list unconditionally, as #28 did for
 * models, profiles and recent conversations. A toggle for a screen with no
 * mock branch left would be a switch that does nothing. `voice` went the same
 * way when the unused listening overlay was deleted.
 *
 * Nothing enforces this list: each view-model has to call `isScreenReal`
 * itself, so a screen can read "Real" here while its hook still returns mock
 * data because it never asked.
 */
export const MIGRATION_SCREENS = [
  'chat',
  'memory',
  'integrations',
  'schedule',
  'logs',
] as const;

export type MigrationScreen = (typeof MIGRATION_SCREENS)[number];

export type ScreenModes = Record<MigrationScreen, boolean>;

/**
 * Which screens start on the real Pond, and so the ones a release build sends
 * there: it has no toggle to flip.
 *
 * A screen belongs here once its wiring has been run against a Pond rather
 * than against a test. `chat` earned it: `POST /api/v1/chat` is implemented,
 * and the only reason it ever needed a toggle was that it was not.
 */
const REAL_BY_DEFAULT: readonly MigrationScreen[] = ['chat'];

export const DEFAULT_SCREEN_MODES: ScreenModes = MIGRATION_SCREENS.reduce(
  (acc, screen) => ({ ...acc, [screen]: REAL_BY_DEFAULT.includes(screen) }),
  {} as ScreenModes,
);

/**
 * Whether a screen talks to the Pond or to its mock data.
 *
 * In dev it is the screen's toggle. A release build has no way to flip one —
 * the Developer screen redirects outside `__DEV__` — so there it is the
 * screen's default, and the toggles are not read at all. It is not a blanket
 * `false`: that answer left a release build's chat on the mock reply while
 * `REAL_BY_DEFAULT` said real.
 *
 * Handed `isDev` rather than reading `__DEV__`, because every test runs with
 * `__DEV__` true and could not otherwise reach the release answer.
 */
export function resolveScreenReal(
  screen: MigrationScreen,
  { isDev, screenModes, defaults }: { isDev: boolean; screenModes: ScreenModes; defaults: ScreenModes },
): boolean {
  return isDev ? screenModes[screen] : defaults[screen];
}

const ServerContext = createContext<ServerContextValue | null>(null);

export function ServerProvider({ children }: PropsWithChildren) {
  const [serverUrl, setServerUrlRaw] = useState(DEFAULT_SERVER_URL);
  const [online, setOnline] = useState(false);
  const [token, setTokenState] = useState<string | null>(null);
  const [refreshToken, setRefreshTokenState] = useState<string | null>(null);
  const [screenModes, setScreenModes] = useState<ScreenModes>(DEFAULT_SCREEN_MODES);
  const hydrationStarted = useRef(false);
  const [hydrated, setHydrated] = useState(false);

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
    if (hydrationStarted.current) return;
    hydrationStarted.current = true;
    (async () => {
      // Before reading anything, clear what an older build may have left in
      // plaintext. Upgrades are the only path onto this code, so a device that
      // once held a token in AsyncStorage still holds it until something deletes
      // it — and nothing else ever would.
      await purgeLegacyStorage().catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[storage] could not purge legacy plaintext keys:', e);
      });

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
    })()
      .catch((e) => {
        // A keychain that will not open must not strand every consumer waiting
        // on `hydrated` forever; report it and let them proceed unpaired.
        // eslint-disable-next-line no-console
        console.warn('[server] hydration failed:', e);
      })
      .finally(() => setHydrated(true));
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

  /**
   * Persisted dev toggles, read once on mount.
   *
   * `setScreenMode` awaits this same promise before writing, so a toggle
   * flipped before the read lands cannot persist a snapshot that is missing
   * every other screen's saved value.
   */
  const loadScreenModes = useRef<Promise<ScreenModes | null> | undefined>(undefined);
  useEffect(() => {
    if (!__DEV__) return;
    loadScreenModes.current = Storage.getJSON<ScreenModes>('devScreenModes');
    void loadScreenModes.current.then((saved) => {
      if (saved) setScreenModes((prev) => ({ ...prev, ...saved }));
    });
  }, []);

  /** Latest modes, readable synchronously so back-to-back toggles compose. */
  const screenModesRef = useRef(screenModes);
  useEffect(() => {
    screenModesRef.current = screenModes;
  }, [screenModes]);

  const isScreenReal = useCallback(
    (screen: MigrationScreen) =>
      resolveScreenReal(screen, { isDev: __DEV__, screenModes, defaults: DEFAULT_SCREEN_MODES }),
    [screenModes],
  );

  const setScreenMode = useCallback((screen: MigrationScreen, useReal: boolean) => {
    setScreenModes((prev) => ({ ...prev, [screen]: useReal }));
    void (async () => {
      await loadScreenModes.current;
      await Storage.setJSON('devScreenModes', {
        ...screenModesRef.current,
        [screen]: useReal,
      });
    })();
  }, []);

  const signOut = useCallback(async () => {
    await api.handshakeRevoke().catch(() => undefined);
    setTokenState(null);
    setRefreshTokenState(null);
    await SecureStorage.remove('sessionToken');
    await SecureStorage.remove('refreshToken');
    // The tool cards kept from its conversations are the household's too.
    await forgetAllCards();
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
      hydrated,
      screenModes,
      isScreenReal,
      setScreenMode,
    }),
    [
      serverUrl, online, token, refreshToken, setServerUrl, setToken, checkHealth,
      pair, signOut, hydrated, screenModes, isScreenReal, setScreenMode,
    ],
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
