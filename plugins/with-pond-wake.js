/* global __dirname */
const { withAndroidManifest, withDangerousMod, withMainApplication } = require('expo/config-plugins');
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

/**
 * Copy the detector libraries from `native/pondear/jniLibs/<abi>/` into the app's `jniLibs`.
 * A required ABI without its library stops the prebuild, as a missing pondnet.aar does: a build
 * that silently lacked it would offer a wake word that cannot hear. Exported for tests.
 */
function copyPondEarLibraries(projectRoot, appMain) {
  const source = path.join(projectRoot, 'native/pondear/jniLibs');
  for (const abi of [...REQUIRED_ABIS, ...OPTIONAL_ABIS]) {
    const library = path.join(source, abi, LIBRARY);
    if (!fs.existsSync(library)) {
      if (REQUIRED_ABIS.includes(abi)) {
        throw new Error(`Pond wake word is missing native/pondear/jniLibs/${abi}/${LIBRARY}; ${BUILD_HINT}`);
      }
      continue;
    }
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
    return mod;
  }]);
}

module.exports = withPondWake;
module.exports.applyPondWakeManifest = applyPondWakeManifest;
module.exports.copyPondEarLibraries = copyPondEarLibraries;
