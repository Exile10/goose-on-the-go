/**
 * Insecure development mode, and that nothing but `__DEV__` together with
 * `EXPO_PUBLIC_POND_INSECURE_DEV=1` turns any of it on.
 *
 * The flag is read once, at import, so each case loads a fresh module graph under the
 * `__DEV__` and environment it describes. The rest of the suite runs with the variable
 * unset, which is why the HTTPS tests beside this one needed no change.
 *
 * No PondTls native module is installed here, which is what Expo Go looks like.
 */
import type * as DevMode from '../dev-mode';
import type * as Connection from '@/models/connection';
import type * as Trust from '../pond-trust';
import type * as Api from '../api-client';
import type * as Remote from '../remote-access';
import { pakePond } from './support/pake-pond';

const PLAIN = 'http://192.168.1.10:4080';
const PIN = `sha256/${'A'.repeat(43)}=`;

interface Loaded {
  insecureDevMode: boolean;
  connection: typeof Connection;
  trust: typeof Trust;
  api: typeof Api;
  remote: typeof Remote;
}

const globals = globalThis as unknown as { __DEV__: boolean };

function setFlag(value: string | undefined) {
  if (value === undefined) delete process.env.EXPO_PUBLIC_POND_INSECURE_DEV;
  else process.env.EXPO_PUBLIC_POND_INSECURE_DEV = value;
}

/** A fresh module graph under the given `__DEV__` and flag value. */
function load(dev: boolean, flag: string | undefined): Loaded {
  const previousDev = globals.__DEV__;
  const previousFlag = process.env.EXPO_PUBLIC_POND_INSECURE_DEV;
  globals.__DEV__ = dev;
  setFlag(flag);
  try {
    let loaded!: Loaded;
    jest.isolateModules(() => {
      loaded = {
        insecureDevMode: jest.requireActual<typeof DevMode>('../dev-mode').insecureDevMode,
        connection: jest.requireActual('@/models/connection'),
        trust: jest.requireActual('../pond-trust'),
        api: jest.requireActual('../api-client'),
        remote: jest.requireActual('../remote-access'),
      };
    });
    return loaded;
  } finally {
    globals.__DEV__ = previousDev;
    setFlag(previousFlag);
  }
}

const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
function setFetch(fn: jest.Mock) {
  Object.defineProperty(globalThis, 'fetch', { value: fn, configurable: true, writable: true });
}
afterEach(() => {
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
});

let warn: jest.SpyInstance;
beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => warn.mockRestore());

/** A Pond whose acceptance carries no confirmation, which a phone must refuse. */
const unconfirmed = () => pakePond({ code: '123456', pin: PIN, accept: (answer) => ({ ...answer, server_proof: null }) });

describe('the switch', () => {
  it('needs both a development bundle and the variable set to exactly 1', () => {
    expect(load(true, '1').insecureDevMode).toBe(true);
    expect(load(false, '1').insecureDevMode).toBe(false);
    expect(load(true, undefined).insecureDevMode).toBe(false);
    for (const value of ['', '0', 'true', 'yes']) expect(load(true, value).insecureDevMode).toBe(false);
  });

  it('says so in the log when it is on', () => {
    load(true, '1');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('insecure development mode'));
  });
});

describe.each([
  ['a release bundle with the variable set', false, '1'],
  ['a development bundle without it', true, undefined],
])('every relaxation is off in %s', (_name, dev, flag) => {
  it('accepts no plaintext origin anywhere', () => {
    const { connection, api } = load(dev, flag);
    expect(() => connection.normalizePondUrl(PLAIN)).toThrow();
    expect(connection.isInsecureDevOrigin(PLAIN)).toBe(false);
    expect(connection.isLocalPairingUrl(PLAIN)).toBe(false);
    expect(connection.parseConnectionProfile({ version: 2, host: '192.168.1.10', port: 4080, localUrls: [PLAIN] })).toBeNull();
    expect(() => new api.PondApiClient(PLAIN)).toThrow();
  });

  it('keeps trust and the pin requirement as they were', async () => {
    const { trust } = load(dev, flag);
    await expect(trust.assertPondTrust(PLAIN)).rejects.toThrow();
    await expect(Promise.resolve().then(() => trust.configurePondTrust([{ url: PLAIN, pin: PIN }]))).rejects.toThrow();
  });

  it('still binds pairing to the pin and demands the confirmation', async () => {
    const { api, trust } = load(dev, flag);
    jest.spyOn(trust, 'assertPondTrust').mockResolvedValue(undefined);
    const fetch = unconfirmed(); setFetch(fetch);
    const client = new api.PondApiClient('https://192.168.1.10:4443');
    await expect(client.pair({ clientId: 'phone', pairingCode: '123456', channelBinding: PIN }))
      .rejects.toMatchObject({ name: 'PondTrustError' });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)).channel_binding).toBe(PIN);
    for (const [, init] of fetch.mock.calls) expect(new Headers(init?.headers).get('X-Pond-Transport')).toBe('1');
  });
});

describe('in insecure development mode', () => {
  it('accepts a plaintext origin only on a LAN address, with nothing after the port', () => {
    const { connection } = load(true, '1');
    expect(connection.normalizePondUrl(`${PLAIN}/`)).toBe(PLAIN);
    expect(connection.normalizePondUrl('http://pond.local:4080')).toBe('http://pond.local:4080');
    expect(connection.isLocalPairingUrl(PLAIN)).toBe(true);
    for (const bad of ['http://8.8.8.8:4080', 'http://100.64.0.2:4080', 'http://user@192.168.1.10:4080', `${PLAIN}/api`, `${PLAIN}?x=1`]) {
      expect(() => connection.normalizePondUrl(bad)).toThrow();
      expect(connection.isInsecureDevOrigin(bad)).toBe(false);
    }
    // HTTPS is what it always was.
    expect(connection.normalizePondUrl('https://pond.local:4443')).toBe('https://pond.local:4443');
    expect(() => connection.normalizePondUrl('ftp://pond.local')).toThrow();
  });

  it('keeps remote addresses HTTPS in a saved profile', () => {
    const { connection } = load(true, '1');
    const local = { version: 2, host: '192.168.1.10', port: 4080, localUrls: [PLAIN] };
    expect(connection.parseConnectionProfile(local)?.localUrls).toEqual([PLAIN]);
    expect(connection.parseConnectionProfile({ ...local, remoteUrl: 'http://100.64.0.2:4080',
      remoteAccess: { mode: 'embedded', controlUrl: 'https://control.example' } })).toBeNull();
  });

  it('pins nothing for a plaintext origin and lets requests to it through', async () => {
    const { trust } = load(true, '1');
    await expect(trust.configurePondTrust([{ url: PLAIN, pin: PIN }])).resolves.toBeUndefined();
    await expect(trust.assertPondTrust(PLAIN)).resolves.toBeUndefined();
    await expect(trust.pondTrustFailed(PLAIN)).resolves.toBe(false);
  });

  it('still refuses an HTTPS Pond it cannot pin', async () => {
    const { trust } = load(true, '1');
    await expect(trust.configurePondTrust([{ url: PLAIN, pin: PIN }, { url: 'https://pond.local:4443', pin: PIN }]))
      .rejects.toThrow();
    await expect(trust.assertPondTrust('https://pond.local:4443')).rejects.toThrow();
  });

  // CPace over plaintext too. The pin is the one the Pond reported for itself, so it binds
  // nothing, but the code still never crosses the wire in a form that can be tested offline,
  // and the Pond's confirmation is still demanded.
  it('pairs over plaintext with CPace, without the transport marker', async () => {
    const { api } = load(true, '1');
    const fetch = pakePond({ code: '123456', pin: PIN }); setFetch(fetch);
    const client = new api.PondApiClient(PLAIN);
    const resp = await client.pair({ clientId: 'phone', pairingCode: '123456', channelBinding: PIN });
    expect(resp.accepted).toBe(true);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${PLAIN}/api/v1/system/info`, `${PLAIN}/api/v1/handshake/pake/init`, `${PLAIN}/api/v1/handshake/pake/verify`,
    ]);
    for (const [, init] of fetch.mock.calls) expect(new Headers(init?.headers).get('X-Pond-Transport')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('plaintext development connection'));
  });

  it('still demands the confirmation over plaintext', async () => {
    const { api } = load(true, '1');
    setFetch(unconfirmed());
    const client = new api.PondApiClient(PLAIN);
    await expect(client.pair({ clientId: 'phone', pairingCode: '123456', channelBinding: PIN }))
      .rejects.toMatchObject({ name: 'PondTrustError' });
  });

  it('still binds and demands the confirmation from an HTTPS Pond', async () => {
    const { api, trust } = load(true, '1');
    jest.spyOn(trust, 'assertPondTrust').mockResolvedValue(undefined);
    const fetch = unconfirmed(); setFetch(fetch);
    const client = new api.PondApiClient('https://192.168.1.10:4443');
    await expect(client.pair({ clientId: 'phone', pairingCode: '123456', channelBinding: PIN }))
      .rejects.toMatchObject({ name: 'PondTrustError' });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)).channel_binding).toBe(PIN);
  });

  it('leaves remote access unavailable', async () => {
    const { remote } = load(true, '1');
    const commit = jest.fn();
    await expect(remote.enableRemoteAccess('profile', PLAIN, () => undefined, commit))
      .rejects.toThrow('Remote access requires the latest native Goose app.');
    expect(commit).not.toHaveBeenCalled();
  });
});
