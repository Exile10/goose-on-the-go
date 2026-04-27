/**
 * ServerProvider — stores server connection state for the desktop companion link.
 *
 * Provides `serverUrl`, `online`, and `token` along with their setters.
 * No actual network calls — that responsibility belongs to a future service layer.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

const DEFAULT_SERVER_URL = 'http://127.0.0.1:4000';

interface ServerContextValue {
  /** Base URL of the companion server */
  serverUrl: string;
  /** Whether the server is currently reachable */
  online: boolean;
  /** Auth token for server communication (null = unauthenticated) */
  token: string | null;
  setServerUrl: (url: string) => void;
  setToken: (token: string | null) => void;
  /** Manually toggle online state (will be driven by health-check later) */
  setOnline: (online: boolean) => void;
}

const ServerContext = createContext<ServerContextValue | null>(null);

export function ServerProvider({ children }: PropsWithChildren) {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [online, setOnline] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const handleSetServerUrl = useCallback((url: string) => {
    setServerUrl(url.replace(/\/+$/, '')); // strip trailing slashes
  }, []);

  const value = useMemo<ServerContextValue>(
    () => ({
      serverUrl,
      online,
      token,
      setServerUrl: handleSetServerUrl,
      setToken,
      setOnline,
    }),
    [serverUrl, online, token, handleSetServerUrl],
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
