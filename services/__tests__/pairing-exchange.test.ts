/**
 * One fixed CPace pairing run, reproduced byte for byte from the Pond's own
 * vectors: every intermediate value, then the same run through `PondApiClient`
 * on the wire.
 *
 * `vectors/cpace-vectors.json` is a byte-identical copy of the Pond's
 * `crates/pond-infra/tests/fixtures/cpace-vectors.json`, which a Pond test
 * regenerates and fails on any difference. If this suite and that one both pass,
 * the phone and the Pond compute the same exchange.
 */
import { bytesToNumberLE, concatBytes, hexToBytes } from '@noble/curves/utils.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { PondApiClient } from '@/services/api-client';
import {
  calculateGenerator,
  channelIdentifier,
  channelLabel,
  CI_LABEL,
  CLIENT_CONFIRM_LABEL,
  confirmationKey,
  confirmationTag,
  DSI,
  generatorString,
  intermediateSessionKey,
  lvCat,
  respond,
  scalarMult,
  scalarMultVfy,
  SERVER_CONFIRM_LABEL,
  SETUP_CI_LABEL,
} from '@/services/cpace';
import { PondTrustError } from '@/services/pond-trust';
import { randomBytes } from '@/services/secure-random';

import vectors from './vectors/cpace-vectors.json';

jest.mock('@/services/pond-trust', () => ({
  ...jest.requireActual('@/services/pond-trust'),
  assertPondTrust: jest.fn().mockResolvedValue(undefined),
}));
// The vectors fix the phone's randomness: the nonce is drawn first, then the scalar.
jest.mock('@/services/secure-random', () => ({ randomBytes: jest.fn() }));

const { inputs, outputs, labels, wire } = vectors;
const hex = bytesToHex;
const bytes = hexToBytes;
const NO_AD = new Uint8Array(0);
const negative = (name: string): Record<string, string | undefined> => {
  const found = vectors.negative.find((n) => n.name === name);
  if (!found) throw new Error(`no negative vector ${name}`);
  return found;
};
/** A field the case must have. */
const need = (value: string | undefined): string => {
  if (value === undefined) throw new Error('vector field missing');
  return value;
};

/** A source that hands out exactly `draws`, in order, as fresh copies. */
function fixed(...draws: string[]) {
  const queue = draws.map(bytes);
  return (count: number) => {
    const next = queue.shift();
    if (!next || next.length !== count) throw new Error(`unexpected draw of ${count} bytes`);
    return next.slice();
  };
}

describe('the exchange, value by value', () => {
  const sid = concatBytes(bytes(inputs.challenge), bytes(inputs.client_nonce));
  const ci = channelIdentifier(inputs.spki_pin, inputs.client_id);

  it('uses the Pond\'s labels', () => {
    expect(hex(DSI)).toBe(labels.DSI);
    expect(CI_LABEL).toBe(labels.channel);
    expect(CLIENT_CONFIRM_LABEL).toBe(labels.client_tag);
    expect(SERVER_CONFIRM_LABEL).toBe(labels.server_tag);
    expect(hex(utf8ToBytes(inputs.code))).toBe(inputs.PRS);
    expect(inputs.ADa).toBe('');
    expect(inputs.ADb).toBe('');
  });

  it('CI, sid, the generator string and g', () => {
    expect(hex(ci)).toBe(outputs.CI);
    expect(hex(sid)).toBe(outputs.sid);
    expect(hex(generatorString(DSI, bytes(inputs.PRS), ci, sid, 128))).toBe(outputs.generator_string);
    expect(hex(calculateGenerator(bytes(inputs.PRS), ci, sid).toBytes())).toBe(outputs.g);
  });

  it('both shares, K, ISK, K_mac and both tags', () => {
    const g = calculateGenerator(bytes(inputs.PRS), ci, sid);
    const ya = scalarMult(bytesToNumberLE(bytes(inputs.ya)), g);
    const yb = scalarMult(bytesToNumberLE(bytes(inputs.yb)), g);
    expect(hex(ya)).toBe(outputs.Ya);
    expect(hex(yb)).toBe(outputs.Yb);
    const k = scalarMultVfy(bytesToNumberLE(bytes(inputs.yb)), ya);
    expect(hex(k)).toBe(outputs.K);
    expect(hex(scalarMultVfy(bytesToNumberLE(bytes(inputs.ya)), yb))).toBe(outputs.K);
    const isk = intermediateSessionKey(sid, k, ya, NO_AD, yb, NO_AD);
    expect(hex(isk)).toBe(outputs.ISK);
    const macKey = confirmationKey(sid, isk);
    expect(hex(macKey)).toBe(outputs.K_mac);
    expect(hex(confirmationTag(CLIENT_CONFIRM_LABEL, macKey, ya, yb))).toBe(outputs.T_client);
    expect(hex(confirmationTag(SERVER_CONFIRM_LABEL, macKey, ya, yb))).toBe(outputs.T_server);
  });

  // The same construction under another label; the setup run below pins its bytes.
  it('opens a setup run\'s CI with the setup label, and so draws a different generator', () => {
    expect(SETUP_CI_LABEL).toBe('goose-setup-cpace-v1');
    expect(channelLabel('setup')).toBe(SETUP_CI_LABEL);
    expect(channelLabel('pairing')).toBe(CI_LABEL);
    expect(hex(channelIdentifier(inputs.spki_pin, inputs.client_id, CI_LABEL))).toBe(outputs.CI);
    const setupCi = channelIdentifier(inputs.spki_pin, inputs.client_id, SETUP_CI_LABEL);
    expect(hex(setupCi)).toBe(hex(lvCat(utf8ToBytes(SETUP_CI_LABEL), utf8ToBytes(inputs.spki_pin), utf8ToBytes(inputs.client_id))));
    const run = (credential?: 'pairing' | 'setup') => respond({
      code: inputs.code, pin: inputs.spki_pin, clientId: inputs.client_id, credential,
      challenge: bytes(inputs.challenge), clientNonce: bytes(inputs.client_nonce),
      initiatorShare: bytes(outputs.Ya), random: fixed(inputs.yb),
    });
    expect(hex(run('pairing').share)).toBe(outputs.Yb);
    expect(hex(run('setup').share)).toBe(hex(scalarMult(bytesToNumberLE(bytes(inputs.yb)), calculateGenerator(bytes(inputs.PRS), setupCi, sid))));
    expect(hex(run('setup').share)).not.toBe(outputs.Yb);
  });

  it('respond() produces the phone\'s message and expects the Pond\'s tag', () => {
    const out = respond({
      code: inputs.code, pin: inputs.spki_pin, clientId: inputs.client_id,
      challenge: bytes(inputs.challenge), clientNonce: bytes(inputs.client_nonce),
      initiatorShare: bytes(outputs.Ya), random: fixed(inputs.yb),
    });
    expect(hex(out.share)).toBe(outputs.Yb);
    expect(hex(out.confirm)).toBe(outputs.T_client);
    expect(hex(out.expectedServerConfirm)).toBe(outputs.T_server);
  });
});

describe('the setup run, value by value', () => {
  const setup = vectors.setup;
  const { inputs: s, outputs: o } = setup;
  const sid = concatBytes(bytes(s.challenge), bytes(s.client_nonce));
  const ci = channelIdentifier(s.spki_pin, s.client_id, SETUP_CI_LABEL);
  const run = (credential: 'pairing' | 'setup', code: string = s.code) => respond({
    code, pin: s.spki_pin, clientId: s.client_id, credential,
    challenge: bytes(s.challenge), clientNonce: bytes(s.client_nonce),
    initiatorShare: bytes(o.Ya), random: fixed(s.yb),
  });

  it('is the Pond\'s setup credential, under the setup label', () => {
    expect(setup.credential).toBe('setup');
    expect(SETUP_CI_LABEL).toBe(setup.labels.channel);
    expect(channelLabel('setup')).toBe(SETUP_CI_LABEL);
    expect(hex(utf8ToBytes(s.code))).toBe(s.PRS);
    expect(setup.wire.init_request.credential).toBe('setup');
  });

  it('CI, sid, g, both shares, K, ISK, K_mac and both tags', () => {
    expect(hex(ci)).toBe(o.CI);
    expect(hex(sid)).toBe(o.sid);
    expect(hex(generatorString(DSI, bytes(s.PRS), ci, sid, 128))).toBe(o.generator_string);
    const g = calculateGenerator(bytes(s.PRS), ci, sid);
    expect(hex(g.toBytes())).toBe(o.g);
    const ya = scalarMult(bytesToNumberLE(bytes(s.ya)), g);
    const yb = scalarMult(bytesToNumberLE(bytes(s.yb)), g);
    expect(hex(ya)).toBe(o.Ya);
    expect(hex(yb)).toBe(o.Yb);
    const k = scalarMultVfy(bytesToNumberLE(bytes(s.yb)), ya);
    expect(hex(k)).toBe(o.K);
    const isk = intermediateSessionKey(sid, k, ya, NO_AD, yb, NO_AD);
    expect(hex(isk)).toBe(o.ISK);
    const macKey = confirmationKey(sid, isk);
    expect(hex(macKey)).toBe(o.K_mac);
    expect(hex(confirmationTag(CLIENT_CONFIRM_LABEL, macKey, ya, yb))).toBe(o.T_client);
    expect(hex(confirmationTag(SERVER_CONFIRM_LABEL, macKey, ya, yb))).toBe(o.T_server);
  });

  it('respond() sends the Pond\'s setup verify and expects its tag', () => {
    const out = run('setup');
    expect(hex(out.share)).toBe(o.Yb);
    expect(hex(out.confirm)).toBe(o.T_client);
    expect(hex(out.confirm)).toBe(setup.wire.verify_request.confirm);
    expect(hex(out.expectedServerConfirm)).toBe(o.T_server);
  });

  it.each(['pairing_label', 'wrong_code'])('%s: the phone sends what the Pond refuses as invalid_confirmation', (name) => {
    const v = setup.negative.find((n) => n.name === name) as Record<string, string | undefined> | undefined;
    if (!v) throw new Error(`no setup negative vector ${name}`);
    expect(v.pond_result).toBe('invalid_confirmation');
    const out = name === 'pairing_label' ? run('pairing') : run('setup', need(v.phone_code));
    if (v.CI) expect(hex(channelIdentifier(s.spki_pin, s.client_id, CI_LABEL))).toBe(v.CI);
    expect(hex(out.share)).toBe(v.Yb);
    expect(hex(out.confirm)).toBe(v.T_client);
    expect(hex(out.confirm)).not.toBe(o.T_client);
  });
});

describe('the negative cases', () => {
  const base = {
    pin: inputs.spki_pin, clientId: inputs.client_id,
    challenge: bytes(inputs.challenge), clientNonce: bytes(inputs.client_nonce),
    initiatorShare: bytes(outputs.Ya),
  };

  it.each(['wrong_code', 'wrong_pin'])('%s: the phone sends what the Pond refuses as invalid_confirmation', (name) => {
    const v = negative(name);
    expect(v.pond_result).toBe('invalid_confirmation');
    const out = respond({ ...base,
      code: v.phone_code ?? inputs.code,
      pin: v.phone_spki_pin ?? inputs.spki_pin,
      random: fixed(inputs.yb) });
    if (v.CI) expect(hex(channelIdentifier(need(v.phone_spki_pin), inputs.client_id))).toBe(v.CI);
    expect(hex(out.share)).toBe(v.Yb);
    expect(hex(out.confirm)).toBe(v.T_client);
    expect(hex(out.confirm)).not.toBe(outputs.T_client);
  });

  it.each(['identity_share', 'non_canonical_share'])('%s: gives the identity, which aborts the run', (name) => {
    const v = negative(name);
    expect(v.pond_result).toBe('invalid_share');
    expect(hex(scalarMultVfy(bytesToNumberLE(bytes(inputs.ya)), bytes(need(v.Yb))))).toBe('00'.repeat(32));
    // The phone's side of the same rule: such a share from the Pond is refused before anything is sent.
    expect(() => respond({ ...base, code: inputs.code, initiatorShare: bytes(need(v.Yb)), random: fixed(inputs.yb) }))
      .toThrow('invalid_share');
  });
});

describe('the run on the wire', () => {
  const origin = 'https://192.168.1.7:4443';
  const answers: Record<string, unknown> = {
    '/api/v1/system/info': { hostname: 'nano', protocol: 3, tls_spki_sha256: inputs.spki_pin },
    '/api/v1/handshake/pake/init': { challenge_id: 'c1', expires_at: '', ...wire.init_response },
    '/api/v1/handshake/pake/verify': { session_token: 'session', refresh_token: 'refresh', hostname: 'nano',
      server_version: 'test', capabilities: [], rejection_reason: null, ...wire.verify_response },
  };
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  let warn: jest.SpyInstance;
  beforeEach(() => {
    jest.mocked(randomBytes).mockImplementation(fixed(inputs.client_nonce, inputs.yb));
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
    warn.mockRestore();
  });

  function serve(override: Record<string, Record<string, unknown>> = {}) {
    const fetch = jest.fn(async (url: string, _init?: RequestInit) => {
      const path = new URL(url).pathname;
      return new Response(JSON.stringify({ ...(answers[path] as object), ...override[path] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    Object.defineProperty(globalThis, 'fetch', { value: fetch, configurable: true, writable: true });
    return fetch;
  }
  const sent = (fetch: jest.Mock, path: string) =>
    JSON.parse(String(fetch.mock.calls.find(([url]) => new URL(String(url)).pathname === path)?.[1]?.body));

  it('sends exactly the Pond\'s requests and keeps the tokens', async () => {
    const fetch = serve();
    const client = new PondApiClient(origin);
    const rotated = jest.fn(); client.setOnTokensRotated(rotated);
    const resp = await client.pair({ clientId: inputs.client_id, pairingCode: inputs.code, channelBinding: inputs.spki_pin });
    expect(resp.accepted).toBe(true);
    expect(sent(fetch, '/api/v1/handshake/pake/init')).toEqual(wire.init_request);
    expect(sent(fetch, '/api/v1/handshake/pake/verify')).toEqual({ challenge_id: 'c1', device_name: null, ...wire.verify_request });
    expect(rotated).toHaveBeenCalledWith('session', 'refresh');
  });

  it('tampered_server_tag: refuses the acceptance and keeps no token', async () => {
    const v = negative('tampered_server_tag');
    expect(v.phone_result).toBe('invalid_server_proof');
    serve({ '/api/v1/handshake/pake/verify': { server_proof: v.T_server } });
    const client = new PondApiClient(origin);
    const rotated = jest.fn(); client.setOnTokensRotated(rotated);
    await expect(client.pair({ clientId: inputs.client_id, pairingCode: inputs.code, channelBinding: inputs.spki_pin }))
      .rejects.toBeInstanceOf(PondTrustError);
    expect(rotated).not.toHaveBeenCalled();
  });
});
