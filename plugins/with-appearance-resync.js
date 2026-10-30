const { withMainActivity } = require('expo/config-plugins');

// React Native's AppearanceModule learns of a light/dark change only through the activity's
// onConfigurationChanged. When the activity is gone but the process is not (swiped from
// Recents while PondNetworkService keeps it alive), a system change reaches no activity, the
// next MainActivity is created in the new mode, and nothing tells the module or the JS cache in
// Appearance.js. The app then stays in the old scheme until the system flips twice. Forwarding
// the current configuration on every resume re-syncs it; the module emits only when the scheme
// differs from the one it last sent, so a resume with no change costs nothing.
const MARKER = '// Appearance re-sync';

const onResume = `
  ${MARKER}: a light/dark change made while no activity existed never reached React Native.
  override fun onResume() {
    super.onResume()
    reactActivityDelegate.onConfigurationChanged(resources.configuration)
  }
`;

function applyAppearanceResync(contents) {
  if (contents.includes(MARKER)) return contents;
  const end = contents.lastIndexOf('}');
  if (!contents.includes('class MainActivity : ReactActivity()') || end < 0 || contents.includes('override fun onResume(')) {
    throw new Error('Appearance re-sync expects the React Native MainActivity.kt template, which has changed');
  }
  // Appended as the last member of the class, so it never splits another member from its KDoc.
  return `${contents.slice(0, end).trimEnd()}\n${onResume}${contents.slice(end)}`;
}

module.exports = function withAppearanceResync(config) {
  return withMainActivity(config, (mod) => {
    if (mod.modResults.language !== 'kt') {
      throw new Error('Appearance re-sync requires the Kotlin MainActivity template');
    }
    mod.modResults.contents = applyAppearanceResync(mod.modResults.contents);
    return mod;
  });
};
module.exports.applyAppearanceResync = applyAppearanceResync;
