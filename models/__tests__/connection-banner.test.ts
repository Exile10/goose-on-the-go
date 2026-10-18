import { bannerHiddenOn } from '../connection';

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
