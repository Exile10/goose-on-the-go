/**
 * Tests for mDNS discovery.
 *
 * The fixtures are real: they are what `dns-sd -B _pond._tcp local.` and a
 * follow-up resolve returned on the development LAN, including the ghost
 * advertisements left behind by restarted servers.
 */

import type { Service } from 'react-native-zeroconf';

const instances: MockZeroconf[] = [];

class MockZeroconf {
  listeners: Record<string, ((arg: never) => void)[]> = {};
  scanArgs: unknown[] | null = null;
  stopped = 0;
  listenersRemoved = 0;
  /** Set to throw from `scan`, standing in for a native module that is absent. */
  scanThrows: Error | null = null;

  constructor() {
    instances.push(this);
  }

  on(event: string, listener: (arg: never) => void) {
    (this.listeners[event] ??= []).push(listener);
    return this;
  }

  emit(event: string, arg: unknown) {
    for (const listener of this.listeners[event] ?? []) listener(arg as never);
  }

  scan(...args: unknown[]) {
    if (this.scanThrows) throw this.scanThrows;
    this.scanArgs = args;
  }

  stop() {
    this.stopped += 1;
  }

  removeDeviceListeners() {
    this.listenersRemoved += 1;
  }
}

jest.mock('react-native-zeroconf', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => new MockZeroconf()),
}));

import { dedupe, startDiscovery, toPond } from '../discovery';

/** A resolve as NsdServiceImpl reports one. */
function resolved(overrides: Partial<Service> = {}): Service {
  return {
    name: 'Pond Hub @ nano',
    fullName: 'nano.local._pond._tcp.',
    host: 'nano.local.',
    port: 8080,
    addresses: ['192.168.1.7'],
    txt: { v: '0.1.0' },
    ...overrides,
  };
}

beforeEach(() => {
  instances.length = 0;
});

describe('toPond', () => {
  it('reduces a resolved service to something dialable', () => {
    expect(toPond(resolved())).toEqual({
      id: '192.168.1.7:8080',
      name: 'Pond Hub @ nano',
      address: '192.168.1.7',
      port: 8080,
      url: 'http://192.168.1.7:8080',
      version: '0.1.0',
    });
  });

  it('drops a service with no numeric address', () => {
    // This is the whole point of the feature: `host` is a `.local` name, which
    // Android's resolver cannot resolve, so a service is useless without one.
    expect(toPond(resolved({ addresses: [] }))).toBeNull();
    expect(toPond(resolved({ addresses: undefined }))).toBeNull();
  });

  it('drops a service with no port', () => {
    expect(toPond(resolved({ port: undefined }))).toBeNull();
  });

  it('ignores an IPv6 address and takes the IPv4 one', () => {
    const pond = toPond(resolved({ addresses: ['fe80::1c2b:9aff:fe4d:2a01', '192.168.1.7'] }));
    expect(pond?.address).toBe('192.168.1.7');
  });

  it('returns no version when the TXT record carries none', () => {
    expect(toPond(resolved({ txt: {} }))?.version).toBeUndefined();
    expect(toPond(resolved({ txt: { v: 7 } }))?.version).toBeUndefined();
  });

  it('falls back to a generic name when the instance label is blank', () => {
    expect(toPond(resolved({ name: '   ' }))?.name).toBe('Pond');
    expect(toPond(resolved({ name: undefined }))?.name).toBe('Pond');
  });
});

describe('dedupe', () => {
  it('collapses ghosts advertising the same address and port', () => {
    // Six instances for two hubs is what the development LAN actually served,
    // because an mDNS record outlives the process that registered it.
    const ghosts = ['Pond Hub @ nano', 'Pond Hub @ nano (2)', 'Pond Hub @ nano (3)'].map((name) =>
      toPond(resolved({ name }))!,
    );
    expect(dedupe(ghosts)).toHaveLength(1);
  });

  it('keeps the same hub twice when it is on two ports', () => {
    const ponds = [toPond(resolved())!, toPond(resolved({ port: 4000 }))!];
    expect(dedupe(ponds).map((p) => p.port).sort()).toEqual([4000, 8080]);
  });

  it('sorts by name so the list does not reorder as results arrive', () => {
    const ponds = [
      toPond(resolved({ name: 'Pond Hub @ zed', addresses: ['192.168.1.9'] }))!,
      toPond(resolved({ name: 'Pond Hub @ alpha', addresses: ['192.168.1.2'] }))!,
    ];
    expect(dedupe(ponds).map((p) => p.name)).toEqual(['Pond Hub @ alpha', 'Pond Hub @ zed']);
  });
});

describe('startDiscovery', () => {
  it('browses the service type pond-server registers', () => {
    startDiscovery(jest.fn(), jest.fn());
    expect(instances[0].scanArgs).toEqual(['pond', 'tcp', 'local.']);
  });

  it('reports the deduplicated list on every resolve', () => {
    const onFound = jest.fn();
    startDiscovery(onFound, jest.fn());

    instances[0].emit('resolved', resolved());
    instances[0].emit('resolved', resolved({ name: 'Pond Hub @ nano (2)' }));

    expect(onFound).toHaveBeenCalledTimes(2);
    expect(onFound.mock.calls[1][0]).toHaveLength(1);
  });

  it('does not report a service it cannot dial', () => {
    const onFound = jest.fn();
    startDiscovery(onFound, jest.fn());

    instances[0].emit('resolved', resolved({ addresses: [] }));

    expect(onFound).not.toHaveBeenCalled();
  });

  it('surfaces a browse error', () => {
    const onError = jest.fn();
    startDiscovery(jest.fn(), onError);

    instances[0].emit('error', new Error('Starting service discovery failed with code: 3'));

    expect(onError).toHaveBeenCalledWith('Starting service discovery failed with code: 3');
  });

  it('surfaces a scan that throws instead of letting it escape', () => {
    // A missing native module throws synchronously, which would otherwise take
    // down the screen rather than falling back to manual entry.
    const zeroconf = new MockZeroconf();
    zeroconf.scanThrows = new Error('null is not an object');
    instances.pop();
    const Zeroconf = jest.requireMock('react-native-zeroconf').default as jest.Mock;
    Zeroconf.mockImplementationOnce(() => {
      instances.push(zeroconf);
      return zeroconf;
    });

    const onError = jest.fn();
    expect(() => startDiscovery(jest.fn(), onError)).not.toThrow();
    expect(onError).toHaveBeenCalledWith('null is not an object');
  });

  it('releases the multicast lock and the listeners on stop', () => {
    startDiscovery(jest.fn(), jest.fn()).stop();

    expect(instances[0].stopped).toBe(1);
    expect(instances[0].listenersRemoved).toBe(1);
  });
});
