/* global __dirname */
const { withMainApplication, withAndroidManifest, withDangerousMod, withAppBuildGradle } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function withPondTls(config, options = {}) {
  config = require('./with-pond-tls-ios')(config);
  config = withMainApplication(config, (mod) => {
    let source = mod.modResults.contents;
    source = source.replace('io.jarida.pondtls.PondTls.install()', 'io.jarida.pondtls.PondTls.install(this)');
    if (!source.includes('io.jarida.pondtls.PondTls.install(this)')) {
      source = source.replace('super.onCreate()', 'super.onCreate()\n    io.jarida.pondtls.PondTls.install(this)');
    }
    if (!source.includes('add(io.jarida.pondtls.PondTlsPackage())')) {
      source = source.replace('PackageList(this).packages.apply {', 'PackageList(this).packages.apply {\n          add(io.jarida.pondtls.PondTlsPackage())');
    }
    if (!source.includes('io.jarida.pondtls.PondTls.install(this)') || !source.includes('add(io.jarida.pondtls.PondTlsPackage())')) {
      throw new Error('Pond TLS requires the Kotlin React Native application template');
    }
    mod.modResults.contents = source;
    return mod;
  });
  config = withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application[0];
    const app = application.$;
    app['android:usesCleartextTraffic'] = 'false';
    app['android:networkSecurityConfig'] = '@xml/pond_network_security';
    // Doze withdraws network access from a backgrounded app; it does not kill this one's
    // process. The service exists to keep that access, which is why dataSync is the type:
    // the node is maintaining a control connection on the user's behalf.
    application.service = application.service ?? [];
    const name = 'io.jarida.pondtls.PondNetworkService';
    if (!application.service.some((entry) => entry.$?.['android:name'] === name)) {
      application.service.push({
        $: {
          'android:name': name,
          'android:exported': 'false',
          'android:foregroundServiceType': 'dataSync',
        },
      });
    }
    return mod;
  });
  config = withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes('// Pond TLS test dependencies')) {
      mod.modResults.contents += `
// Pond TLS test dependencies
dependencies {
  implementation files('libs/pondnet.aar')
  testImplementation 'junit:junit:4.13.2'
  testImplementation 'com.squareup.okhttp3:mockwebserver:4.12.0'
  testImplementation 'com.squareup.okhttp3:okhttp-tls:4.12.0'
}
`;
    }
    if (!mod.modResults.contents.includes("implementation files('libs/pondnet.aar')")) mod.modResults.contents += "\ndependencies { implementation files('libs/pondnet.aar') }\n";
    if (!mod.modResults.contents.includes('// Verify embedded networking for every packaged Android ABI.')) {
      mod.modResults.contents += `
// Verify embedded networking for every packaged Android ABI.
tasks.register('verifyPondNetworkAbis') {
  def archive = project.layout.projectDirectory.file('libs/pondnet.aar')
  def architectures = (project.findProperty('reactNativeArchitectures') ?: 'armeabi-v7a,arm64-v8a,x86,x86_64').split(',').collect { it.trim() }
  inputs.file(archive)
  inputs.property('architectures', architectures)
  doLast {
    architectures.each { abi ->
      if (project.zipTree(archive.asFile).matching { include 'jni/' + abi + '/libgojni.so' }.isEmpty()) {
        throw new GradleException('Pond embedded networking is missing Android ABI ' + abi + '; run scripts/build-embedded-network.sh android')
      }
    }
  }
}
tasks.named('preBuild').configure { dependsOn 'verifyPondNetworkAbis' }
`;
    }
    return mod;
  });
  return withDangerousMod(config, ['android', async (mod) => {
    const root = path.join(mod.modRequest.platformProjectRoot, 'app/src');
    const java = path.join(root, 'main/java/io/jarida/pondtls');
    fs.mkdirSync(java, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'pond-tls/PondTls.kt'), path.join(java, 'PondTls.kt'));
    fs.copyFileSync(path.join(__dirname, 'pond-tls/PondNetwork.kt'), path.join(java, 'PondNetwork.kt'));
    fs.copyFileSync(path.join(__dirname, 'pond-tls/PondNetworkService.kt'), path.join(java, 'PondNetworkService.kt'));
    const assets = path.join(root, 'main/assets');
    fs.mkdirSync(assets, { recursive: true });
    fs.copyFileSync(path.join(mod.modRequest.projectRoot, 'native/pondnet/THIRD_PARTY_NOTICES.txt'), path.join(assets, 'pond-network-notices.txt'));
    const libs = path.join(mod.modRequest.platformProjectRoot, 'app/libs');
    fs.mkdirSync(libs, { recursive: true });
    const archive = path.join(mod.modRequest.projectRoot, 'native/pondnet/pondnet.aar');
    // The archive is a gitignored build output, so a fresh clone has none.
    if (!fs.existsSync(archive)) throw new Error('Pond embedded networking is missing native/pondnet/pondnet.aar; run scripts/build-embedded-network.sh android');
    fs.copyFileSync(archive, path.join(libs, 'pondnet.aar'));
    const tests = path.join(root, 'test/java/io/jarida/pondtls');
    fs.mkdirSync(tests, { recursive: true });
    for (const test of ['PondTlsTest.kt', 'PondProxyTest.kt']) {
      fs.copyFileSync(path.join(__dirname, 'pond-tls', test), path.join(tests, test));
    }
    // allowDebugCleartext (or POND_DEV_METRO_LAN=1) lets a debug build connect to HTTP endpoints
    // (such as Metro over Wi-Fi or local HTTP services) without requiring `adb reverse`.
    // It opens cleartext for the debug variants' network stack; Pond requests stay pinned
    // because PondTls refuses a marked request that is not HTTPS. The main (release) config
    // is written without cleartext and ignores these switches.
    const allowDebugCleartext = Boolean(
      options?.allowDebugCleartext ??
      options?.allowCleartextInDebug ??
      config?.android?.usesCleartextTraffic ??
      (process.env.POND_DEV_METRO_LAN === '1')
    );
    if (allowDebugCleartext) console.warn('[pond-tls] Debug builds permit cleartext to any host so Metro and local traffic can connect; release is unaffected');
    for (const variant of ['main', 'debug', 'debugOptimized']) {
      const dir = path.join(root, variant, 'res/xml');
      fs.mkdirSync(dir, { recursive: true });
      const debug = variant !== 'main';
      const local = debug ? '<domain-config cleartextTrafficPermitted="true"><domain>localhost</domain><domain>127.0.0.1</domain><domain>::1</domain></domain-config>' : '';
      const cleartext = debug && allowDebugCleartext ? 'true' : 'false';
      fs.writeFileSync(path.join(dir, 'pond_network_security.xml'), `<?xml version="1.0" encoding="utf-8"?><network-security-config><base-config cleartextTrafficPermitted="${cleartext}"><trust-anchors><certificates src="system" /></trust-anchors></base-config>${local}</network-security-config>\n`);
      if (variant !== 'main') {
        const manifest = path.join(root, variant, 'AndroidManifest.xml');
        if (fs.existsSync(manifest)) {
          const replacement = allowDebugCleartext ? 'android:usesCleartextTraffic="true"' : 'android:usesCleartextTraffic="false"';
          fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace(/android:usesCleartextTraffic="(true|false)"/g, replacement));
        }
      }
    }
    return mod;
  }]);
};
