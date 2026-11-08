/* global __dirname */
const { withAppBuildGradle, withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

/** The prompt PondKeyguard.kt shows. expo-secure-store pins the same version for its own prompt. */
const BIOMETRIC = 'implementation "androidx.biometric:biometric:1.1.0"';
const PACKAGE = 'add(io.jarida.pondkeyguard.PondKeyguardPackage())';

/**
 * Add the biometric library to the app module's dependencies, once. Exported for tests: the app
 * module compiles PondKeyguard.kt, so it needs the library on its own compile path, not only
 * expo-secure-store's.
 */
function applyPondKeyguardGradle(gradle) {
  if (gradle.includes(BIOMETRIC)) return gradle;
  if (!/dependencies\s*\{/.test(gradle)) throw new Error('Pond keyguard: the app build.gradle has no dependencies block');
  return gradle.replace(/dependencies\s*\{/, (open) => `${open}\n    ${BIOMETRIC}`);
}

/** Register the package with the React Native host, once. Exported for tests. */
function applyPondKeyguardApplication(source) {
  if (source.includes(PACKAGE)) return source;
  const next = source.replace('PackageList(this).packages.apply {', `PackageList(this).packages.apply {\n          ${PACKAGE}`);
  if (!next.includes(PACKAGE)) throw new Error('Pond keyguard requires the Kotlin React Native application template');
  return next;
}

function withPondKeyguard(config) {
  config = withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = applyPondKeyguardGradle(mod.modResults.contents);
    return mod;
  });
  config = withMainApplication(config, (mod) => {
    mod.modResults.contents = applyPondKeyguardApplication(mod.modResults.contents);
    return mod;
  });
  return withDangerousMod(config, ['android', async (mod) => {
    const java = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java/io/jarida/pondkeyguard');
    fs.mkdirSync(java, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'pond-keyguard/PondKeyguard.kt'), path.join(java, 'PondKeyguard.kt'));
    return mod;
  }]);
}

module.exports = withPondKeyguard;
module.exports.applyPondKeyguardGradle = applyPondKeyguardGradle;
module.exports.applyPondKeyguardApplication = applyPondKeyguardApplication;
