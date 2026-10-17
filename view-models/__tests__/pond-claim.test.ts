import { randomBytes } from 'node:crypto';

import { BleUnreachableError, WrongPondError } from '@/services/ble';
import type { HeldSetup } from '@/services/setup-session';
import { fakePond, POND_PIN, SETUP_CODE } from '@/services/__tests__/support/setup-channel-pond';
import type { NearbyPond } from '@/models/nearby-pond';
import { bleClaim, networkClaim, prefersNetwork } from '../pond-claim';

const random = (n: number) => new Uint8Array(randomBytes(n));
const nearby = (over: Partial<NearbyPond> = {}): NearbyPond => ({
  id: 'c1cd', peripheral: 'AA:BB', rssi: -50, url: null, pin: null, hostname: null, seenAt: 0, ...over,
});
const input = { credential: 'setup' as const, code: SETUP_CODE, clientId: 'install-1', deviceName: 'Pixel' };

describe('claiming over Bluetooth', () => {
  it('connects once, claims, and hands the open channel on with its pin and status', async () => {
    const pond = fakePond({ network: { state: 'connected', ssid: 'Home', ipv4: '192.168.1.40' } });
    const connect = jest.fn().mockResolvedValue(pond.link);
    const hold = jest.fn<void, [HeldSetup]>();
    const claim = bleClaim(nearby(), { connect, hold }, random);
    const resp = await claim.claim(input);
    expect(resp.accepted).toBe(true);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith('AA:BB');
    const held = hold.mock.calls[0][0];
    expect(held).toMatchObject({ cardId: 'c1cd', pin: POND_PIN, tokens: { session_token: 'session' } });
    expect(held.status?.network).toEqual({ state: 'connected', ssid: 'Home', ipv4: '192.168.1.40' });
    // Closing the driver after a claim leaves the channel to the Wi-Fi step.
    claim.close();
    expect(held.channel.isClosed).toBe(false);
  });

  it('keeps one session across a wrong code and the retry', async () => {
    const pond = fakePond();
    const connect = jest.fn().mockResolvedValue(pond.link);
    const claim = bleClaim(nearby(), { connect, hold: jest.fn() }, random);
    expect((await claim.claim({ ...input, code: '00000000000' })).accepted).toBe(false);
    expect((await claim.claim(input)).accepted).toBe(true);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('has the Pond say a code, then pairs with it', async () => {
    const pond = fakePond({ pairingCode: '482913' });
    const claim = bleClaim(nearby(), { connect: jest.fn().mockResolvedValue(pond.link), hold: jest.fn() }, random);
    await expect(claim.canSpeak()).resolves.toBe(true);
    await claim.speak();
    expect((await claim.claim({ ...input, credential: 'pairing', code: '482913' })).accepted).toBe(true);
    expect(pond.requests.map((r) => r.type)).toEqual(['hello', 'spoken_code', 'pake_init', 'pake_verify', 'status']);
  });

  it('says whether a Pond is already someone’s, from hello, before any code is asked for', async () => {
    const fresh = bleClaim(nearby(), { connect: jest.fn().mockResolvedValue(fakePond().link), hold: jest.fn() }, random);
    await expect(fresh.greet()).resolves.toEqual({ claimed: false });
    const owned = bleClaim(nearby(), { connect: jest.fn().mockResolvedValue(fakePond({ claimed: true }).link), hold: jest.fn() }, random);
    await expect(owned.greet()).resolves.toEqual({ claimed: true });
  });

  it('re-provisions someone’s Pond with a spoken code, holding its channel for Wi-Fi', async () => {
    const pond = fakePond({ claimed: true, pairingCode: '482913' });
    const hold = jest.fn<void, [HeldSetup]>();
    const claim = bleClaim(nearby(), { connect: jest.fn().mockResolvedValue(pond.link), hold }, random);
    await claim.greet();
    await claim.speak();
    expect((await claim.claim({ ...input, credential: 'pairing', code: '482913' })).accepted).toBe(true);
    expect(hold).toHaveBeenCalledTimes(1);
  });

  it('stops when hello’s pond_id is not the card id the name advertised', async () => {
    const pond = fakePond({ pondId: 'beef' });
    const claim = bleClaim(nearby(), { connect: jest.fn().mockResolvedValue(pond.link), hold: jest.fn() }, random);
    await expect(claim.claim(input)).rejects.toBeInstanceOf(WrongPondError);
    expect(pond.requests.map((r) => r.type)).toEqual(['hello']);
    expect(pond.closed()).toBe(true);
  });

  it('names a Pond it cannot reach as out of Bluetooth range', async () => {
    const claim = bleClaim(nearby(), { connect: jest.fn().mockRejectedValue(new Error('timeout')), hold: jest.fn() }, random);
    await expect(claim.claim(input)).rejects.toBeInstanceOf(BleUnreachableError);
    const unheard = bleClaim(nearby({ peripheral: null }), { connect: jest.fn(), hold: jest.fn() }, random);
    await expect(unheard.claim(input)).rejects.toBeInstanceOf(BleUnreachableError);
  });
});

describe('claiming over the network', () => {
  const deps = () => ({
    stage: jest.fn().mockResolvedValue(undefined),
    pair: jest.fn().mockResolvedValue({ accepted: true, session_token: 's', hostname: '', server_version: '', capabilities: [], rejection_reason: null }),
    requestSpokenCode: jest.fn().mockResolvedValue({ spoken: true }),
    cancel: jest.fn().mockResolvedValue(undefined),
  });
  const onNetwork = nearby({ peripheral: null, url: 'https://192.168.1.9:4443', pin: POND_PIN });

  it('stages the advertised address and pin once, then runs the setup exchange', async () => {
    const d = deps();
    const claim = networkClaim(onNetwork, d);
    await claim.claim(input);
    expect(d.stage).toHaveBeenCalledWith({ version: 2, host: '192.168.1.9', port: 4443, localUrls: ['https://192.168.1.9:4443'] }, POND_PIN);
    expect(d.pair).toHaveBeenCalledWith({ clientId: 'install-1', pairingCode: SETUP_CODE, credential: 'setup', deviceName: 'Pixel' });
    claim.close();
    expect(d.cancel).not.toHaveBeenCalled();
  });

  it('cancels a staging it leaves unfinished', async () => {
    const d = deps();
    const claim = networkClaim(onNetwork, d);
    await claim.speak();
    claim.close();
    expect(d.cancel).toHaveBeenCalledTimes(1);
  });

  it('has nothing to greet over the network, where setup=1 already said', async () => {
    await expect(networkClaim(onNetwork, deps()).greet()).resolves.toBeNull();
  });

  it('prefers the network for a Pond heard both ways', () => {
    expect(prefersNetwork(onNetwork)).toBe(true);
    expect(prefersNetwork({ ...onNetwork, peripheral: 'AA:BB' })).toBe(true);
    expect(prefersNetwork(nearby())).toBe(false);
  });
});
