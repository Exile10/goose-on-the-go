import { connectionActionIsPairing, connectionNeedsAttention, connectionSurface, stackScreenSurface, type ConnectionState } from '../connection';

describe('where the connection is told', () => {
  it('leaves first run, the pairing wizard and the scanner to say it in their own words', () => {
    expect(connectionSurface(['(onboarding)', 'welcome'])).toBe('own');
    expect(connectionSurface(['(onboarding)', 'pond-wifi'])).toBe('own');
    expect(connectionSurface(['(onboarding)', 'owner-setup'])).toBe('own');
    expect(connectionSurface(['(stack)', 'pond-pairing'])).toBe('own');
    expect(connectionSurface(['(stack)', 'connect-desktop'])).toBe('own');
  });

  it('leaves Home and Switch Pond to their Pond card', () => {
    expect(connectionSurface(['(tabs)'])).toBe('own');
    expect(connectionSurface(['(tabs)', 'index'])).toBe('own');
    expect(connectionSurface(['(stack)', 'switch-pond'])).toBe('own');
  });

  it('puts it under the title bar of every other stack screen, never above it', () => {
    expect(connectionSurface(['(stack)', 'settings-voice'])).toBe('inline');
    expect(connectionSurface(['(stack)', 'pond'])).toBe('inline');
    expect(stackScreenSurface('settings-voice')).toBe('inline');
    expect(stackScreenSurface('switch-pond')).toBe('own');
  });

  it('puts it in the strip above the app everywhere else', () => {
    expect(connectionSurface(['(tabs)', 'chat'])).toBe('banner');
    expect(connectionSurface(['(tabs)', 'devices'])).toBe('banner');
    expect(connectionSurface(['conversation'])).toBe('banner');
    expect(connectionSurface([])).toBe('banner');
  });
});

describe('when the connection indicator speaks, and what it offers', () => {
  const ALL: ConnectionState[] = ['trust', 'unpaired', 'upgrade', 'reconnecting', 'local', 'remote', 'disconnected', 'revoked'];

  it('says nothing about a working connection, and something about every other state', () => {
    expect(ALL.filter(connectionNeedsAttention)).toEqual(['trust', 'unpaired', 'upgrade', 'reconnecting', 'disconnected', 'revoked']);
  });

  it('offers pairing where another attempt to connect would change nothing', () => {
    // A revoked phone reaches the Pond fine; a token-less probe would report success.
    expect(ALL.filter(connectionActionIsPairing)).toEqual(['unpaired', 'upgrade', 'revoked']);
  });
});
