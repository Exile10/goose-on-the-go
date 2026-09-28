/* global __dirname */
const { withAppDelegate, withInfoPlist, withPodfile, withPodfileProperties, withXcodeProject, IOSConfig } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function withPondTlsIOS(config) {
  config = withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') throw new Error('Pond TLS requires the Swift Expo application delegate');
    if (!mod.modResults.contents.includes('PondTls.install()')) {
      mod.modResults.contents = mod.modResults.contents.replace(
        /(let (?:delegate|reactNativeDelegate) = ReactNativeDelegate\(\))/,
        'PondTls.install()\n    $1',
      );
    }
    if (!mod.modResults.contents.includes('PondTls.install()')) throw new Error('Could not install Pond TLS before React Native initialization');
    return mod;
  });
  // The scene lifecycle iOS 27 requires is expo-build-properties' `ios.enableSceneSupport`,
  // not this plugin's: both declaring UIApplicationSceneManifest fails prebuild.
  config = withInfoPlist(config, (mod) => {
    const ats = mod.modResults.NSAppTransportSecurity ?? {};
    // iOS 17+ reapplies system-root trust to CGNAT addresses after the delegate.
    // These ranges need request-scoped QR trust. PondURLProtocol intercepts every
    // request to them, requiring HTTPS and a configured pin before opening a socket.
    const embedded = { NSExceptionAllowsInsecureHTTPLoads: true,
      NSExceptionMinimumTLSVersion: 'TLSv1.2', NSExceptionRequiresForwardSecrecy: true };
    mod.modResults.NSAppTransportSecurity = { ...ats, NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true,
      NSExceptionDomains: { ...(ats.NSExceptionDomains || {}), '100.64.0.0/10': embedded, 'fd7a:115c:a1e0::/48': embedded } };
    return mod;
  });
  config = withPodfileProperties(config, (mod) => {
    // SDK 56 precompiled Camera/Core frameworks can disagree on Swift ABI.
    // Compile the installed Expo sources together instead of mixing frameworks.
    mod.modResults.EXPO_USE_PRECOMPILED_MODULES = 'false';
    return mod;
  });
  config = withPodfile(config, (mod) => {
    // The framework is a gitignored build output; without it pod install vendors nothing.
    if (!fs.existsSync(path.join(mod.modRequest.projectRoot, 'native/pondnet/Pondnet.xcframework'))) {
      throw new Error('Pond embedded networking is missing native/pondnet/Pondnet.xcframework; run scripts/build-embedded-network.sh ios');
    }
    if (!mod.modResults.contents.includes("pod 'Pondnet'")) mod.modResults.contents = mod.modResults.contents.replace(/(target '[^']+' do)/, "$1\n  pod 'Pondnet', :path => '../native/pondnet'");
    const marker = '# Align resource bundle targets with the app minimum supported iOS.';
    if (!mod.modResults.contents.includes(marker)) {
      mod.modResults.contents = mod.modResults.contents.replace(
        'post_install do |installer|',
        `post_install do |installer|
    ${marker}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        minimum = podfile_properties['ios.deploymentTarget'] || '16.4'
        current = build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current && Gem::Version.new(current) < Gem::Version.new(minimum)
          build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum
        end
      end
    end`,
      );
    }
    return mod;
  });
  return withXcodeProject(config, (mod) => {
    const projectName = mod.modRequest.projectName;
    if (!projectName) throw new Error('Missing iOS project name for Pond TLS');
    const directory = path.join(mod.modRequest.platformProjectRoot, projectName);
    fs.mkdirSync(directory, { recursive: true });
    for (const name of ['PondNetwork.swift', 'PondCertificate.swift', 'PondURLProtocol.swift', 'PondTls.swift', 'PondTlsBridge.m']) {
      fs.copyFileSync(path.join(__dirname, 'pond-tls/ios', name), path.join(directory, name));
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: `${projectName}/${name}`, groupName: projectName, project: mod.modResults });
    }
    const bridge = path.join(directory, `${projectName}-Bridging-Header.h`);
    const contents = fs.existsSync(bridge) ? fs.readFileSync(bridge, 'utf8') : '';
    if (!contents.includes('RCTHTTPRequestHandler.h')) fs.writeFileSync(bridge, `${contents}\n#import <React/RCTHTTPRequestHandler.h>\n`);
    return mod;
  });
};
