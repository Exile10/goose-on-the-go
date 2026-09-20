/* global __dirname */
const { withMainApplication, withAndroidManifest, withDangerousMod, withAppBuildGradle } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function withPondTls(config) {
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
    const app = mod.modResults.manifest.application[0].$;
    app['android:usesCleartextTraffic'] = 'false';
    app['android:networkSecurityConfig'] = '@xml/pond_network_security';
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
    const assets = path.join(root, 'main/assets');
    fs.mkdirSync(assets, { recursive: true });
    fs.copyFileSync(path.join(mod.modRequest.projectRoot, 'native/pondnet/THIRD_PARTY_NOTICES.txt'), path.join(assets, 'pond-network-notices.txt'));
    const libs = path.join(mod.modRequest.platformProjectRoot, 'app/libs');
    fs.mkdirSync(libs, { recursive: true });
    fs.copyFileSync(path.join(mod.modRequest.projectRoot, 'native/pondnet/pondnet.aar'), path.join(libs, 'pondnet.aar'));
    const tests = path.join(root, 'test/java/io/jarida/pondtls');
    fs.mkdirSync(tests, { recursive: true });
    for (const test of ['PondTlsTest.kt', 'PondProxyTest.kt']) {
      fs.copyFileSync(path.join(__dirname, 'pond-tls', test), path.join(tests, test));
    }
    for (const variant of ['main', 'debug', 'debugOptimized']) {
      const dir = path.join(root, variant, 'res/xml');
      fs.mkdirSync(dir, { recursive: true });
      const local = variant === 'main' ? '' : '<domain-config cleartextTrafficPermitted="true"><domain>localhost</domain><domain>127.0.0.1</domain><domain>::1</domain></domain-config>';
      fs.writeFileSync(path.join(dir, 'pond_network_security.xml'), `<?xml version="1.0" encoding="utf-8"?><network-security-config><base-config cleartextTrafficPermitted="false"><trust-anchors><certificates src="system" /></trust-anchors></base-config>${local}</network-security-config>\n`);
      if (variant !== 'main') {
        const manifest = path.join(root, variant, 'AndroidManifest.xml');
        if (fs.existsSync(manifest)) fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace(/android:usesCleartextTraffic="true"/g, 'android:usesCleartextTraffic="false"'));
      }
    }
    return mod;
  }]);
};
