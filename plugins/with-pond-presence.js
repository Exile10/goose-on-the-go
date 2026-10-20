/* global __dirname */
const { withAndroidManifest, withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const SERVICE = 'io.jarida.pondpresence.PondPresenceService';

/**
 * The permissions the background connection needs. FOREGROUND_SERVICE_REMOTE_MESSAGING is what
 * Android 14 checks for the service's type. POST_NOTIFICATIONS also arrives through
 * expo-notifications' own manifest; it is named here so the app manifest says for itself that
 * the ongoing notification depends on it.
 */
const PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING',
  'android.permission.POST_NOTIFICATIONS',
];

/**
 * Declare the service and its permissions on a parsed AndroidManifest. Idempotent, so a second
 * prebuild over the same tree leaves it as it was. Exported for tests.
 */
function applyPondPresenceManifest(manifest) {
  const held = new Set((manifest['uses-permission'] ?? []).map((p) => p.$['android:name']));
  manifest['uses-permission'] = [
    ...(manifest['uses-permission'] ?? []),
    ...PERMISSIONS.filter((name) => !held.has(name)).map((name) => ({ $: { 'android:name': name } })),
  ];
  const application = manifest.application[0];
  application.service = (application.service ?? []).filter((entry) => entry.$?.['android:name'] !== SERVICE);
  application.service.push({
    $: {
      'android:name': SERVICE,
      'android:exported': 'false',
      // remoteMessaging, not dataSync: see PondPresence.kt for why.
      'android:foregroundServiceType': 'remoteMessaging',
    },
  });
  return manifest;
}

function withPondPresence(config) {
  config = withAndroidManifest(config, (mod) => {
    applyPondPresenceManifest(mod.modResults.manifest);
    return mod;
  });
  config = withMainApplication(config, (mod) => {
    let source = mod.modResults.contents;
    if (!source.includes('add(io.jarida.pondpresence.PondPresencePackage())')) {
      source = source.replace('PackageList(this).packages.apply {', 'PackageList(this).packages.apply {\n          add(io.jarida.pondpresence.PondPresencePackage())');
    }
    if (!source.includes('add(io.jarida.pondpresence.PondPresencePackage())')) {
      throw new Error('Pond presence requires the Kotlin React Native application template');
    }
    mod.modResults.contents = source;
    return mod;
  });
  return withDangerousMod(config, ['android', async (mod) => {
    const java = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java/io/jarida/pondpresence');
    fs.mkdirSync(java, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'pond-presence/PondPresence.kt'), path.join(java, 'PondPresence.kt'));
    return mod;
  }]);
}

module.exports = withPondPresence;
module.exports.applyPondPresenceManifest = applyPondPresenceManifest;
