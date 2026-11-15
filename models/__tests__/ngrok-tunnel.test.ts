import { isReservedAddress, ngrokBlock, readRoute, type RouteState } from '@/models/ngrok-tunnel';

const base: RouteState = {
  route: 'built_in',
  atHome: true,
  tokenSet: true,
  reserved: false,
  reservedAddress: null,
  status: { state: 'off' },
  fallback: null,
  builtInRunning: true,
};

describe('readRoute', () => {
  it('reads what the Pond sends', () => {
    expect(
      readRoute({
        route: 'ngrok',
        atHome: false,
        tokenSet: true,
        reserved: true,
        reservedAddress: '1.tcp.eu.ngrok.io:12345',
        status: { state: 'running', address: '1.tcp.eu.ngrok.io:12345' },
        fallback: null,
        builtInRunning: false,
      }),
    ).toEqual({
      route: 'ngrok',
      atHome: false,
      tokenSet: true,
      reserved: true,
      reservedAddress: '1.tcp.eu.ngrok.io:12345',
      status: { state: 'running', address: '1.tcp.eu.ngrok.io:12345' },
      fallback: null,
      builtInRunning: false,
    });
  });

  it('refuses a body that is not an answer', () => {
    expect(readRoute(null)).toBeNull();
    expect(readRoute('<html>')).toBeNull();
    expect(readRoute({ route: 'tailnet' })).toBeNull();
  });

  it('reads a missing flag as false, never as allowed', () => {
    const read = readRoute({ route: 'built_in' });
    expect(read?.atHome).toBe(false);
    expect(read?.reserved).toBe(false);
    expect(read?.status).toEqual({ state: 'off' });
  });

  it('keeps the fallback address the phone has not learned', () => {
    expect(readRoute({ route: 'ngrok', fallback: '4.tcp.eu.ngrok.io:20001' })?.fallback).toBe('4.tcp.eu.ngrok.io:20001');
  });
});

describe('ngrokBlock', () => {
  it('needs a token first', () => {
    expect(ngrokBlock({ ...base, tokenSet: false })).toBe('noToken');
  });

  it('lets a phone at home switch on any plan', () => {
    expect(ngrokBlock(base)).toBeNull();
  });

  it('holds a phone away from home without a reserved address', () => {
    expect(ngrokBlock({ ...base, atHome: false })).toBe('awayUnreserved');
    expect(ngrokBlock({ ...base, atHome: false, reserved: true })).toBeNull();
  });
});

describe('isReservedAddress', () => {
  it('takes host:port as ngrok shows it, or nothing', () => {
    expect(isReservedAddress('1.tcp.eu.ngrok.io:12345')).toBe(true);
    expect(isReservedAddress('')).toBe(true);
    expect(isReservedAddress('1.tcp.eu.ngrok.io')).toBe(false);
    expect(isReservedAddress('tcp://1.tcp.eu.ngrok.io:12345')).toBe(false);
    expect(isReservedAddress('1.tcp.eu.ngrok.io:0')).toBe(false);
    expect(isReservedAddress('1.tcp.eu.ngrok.io:70000')).toBe(false);
  });
});
