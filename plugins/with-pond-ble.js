/* global __dirname */
const { withAndroidManifest, withDangerousMod, withInfoPlist, withMainApplication, withXcodeProject, IOSConfig } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const BLUETOOTH_USE =
  'Goose On The Go uses Bluetooth to find a new Pond near you and tell it which Wi-Fi to join. It talks only to Ponds you choose.';

function withPondBleIOS(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.NSBluetoothAlwaysUsageDescription = BLUETOOTH_USE;
    return mod;
  });
  return withXcodeProject(config, (mod) => {
    const projectName = mod.modRequest.projectName;
    if (!projectName) throw new Error('Missing iOS project name for Pond BLE');
    const directory = path.join(mod.modRequest.platformProjectRoot, projectName);
    fs.mkdirSync(directory, { recursive: true });
    for (const name of ['PondBle.swift', 'PondBleBridge.m']) {
      fs.copyFileSync(path.join(__dirname, 'pond-ble/ios', name), path.join(directory, name));
      if (!mod.modResults.hasFile(`${projectName}/${name}`)) {
        IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: `${projectName}/${name}`, groupName: projectName, project: mod.modResults });
      }
    }
    const bridge = path.join(directory, `${projectName}-Bridging-Header.h`);
    const contents = fs.existsSync(bridge) ? fs.readFileSync(bridge, 'utf8') : '';
    if (!contents.includes('RCTEventEmitter.h')) fs.writeFileSync(bridge, `${contents}\n#import <React/RCTEventEmitter.h>\n`);
    return mod;
  });
}

function permission(name, extra = {}) {
  return { $: { 'android:name': name, ...extra } };
}

module.exports = function withPondBle(config) {
  config = withPondBleIOS(config);
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';
    const wanted = [
      // Android 11 and older only; 12 split them into the two below.
      permission('android.permission.BLUETOOTH', { 'android:maxSdkVersion': '30' }),
      permission('android.permission.BLUETOOTH_ADMIN', { 'android:maxSdkVersion': '30' }),
      // The scan finds a Pond, never where the phone is, so it asks for no location.
      permission('android.permission.BLUETOOTH_SCAN', { 'android:usesPermissionFlags': 'neverForLocation', 'tools:targetApi': 's' }),
      permission('android.permission.BLUETOOTH_CONNECT'),
    ];
    const names = new Set(wanted.map((p) => p.$['android:name']));
    manifest['uses-permission'] = [...(manifest['uses-permission'] ?? []).filter((p) => !names.has(p.$['android:name'])), ...wanted];
    const features = (manifest['uses-feature'] ?? []).filter((f) => f.$['android:name'] !== 'android.hardware.bluetooth_le');
    // A phone without BLE still installs: it claims with the card over the network instead.
    manifest['uses-feature'] = [...features, { $: { 'android:name': 'android.hardware.bluetooth_le', 'android:required': 'false' } }];
    return mod;
  });
  config = withMainApplication(config, (mod) => {
    let source = mod.modResults.contents;
    if (!source.includes('add(io.jarida.pondble.PondBlePackage())')) {
      source = source.replace('PackageList(this).packages.apply {', 'PackageList(this).packages.apply {\n          add(io.jarida.pondble.PondBlePackage())');
    }
    if (!source.includes('add(io.jarida.pondble.PondBlePackage())')) throw new Error('Pond BLE requires the Kotlin React Native application template');
    mod.modResults.contents = source;
    return mod;
  });
  return withDangerousMod(config, ['android', async (mod) => {
    const java = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java/io/jarida/pondble');
    fs.mkdirSync(java, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'pond-ble/PondBle.kt'), path.join(java, 'PondBle.kt'));
    return mod;
  }]);
};
