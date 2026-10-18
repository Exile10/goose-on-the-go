/**
 * The setup channel a claim opened, held between Find your Pond and the Wi-Fi screen. Route params
 * cannot carry it, and it holds the claim's tokens, which live only here, in memory, until the
 * pairing is committed under the Pond's new address.
 */

import type { HandshakeResponse } from './api-client';
import type { ChannelStatus, SetupChannel } from './setup-channel/session';

export interface HeldSetup {
  channel: SetupChannel;
  /** The card's id, which names the Pond until it has a host name. */
  cardId: string;
  /** The pin the exchange proved; HTTPS is pinned to it after the handover. */
  pin: string;
  tokens: HandshakeResponse;
  status: ChannelStatus | null;
}

let held: HeldSetup | null = null;

export function holdSetup(next: HeldSetup): void {
  if (held && held.channel !== next.channel) void held.channel.close();
  held = next;
}

export function heldSetup(): HeldSetup | null {
  return held;
}

/** Close the channel and forget the tokens: the pairing has been kept, or the claim abandoned. */
export function releaseSetup(): void {
  const was = held;
  held = null;
  if (!was) return;
  void was.channel.close();
  was.tokens.session_token = null;
  was.tokens.refresh_token = null;
}
