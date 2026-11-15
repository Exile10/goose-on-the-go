import { parseConnectionProfile, remoteRoutes, tunnelChange, tunnelOrigin } from '../connection';

describe('tunnelOrigin', () => {
  it('takes host:port or an origin', () => {
    expect(tunnelOrigin('2.tcp.eu.ngrok.io:22333')).toBe('https://2.tcp.eu.ngrok.io:22333');
    expect(tunnelOrigin('https://pond.example.org')).toBe('https://pond.example.org');
  });

  it('refuses addresses and anything that would pass for the home network', () => {
    for (const bad of ['203.0.113.9:1', '[2001:db8::1]:443', 'pond.local:4443', 'localhost:4443', 'http://x.example:1', 'pond:4443']) {
      expect(() => tunnelOrigin(bad)).toThrow();
    }
  });
});

describe('tunnelChange', () => {
  const saved = 'https://2.tcp.eu.ngrok.io:22333';
  it('leaves the tunnel alone for a Pond too old to report one', () => {
    expect(tunnelChange(saved, undefined)).toBeNull();
  });
  it('drops it when the Pond says none runs', () => {
    expect(tunnelChange(saved, null)).toEqual({ tunnelUrl: undefined });
    expect(tunnelChange(undefined, null)).toBeNull();
  });
  it('saves a new address and ignores the same one', () => {
    expect(tunnelChange(saved, '5.tcp.eu.ngrok.io:10101')).toEqual({ tunnelUrl: 'https://5.tcp.eu.ngrok.io:10101' });
    expect(tunnelChange(saved, '2.tcp.eu.ngrok.io:22333')).toBeNull();
  });
  it('ignores an address it cannot use', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(tunnelChange(saved, '192.168.1.2:4443')).toBeNull();
  });
});

describe('a saved profile', () => {
  const base = { version: 2, host: 'pond.local', port: 4443, localUrls: ['https://192.168.1.2:4443'] };
  it('keeps its tunnel, which counts as a remote route without enabling the tailnet', () => {
    const profile = parseConnectionProfile({ ...base, tunnelUrl: 'https://2.tcp.eu.ngrok.io:22333' });
    expect(profile?.tunnelUrl).toBe('https://2.tcp.eu.ngrok.io:22333');
    expect(remoteRoutes(profile!)).toEqual(['https://2.tcp.eu.ngrok.io:22333']);
  });
  it('is refused when its tunnel is a home address', () => {
    expect(parseConnectionProfile({ ...base, tunnelUrl: 'https://192.168.1.9:4443' })).toBeNull();
  });
});
