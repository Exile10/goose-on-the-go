/**
 * The household's ngrok tunnel, as the ngrok screen reads it from `GET /api/v1/remote-access/route`.
 *
 * The Pond holds the authtoken and never sends it back. What it reports is which way phones reach
 * it from outside, whether the phone asking is on the home network, and whether the tunnel's
 * address is reserved. An address that is not reserved changes every time the tunnel starts, and
 * a phone learns the new one only at home, so the switch to ngrok is offered away from home only
 * with a reserved address. See docs/NGROK_TUNNEL.md.
 */

/** Where an ngrok account is made. */
export const NGROK_SIGNUP_URL = 'https://dashboard.ngrok.com/signup';
/** The dashboard page that shows the account's authtoken. */
export const NGROK_AUTHTOKEN_URL = 'https://dashboard.ngrok.com/get-started/your-authtoken';
/** The dashboard, where a paid plan reserves a TCP address (Gateway, then TCP Addresses). */
export const NGROK_DASHBOARD_URL = 'https://dashboard.ngrok.com';

export type RemoteRoute = 'built_in' | 'ngrok';

export type TunnelStatus =
  | { state: 'off' }
  | { state: 'starting' }
  | { state: 'running'; address: string }
  | { state: 'failed'; reason: string };

export interface RouteState {
  route: RemoteRoute;
  /** The phone asked from the Pond's own network, where the authtoken and address can change. */
  atHome: boolean;
  tokenSet: boolean;
  /** The address survives a restart: a reserved TCP address or a TLS domain. */
  reserved: boolean;
  reservedAddress: string | null;
  status: TunnelStatus;
  /** A new address phones have not learned yet; the built-in network stands in meanwhile. */
  fallback: string | null;
  builtInRunning: boolean;
}

function readStatus(raw: unknown): TunnelStatus {
  if (typeof raw !== 'object' || raw === null) return { state: 'off' };
  const { state, address, reason } = raw as Record<string, unknown>;
  if (state === 'running' && typeof address === 'string') return { state, address };
  if (state === 'failed') return { state, reason: typeof reason === 'string' ? reason : '' };
  if (state === 'starting') return { state };
  return { state: 'off' };
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/**
 * The Pond's answer, or null when the body is not one. `request<T>` casts whatever it parsed, so
 * this reads it field by field rather than trusting the type.
 */
export function readRoute(raw: unknown): RouteState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.route !== 'built_in' && r.route !== 'ngrok') return null;
  return {
    route: r.route,
    atHome: r.atHome === true,
    tokenSet: r.tokenSet === true,
    reserved: r.reserved === true,
    reservedAddress: text(r.reservedAddress),
    status: readStatus(r.status),
    fallback: text(r.fallback),
    builtInRunning: r.builtInRunning === true,
  };
}

/** Why the switch to ngrok cannot be turned on now, or null when it can. */
export type NgrokBlock = 'noToken' | 'awayUnreserved';

export function ngrokBlock(state: RouteState): NgrokBlock | null {
  if (!state.tokenSet) return 'noToken';
  if (!state.atHome && !state.reserved) return 'awayUnreserved';
  return null;
}

/** `host:port`, as ngrok shows a reserved TCP address. Empty clears it. */
export function isReservedAddress(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return true;
  const match = /^([a-z0-9-]+(\.[a-z0-9-]+)+):(\d{1,5})$/i.exec(trimmed);
  if (!match) return false;
  const port = Number(match[3]);
  return port > 0 && port < 65536;
}
