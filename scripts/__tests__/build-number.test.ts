import appJson from '../../app.json';

// See docs/RELEASING.md. Both stores refuse a build whose number they have already seen, so it
// is set explicitly in app.json rather than left to whatever prebuild defaults to.
describe('app.json build identity', () => {
  const { version, ios, android } = appJson.expo;

  it('declares an android.versionCode that Play will accept', () => {
    expect(Number.isInteger(android.versionCode)).toBe(true);
    expect(android.versionCode).toBeGreaterThanOrEqual(1);
  });

  it('keeps ios.buildNumber equal to android.versionCode', () => {
    expect(ios.buildNumber).toBe(String(android.versionCode));
  });

  it('keeps expo.version as a three-part version string', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
