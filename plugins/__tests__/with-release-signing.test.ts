import { applyReleaseSigning } from '../with-release-signing';

// The part of React Native's app/build.gradle template this plugin rewrites.
const template = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
        }
    }
}
`;

describe('applyReleaseSigning', () => {
  const result = applyReleaseSigning(template);

  it('signs release with the upload key and debug with the debug key', () => {
    expect(result).toMatch(/release \{\s*\/\/ Signed with the Play upload key[^\n]*\n\s*signingConfig signingConfigs\.release/);
    expect(result).toMatch(/buildTypes \{\s*debug \{\s*signingConfig signingConfigs\.debug/);
    expect(result).not.toContain('Caution!');
  });

  it('reads the key from properties, never from the repository', () => {
    expect(result).toContain("storeFile file(upload('GOTG_UPLOAD_STORE_FILE'))");
    expect(result).toContain('gradle.taskGraph.whenReady');
  });

  it('is a no-op on a file it has already rewritten', () => {
    expect(applyReleaseSigning(result)).toBe(result);
  });

  it('refuses a template it does not recognise', () => {
    expect(() => applyReleaseSigning('android {}')).toThrow(/template, which has changed/);
  });
});
