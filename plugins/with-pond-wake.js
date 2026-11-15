/* global __dirname */
const { withAndroidManifest, withDangerousMod, withMainApplication } = require('expo/config-plugins');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SERVICE = 'io.jarida.pondwake.GooseWakeService';
const SERVICE_PERMISSION = 'android.permission.FOREGROUND_SERVICE_MICROPHONE';
const PACKAGE_LINE = 'add(io.jarida.pondwake.PondWakePackage())';

/** The ABIs the app packages (`reactNativeArchitectures`), each of which needs the detector. */
const REQUIRED_ABIS = ['arm64-v8a', 'armeabi-v7a'];
/** Built when asked for, for an emulator; packaged when present. */
const OPTIONAL_ABIS = ['x86_64'];
const LIBRARY = 'libpondear.so';
const BUILD_HINT = 'run scripts/build-embedded-ear.sh';

/**
 * Declare the "Hey Goose" listening service on a parsed AndroidManifest (the `manifest` element's
 * contents). Idempotent. Exported for tests.
 *
 * Type microphone, which Android 14 allows only while RECORD_AUDIO (declared by expo-audio) is
 * granted and the app is in front when it starts; see GooseWakeService in pond-wake/PondWake.kt.
 * Not exported: only the app starts it, and only its own notification stops it.
 */
function applyPondWakeManifest(manifest) {
  const application = manifest.application[0];
  application.service = (application.service ?? []).filter((entry) => entry.$?.['android:name'] !== SERVICE);
  application.service.push({
    $: { 'android:name': SERVICE, 'android:exported': 'false', 'android:foregroundServiceType': 'microphone' },
  });
  manifest['uses-permission'] = manifest['uses-permission'] ?? [];
  if (!manifest['uses-permission'].some((entry) => entry.$?.['android:name'] === SERVICE_PERMISSION)) {
    manifest['uses-permission'].push({ $: { 'android:name': SERVICE_PERMISSION } });
  }
  return manifest;
}

/** Build the detector with the repository's own script; false where this machine cannot. */
function buildPondEar(projectRoot) {
  try {
    execFileSync(path.join(projectRoot, 'scripts/build-embedded-ear.sh'), [], { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy the detector libraries from `native/pondear/jniLibs/<abi>/` into the app's `jniLibs`,
 * building them first when a packaged ABI lacks one. Where they cannot be built, the app is
 * packaged without them: the wake word then reports itself unavailable and its setting stays
 * hidden, rather than the whole build failing. Exported for tests.
 */
function copyPondEarLibraries(projectRoot, appMain, build = buildPondEar) {
  const source = path.join(projectRoot, 'native/pondear/jniLibs');
  const missing = () => REQUIRED_ABIS.filter((abi) => !fs.existsSync(path.join(source, abi, LIBRARY)));
  if (missing().length > 0) build(projectRoot);
  const still = missing();
  if (still.length > 0) {
    console.warn(`Pond wake word: packaging without the detector for ${still.join(', ')}, so "Hey Goose" is not offered there; ${BUILD_HINT}`);
  }
  for (const abi of [...REQUIRED_ABIS, ...OPTIONAL_ABIS]) {
    const library = path.join(source, abi, LIBRARY);
    if (!fs.existsSync(library)) continue;
    const target = path.join(appMain, 'jniLibs', abi);
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(library, path.join(target, LIBRARY));
  }
}

function withPondWake(config) {
  config = withAndroidManifest(config, (mod) => {
    applyPondWakeManifest(mod.modResults.manifest);
    return mod;
  });
  config = withMainApplication(config, (mod) => {
    let source = mod.modResults.contents;
    if (!source.includes(PACKAGE_LINE)) {
      source = source.replace('PackageList(this).packages.apply {', `PackageList(this).packages.apply {\n          ${PACKAGE_LINE}`);
    }
    if (!source.includes(PACKAGE_LINE)) {
      throw new Error('Pond wake word requires the Kotlin React Native application template');
    }
    mod.modResults.contents = source;
    return mod;
  });
  return withDangerousMod(config, ['android', async (mod) => {
    const main = path.join(mod.modRequest.platformProjectRoot, 'app/src/main');
    const java = path.join(main, 'java/io/jarida/pondwake');
    fs.mkdirSync(java, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'pond-wake/PondWake.kt'), path.join(java, 'PondWake.kt'));
    copyPondEarLibraries(mod.modRequest.projectRoot, main);
    // The licences of what the library carries (Silero VAD, jni-sys, pond-ear), shipped with it
    // as the network library's are.
    const assets = path.join(main, 'assets');
    fs.mkdirSync(assets, { recursive: true });
    fs.copyFileSync(path.join(mod.modRequest.projectRoot, 'native/pondear/THIRD_PARTY_NOTICES.txt'), path.join(assets, 'pond-wake-notices.txt'));
    return mod;
  }]);
}

module.exports = withPondWake;
module.exports.applyPondWakeManifest = applyPondWakeManifest;
module.exports.copyPondEarLibraries = copyPondEarLibraries;
