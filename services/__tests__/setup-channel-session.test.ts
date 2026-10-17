/**
 * A whole setup-channel session against the fake Pond: hello, the claim, then sealed requests. What
 * matters most is what crosses the air: nothing after the exchange is readable, and an answer that
 * does not check out ends the session instead of being acted on.
 */
import { randomBytes } from 'node:crypto';

import { ApiError, PondOutdatedError } from '../api-client';
import { PondTrustError } from '../pond-trust';
import { encodeFrame } from '../setup-channel/framing';
import { SetupChannel, SetupChannelClosed } from '../setup-channel/session';
import { fakePond, POND_PIN, SETUP_CODE, type FakePondOptions } from './support/setup-channel-pond';

const random = (n: number) => new Uint8Array(randomBytes(n));
const claim = { credential: 'setup' as const, code: SETUP_CODE, clientId: 'install-1', deviceName: 'Wanjiru’s phone' };

function open(options: FakePondOptions = {}) {
  const pond = fakePond(options);
  return { pond, channel: new SetupChannel(pond.link, random) };
}

async function claimed(options: FakePondOptions = {}) {
  const { pond, channel } = open(options);
  await channel.greet();
  const tokens = await channel.exchange(claim);
  return { pond, channel, tokens };
}

describe('setup channel session', () => {
  it('learns the pin and what the Pond can do from hello, in the clear', async () => {
    const { channel, pond } = open();
    const hello = await channel.greet();
    expect(hello).toEqual({ protocol: 1, pondId: 'c1cd', claimed: false, pin: POND_PIN, capabilities: ['wifi_scan', 'wifi_join', 'spoken_code'] });
    expect(pond.wire).toEqual([{ id: 1, type: 'hello' }]);
    expect(channel.sealed).toBe(false);
  });

  it('takes no pond_id it cannot read as a card id', async () => {
    const { channel } = open({ pondId: 'C1CD' });
    expect((await channel.greet()).pondId).toBeNull();
  });

  it('refuses a Pond speaking another channel protocol', async () => {
    const { channel } = open({ protocol: 2 });
    await expect(channel.greet()).rejects.toBeInstanceOf(PondOutdatedError);
  });

  it('claims with the card, binding the pin hello gave, and opens the tokens only after the proof', async () => {
    const { pond, tokens, channel } = await claimed();
    expect(tokens).toMatchObject({ accepted: true, session_token: 'session', refresh_token: 'refresh', rejection_reason: null });
    expect(channel.sealed).toBe(true);
    const init = pond.requests.find((r) => r.type === 'pake_init');
    expect(init).toMatchObject({ credential: 'setup', channel_binding: POND_PIN, client_id: 'install-1', client_type: 'gotg' });
    const verify = pond.requests.find((r) => r.type === 'pake_verify');
    expect(verify).toMatchObject({ challenge_id: 'c1', device_name: 'Wanjiru’s phone' });
  });

  it('pairs with a spoken six-digit code under the pairing label', async () => {
    const { channel, pond } = open({ claimed: true, pairingCode: '482913' });
    await channel.greet();
    await expect(channel.spokenCode()).resolves.toEqual({ spoken: true, expires_at: '2026-10-17T12:10:00Z' });
    const tokens = await channel.exchange({ credential: 'pairing', code: '482913', clientId: 'install-1' });
    expect(tokens.accepted).toBe(true);
    expect(pond.requests.find((r) => r.type === 'pake_init')).not.toHaveProperty('credential');
  });

  it('turns a refused verify (ok: false) into the refusal HTTPS answers, and stays unsealed', async () => {
    const { channel } = open();
    await channel.greet();
    const answer = await channel.exchange({ ...claim, code: '00000000000' });
    expect(answer).toMatchObject({ accepted: false, rejection_reason: 'invalid_confirmation', session_token: null });
    expect(channel.sealed).toBe(false);
    expect(channel.isClosed).toBe(false);
  });

  it('reads a verify refusal’s reason from error when rejection_reason is missing', async () => {
    const { channel } = open({ refuse: { pake_verify: { ok: false, accepted: false, error: 'setup_code_unavailable' } } });
    await channel.greet();
    await expect(channel.exchange(claim)).resolves.toMatchObject({ accepted: false, rejection_reason: 'setup_code_unavailable' });
  });

  it('carries a verify refusal that is not a rejection, such as the attempt limit, as an error', async () => {
    const { channel } = open({ refuse: { pake_verify: { ok: false, error: 'internal_error' } } });
    await channel.greet();
    await expect(channel.exchange(claim)).rejects.toMatchObject({ detail: 'internal_error' });
  });

  it('is cut off after three runs on one connection', async () => {
    const { channel } = open();
    await channel.greet();
    for (let i = 0; i < 3; i++) expect((await channel.exchange({ ...claim, code: '00000000000' })).accepted).toBe(false);
    await expect(channel.exchange(claim)).rejects.toMatchObject({ detail: 'too_many_attempts' });
    await new Promise((r) => setTimeout(r, 30));
    expect(channel.isClosed).toBe(true);
  });

  it('fails the exchange when hello carried a pin that is not the Pond’s', async () => {
    const { channel } = open({ helloPin: `sha256/${Buffer.alloc(32, 9).toString('base64')}` });
    await channel.greet();
    const answer = await channel.exchange(claim);
    expect(answer).toMatchObject({ accepted: false, rejection_reason: 'invalid_confirmation' });
  });

  it('keeps no token when the Pond’s proof does not verify, and ends the session', async () => {
    const { channel } = open({ rewrite: (type, a) => (type === 'pake_verify' ? { ...a, server_proof: '00'.repeat(64) } : a) });
    await channel.greet();
    await expect(channel.exchange(claim)).rejects.toBeInstanceOf(PondTrustError);
    expect(channel.isClosed).toBe(true);
    await expect(channel.status()).rejects.toBeInstanceOf(Error);
  });

  it('ends the session when the sealed tokens do not open', async () => {
    const { channel } = open({ rewrite: (type, a) => (type === 'pake_verify' ? { ...a, sealed: Buffer.alloc(40).toString('base64') } : a) });
    await channel.greet();
    await expect(channel.exchange(claim)).rejects.toThrow();
    expect(channel.isClosed).toBe(true);
  });

  it('carries a setup refusal and its wait as the HTTPS codes', async () => {
    const { channel } = open({ refuse: { pake_init: { ok: false, error: 'setup_code_cooling', retry_after: 30 } } });
    await channel.greet();
    const error = await channel.exchange(claim).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ detail: 'setup_code_cooling', retryAfterSecs: 30, status: 429 });
    expect(channel.isClosed).toBe(false);
  });

  it('seals every request after the exchange, so the passphrase never crosses the air readable', async () => {
    const { channel, pond } = await claimed();
    const status = await channel.status();
    expect(status).toEqual({ claimed: true, onboarded: false, network: { state: 'disconnected', ssid: null, ipv4: null }, httpsPort: 4443, hostname: 'nano' });
    const networks = await channel.wifiScan();
    expect(networks.map((n) => n.ssid)).toEqual(['Home', 'Cafe']);
    const joined = await channel.wifiJoin({ ssid: 'Home', passphrase: 'correct horse battery' });
    expect(joined).toEqual({ address: '192.168.1.40', httpsPort: 4443, hostname: 'nano' });

    const afterExchange = pond.wire.slice(pond.wire.findIndex((m) => m.type === 'pake_verify') + 1);
    expect(afterExchange).toHaveLength(3);
    for (const frame of afterExchange) expect(Object.keys(frame)).toEqual(['sealed']);
    expect(JSON.stringify(pond.wire)).not.toContain('correct horse');
    expect(pond.requests.at(-1)).toMatchObject({ type: 'wifi_join', ssid: 'Home', passphrase: 'correct horse battery' });
  });

  it('sends no passphrase for an open network', async () => {
    const { channel, pond } = await claimed();
    await channel.wifiJoin({ ssid: 'Cafe' });
    expect(pond.requests.at(-1)).not.toHaveProperty('passphrase');
  });

  it('reports each wifi_join refusal by its code', async () => {
    for (const code of ['wrong_password', 'not_found', 'no_address', 'timeout', 'not_permitted', 'unsupported', 'busy']) {
      const { channel } = await claimed({ join: () => ({ ok: false, error: code }) });
      await expect(channel.wifiJoin({ ssid: 'Home', passphrase: 'x' })).rejects.toMatchObject({ detail: code });
      expect(channel.isClosed).toBe(false);
    }
  });

  it('refuses sealed requests before the exchange has run', async () => {
    const { channel, pond } = open();
    await channel.greet();
    await expect(channel.status()).rejects.toThrow('needs the exchange first');
    expect(pond.wire).toHaveLength(1);
  });

  it('never writes more than the link takes, and reads notifications cut small', async () => {
    const { channel, pond } = await claimed({ writeSize: 20, notifySize: 20 });
    await channel.wifiScan();
    expect(Math.max(...pond.writes)).toBeLessThanOrEqual(20);
  });

  it('sends one request at a time, in order, even when asked for several at once', async () => {
    const { channel, pond } = await claimed();
    const before = pond.requests.length;
    await Promise.all([channel.status(), channel.wifiScan(), channel.status()]);
    expect(pond.requests.slice(before).map((r) => r.type)).toEqual(['status', 'wifi_scan', 'status']);
  });

  it('ends the session on a replayed sealed answer', async () => {
    const { channel, pond } = await claimed();
    await channel.status();
    const replay = pond.lastSealed();
    const pending = channel.status();
    pond.notify(encodeFrame(replay as object));
    await expect(pending).rejects.toBeInstanceOf(SetupChannelClosed);
    expect(pond.closed()).toBe(true);
  });

  it('ends the session on an answer to no question', async () => {
    const { channel, pond } = open();
    await channel.greet();
    pond.notify(encodeFrame({ id: 99, type: 'hello', ok: true }));
    await new Promise((r) => setTimeout(r, 5));
    expect(channel.isClosed).toBe(true);
  });

  it('fails what is in flight when the link drops, and every request after', async () => {
    const { channel, pond } = await claimed({ silent: ['wifi_join'] });
    const join = channel.wifiJoin({ ssid: 'Home', passphrase: 'x' });
    await new Promise((r) => setTimeout(r, 5));
    pond.drop();
    await expect(join).rejects.toBeInstanceOf(SetupChannelClosed);
    await expect(channel.status()).rejects.toBeInstanceOf(SetupChannelClosed);
  });

  it('takes a write the Pond refuses (ATT 0x03, no session) as the session over, and lets go of the link', async () => {
    const { channel, pond } = await claimed();
    pond.forget();
    await expect(channel.status()).rejects.toBeInstanceOf(SetupChannelClosed);
    expect(channel.isClosed).toBe(true);
    expect(pond.closed()).toBe(true);
    await expect(channel.wifiScan()).rejects.toBeInstanceOf(SetupChannelClosed);
  });

  it('gives up on a Pond that never answers, and closes the link rather than read a late answer', async () => {
    jest.useFakeTimers();
    try {
      const { channel, pond } = open({ silent: ['hello'] });
      const hello = channel.greet();
      const failed = expect(hello).rejects.toBeInstanceOf(SetupChannelClosed);
      await jest.advanceTimersByTimeAsync(15_001);
      await failed;
      expect(pond.closed()).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
