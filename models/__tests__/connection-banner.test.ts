import { bannerHiddenOn, connectionActionIsPairing, connectionNeedsAttention, type ConnectionState } from '../connection';

describe('where the connection banner stays out of the way', () => {
  it('stays away from first run, the pairing wizard and the scanner, which are the pairing it offers', () => {
    expect(bannerHiddenOn(['(onboarding)', 'welcome'])).toBe(true);
    expect(bannerHiddenOn(['(onboarding)', 'pond-wifi'])).toBe(true);
    expect(bannerHiddenOn(['(onboarding)', 'owner-setup'])).toBe(true);
    expect(bannerHiddenOn(['(stack)', 'pond-pairing'])).toBe(true);
    expect(bannerHiddenOn(['(stack)', 'connect-desktop'])).toBe(true);
  });

  it('shows everywhere else', () => {
    expect(bannerHiddenOn(['(tabs)'])).toBe(false);
    expect(bannerHiddenOn(['(stack)', 'settings-voice'])).toBe(false);
    expect(bannerHiddenOn(['conversation'])).toBe(false);
    expect(bannerHiddenOn([])).toBe(false);
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
