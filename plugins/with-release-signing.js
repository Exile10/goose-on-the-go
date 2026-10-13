const { withAppBuildGradle } = require('expo/config-plugins');

// The Play upload key, supplied from outside the repository; see docs/ANDROID-SIGNING.md.
// Each is read as a Gradle property first (~/.gradle/gradle.properties), then from the environment.
const UPLOAD_KEY_PROPERTIES = [
  'GOTG_UPLOAD_STORE_FILE',
  'GOTG_UPLOAD_STORE_PASSWORD',
  'GOTG_UPLOAD_KEY_ALIAS',
  'GOTG_UPLOAD_KEY_PASSWORD',
];
const MARKER = '// Play upload key';

const signingConfig = `        release {
            ${MARKER}: set only when every value is present, so a debug build needs none of them.
            def upload = { name -> findProperty(name) ?: System.getenv(name) }
            if (${JSON.stringify(UPLOAD_KEY_PROPERTIES).replace(/"/g, "'")}.every { upload(it) }) {
                storeFile file(upload('GOTG_UPLOAD_STORE_FILE'))
                storePassword upload('GOTG_UPLOAD_STORE_PASSWORD')
                keyAlias upload('GOTG_UPLOAD_KEY_ALIAS')
                keyPassword upload('GOTG_UPLOAD_KEY_PASSWORD')
            }
        }
`;

// Refuse to package a release without the upload key, rather than let AGP fall through to an
// unsigned or debug-signed artefact. Checked when the task graph is known, so debug builds and
// unit tests, which never package a release, run without the key.
const releaseGuard = `
${MARKER}: refuse to package a release without it.
gradle.taskGraph.whenReady { graph ->
    def packaging = ['packageRelease', 'bundleRelease', 'signReleaseBundle']
    if (!graph.allTasks.any { it.project == project && it.name in packaging }) return
    def missing = ${JSON.stringify(UPLOAD_KEY_PROPERTIES).replace(/"/g, "'")}.findAll { !(findProperty(it) ?: System.getenv(it)) }
    if (missing) {
        throw new GradleException("Release builds are signed with the Play upload key, and " +
            "\${missing.join(', ')} \${missing.size() == 1 ? 'is' : 'are'} not set. See docs/ANDROID-SIGNING.md.")
    }
}
`;

function applyReleaseSigning(contents) {
  if (contents.includes(MARKER)) return contents;
  const release = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!release.test(contents) || !contents.includes('    signingConfigs {\n')) {
    throw new Error('Release signing expects the React Native app/build.gradle template, which has changed');
  }
  return (
    contents
      .replace(release, '$1signingConfig signingConfigs.release')
      .replace(
        /\/\/ Caution! In production, you need to generate your own keystore file\.\n(\s*)\/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\./,
        '// Signed with the Play upload key; see docs/ANDROID-SIGNING.md.',
      )
      .replace('    signingConfigs {\n', `    signingConfigs {\n${signingConfig}`) + releaseGuard
  );
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = applyReleaseSigning(mod.modResults.contents);
    return mod;
  });
};
module.exports.applyReleaseSigning = applyReleaseSigning;
