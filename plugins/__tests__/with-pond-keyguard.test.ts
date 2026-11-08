import { applyPondKeyguardApplication, applyPondKeyguardGradle } from '../with-pond-keyguard';

const GRADLE = 'android {\n}\n\ndependencies {\n    implementation("com.facebook.react:react-android")\n}\n';
const APPLICATION =
  'override fun getPackages(): List<ReactPackage> =\n        PackageList(this).packages.apply {\n          add(io.jarida.pondpresence.PondPresencePackage())\n        }\n';

describe('with-pond-keyguard', () => {
  it('puts the biometric library on the app module once', () => {
    const once = applyPondKeyguardGradle(GRADLE);
    expect(once).toContain('implementation "androidx.biometric:biometric:1.1.0"');
    expect(applyPondKeyguardGradle(once)).toBe(once);
  });

  it('refuses a build file it cannot place the library in', () => {
    expect(() => applyPondKeyguardGradle('android {}')).toThrow(/dependencies block/);
  });

  it('registers the package beside the others, once', () => {
    const once = applyPondKeyguardApplication(APPLICATION);
    expect(once).toContain('add(io.jarida.pondkeyguard.PondKeyguardPackage())');
    expect(once).toContain('add(io.jarida.pondpresence.PondPresencePackage())');
    expect(applyPondKeyguardApplication(once)).toBe(once);
  });

  it('refuses an application it cannot register with', () => {
    expect(() => applyPondKeyguardApplication('class MainApplication')).toThrow(/Kotlin React Native/);
  });
});
