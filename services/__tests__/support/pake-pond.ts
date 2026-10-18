/**
 * The Pond's half of CPace pairing, for tests: a `fetch` that answers
 * `/system/info`, `pake/init` and `pake/verify` as the Pond does, so the client
 * is exercised against a real exchange rather than canned bytes. It runs a setup
 * card's exchange too, under the setup label, when `init` names that credential.
 *
 * Built from the same primitives as the client, so on its own it proves the two
 * halves agree with each other, not with the Pond. Agreement with the Pond is
 * what `pairing-exchange.test.ts` checks, against the Pond's own vectors.
 *
 * Under `__tests__/support/`, which jest is told not to run as a suite.
 */
import { concatBytes, equalBytes } from '@noble/curves/utils.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { randomBytes } from 'node:crypto';

import {
  calculateGenerator,
  channelIdentifier,
  channelLabel,
  CLIENT_CONFIRM_LABEL,
  confirmationKey,
  confirmationTag,
  intermediateSessionKey,
  sampleScalar,
  scalarMult,
  scalarMultVfy,
  SERVER_CONFIRM_LABEL,
} from '../../cpace';
import type { HandshakeResponse } from '../../api-client';

const NO_AD = new Uint8Array(0);
const random = (n: number) => new Uint8Array(randomBytes(n));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const unb64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));

export const ACCEPTED: HandshakeResponse = {
  accepted: true,
  session_token: 'session',
  refresh_token: 'refresh',
  hostname: 'nano',
  server_version: 'test',
  capabilities: [],
  rejection_reason: null,
};

export interface PakePondOptions {
  /** The code the Pond committed to. */
  code: string;
  /** The Pond's own pin, which it always puts in CI whatever the phone claims. */
  pin: string;
  /** What `/system/info` reports. */
  protocol?: number | null;
  /** The printed card's code, for a run opened with `credential: "setup"`. */
  setupCode?: string;
  /** How `pake/init` refuses a setup run: claimed (409) or cooling (429, with its wait). */
  setupRefusal?: { status: number; error: string; retryAfter?: number };
  /** Another phone claimed the Pond between this run's init and its verify. */
  claimedDuringRun?: boolean;
  /** Rewrites the `pake/init` answer, for a Pond that sends something it should not. */
  init?: (answer: Record<string, unknown>) => Record<string, unknown>;
  /** Rewrites an accepted `pake/verify` answer, for something that invents one. */
  accept?: (answer: HandshakeResponse) => HandshakeResponse;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A `fetch` mock playing the Pond. Every request is in `.mock.calls`. */
export function pakePond(options: PakePondOptions): jest.Mock<Promise<Response>, [string, RequestInit?]> {
  let run: { ya: bigint; share: Uint8Array; sid: Uint8Array; setup: boolean } | null = null;
  return jest.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === '/api/v1/system/info') {
      return json({ hostname: 'nano', tls_spki_sha256: options.pin,
        ...(options.protocol === null ? {} : { protocol: options.protocol ?? 3 }) });
    }
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (path === '/api/v1/handshake/pake/init') {
      const credential = body.credential ?? 'pairing';
      if (credential !== 'pairing' && credential !== 'setup') return json({ error: 'invalid_credential' }, 400);
      const setup = credential === 'setup';
      const refusal = options.setupRefusal;
      if (setup && refusal) {
        return new Response(JSON.stringify({ error: refusal.error, ...(refusal.retryAfter === undefined ? {} : { retry_after: refusal.retryAfter }) }), {
          status: refusal.status,
          headers: { 'Content-Type': 'application/json', ...(refusal.retryAfter === undefined ? {} : { 'Retry-After': String(refusal.retryAfter) }) },
        });
      }
      const challenge = random(32);
      const sid = concatBytes(challenge, unb64(body.client_nonce));
      const secret = setup ? options.setupCode ?? '' : options.code;
      const g = calculateGenerator(utf8ToBytes(secret), channelIdentifier(options.pin, body.client_id, channelLabel(credential)), sid);
      const ya = sampleScalar(random);
      run = { ya, share: scalarMult(ya, g), sid, setup };
      const answer = { challenge_id: 'c1', challenge: b64(challenge), expires_at: '',
        suite: 'CPACE-RISTR255-SHA512', share: b64(run.share) };
      return json(options.init ? options.init(answer) : answer);
    }
    if (path === '/api/v1/handshake/pake/verify') {
      if (!run || body.challenge_id !== 'c1') return json({ ...ACCEPTED, accepted: false, session_token: null, rejection_reason: 'unknown_challenge' });
      const { ya, share, sid, setup } = run;
      run = null;
      const yb = unb64(body.share);
      const k = scalarMultVfy(ya, yb);
      const macKey = confirmationKey(sid, intermediateSessionKey(sid, k, share, NO_AD, yb, NO_AD));
      if (!equalBytes(hexToBytes(body.confirm), confirmationTag(CLIENT_CONFIRM_LABEL, macKey, share, yb))) {
        return json({ ...ACCEPTED, accepted: false, session_token: null, refresh_token: null, rejection_reason: 'invalid_confirmation' });
      }
      if (setup && options.claimedDuringRun) {
        return json({ ...ACCEPTED, accepted: false, session_token: null, refresh_token: null, rejection_reason: 'setup_code_unavailable' });
      }
      const answer = { ...ACCEPTED, server_proof: bytesToHex(confirmationTag(SERVER_CONFIRM_LABEL, macKey, share, yb)) };
      return json(options.accept ? options.accept(answer) : answer);
    }
    return json({});
  });
}
