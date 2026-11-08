/* global __dirname */
const { withAndroidManifest, withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE = 'io.jarida.pondassist';
const INTERACTION_SERVICE = `${PACKAGE}.GooseInteractionService`;
const SESSION_SERVICE = `${PACKAGE}.GooseSessionService`;
const RECOGNITION_SERVICE = `${PACKAGE}.GooseRecognitionService`;
const ACTIVITY = `${PACKAGE}.AssistActivity`;
const OURS = new Set([INTERACTION_SERVICE, SESSION_SERVICE, RECOGNITION_SERVICE]);

/** Only the system, which holds this permission, may bind the assistant's services. */
const BIND_VOICE_INTERACTION = 'android.permission.BIND_VOICE_INTERACTION';

/** The resources copied beside the Kotlin, by their path under `res/`. */
const RESOURCES = ['xml/goose_interaction_service.xml', 'xml/goose_recognition_service.xml', 'values/goose_assist_styles.xml'];

const action = (name) => ({ $: { 'android:name': name } });
const DEFAULT_CATEGORY = [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }];

/**
 * Declare the assistant's services and its overlay activity on a parsed AndroidManifest.
 * Idempotent, so a second prebuild over the same tree leaves it as it was. Exported for tests.
 *
 * The microphone permission is not added here: expo-audio declares RECORD_AUDIO already.
 */
function applyPondAssistManifest(manifest) {
  const application = manifest.application[0];
  application.service = (application.service ?? []).filter((entry) => !OURS.has(entry.$?.['android:name']));
  application.service.push(
    {
      $: {
        'android:name': INTERACTION_SERVICE,
        'android:permission': BIND_VOICE_INTERACTION,
        'android:exported': 'true',
      },
      'meta-data': [{ $: { 'android:name': 'android.voice_interaction', 'android:resource': '@xml/goose_interaction_service' } }],
      'intent-filter': [{ action: [action('android.service.voice.VoiceInteractionService')] }],
    },
    {
      $: {
        'android:name': SESSION_SERVICE,
        'android:permission': BIND_VOICE_INTERACTION,
        'android:exported': 'true',
      },
    },
    {
      // A caller of a speech recogniser needs the microphone permission anyway; this one is
      // refused straight away (see GooseRecognitionService), and asks for no more than that.
      $: {
        'android:name': RECOGNITION_SERVICE,
        'android:permission': 'android.permission.RECORD_AUDIO',
        'android:exported': 'true',
      },
      'meta-data': [{ $: { 'android:name': 'android.speech', 'android:resource': '@xml/goose_recognition_service' } }],
      'intent-filter': [{ action: [action('android.speech.RecognitionService')], category: DEFAULT_CATEGORY }],
    },
  );
  application.activity = (application.activity ?? []).filter((entry) => entry.$?.['android:name'] !== ACTIVITY);
  application.activity.push({
    $: {
      'android:name': ACTIVITY,
      'android:theme': '@style/Theme.GooseAssist',
      // Exported for the ASSIST and VOICE_COMMAND filters below.
      'android:exported': 'true',
      // Its own task, kept out of Recents: see AssistActivity in PondAssist.kt.
      'android:taskAffinity': `${PACKAGE}.overlay`,
      'android:excludeFromRecents': 'true',
      'android:launchMode': 'singleTask',
      'android:windowSoftInputMode': 'adjustResize',
      // As MainActivity: a rotation or a theme change must not restart the conversation.
      'android:configChanges': 'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|locale|layoutDirection',
    },
    'intent-filter': [
      // Where the phone has no voice interaction service chosen, the assist gesture and a
      // headset's long press still look for these.
      { action: [action('android.intent.action.ASSIST')], category: DEFAULT_CATEGORY },
      { action: [action('android.intent.action.VOICE_COMMAND')], category: DEFAULT_CATEGORY },
    ],
  });
  return manifest;
}

function withPondAssist(config) {
  config = withAndroidManifest(config, (mod) => {
    applyPondAssistManifest(mod.modResults.manifest);
    return mod;
  });
  config = withMainApplication(config, (mod) => {
    let source = mod.modResults.contents;
    if (!source.includes('add(io.jarida.pondassist.PondAssistPackage())')) {
      source = source.replace('PackageList(this).packages.apply {', 'PackageList(this).packages.apply {\n          add(io.jarida.pondassist.PondAssistPackage())');
    }
    if (!source.includes('add(io.jarida.pondassist.PondAssistPackage())')) {
      throw new Error('Pond assist requires the Kotlin React Native application template');
    }
    mod.modResults.contents = source;
    return mod;
  });
  return withDangerousMod(config, ['android', async (mod) => {
    const main = path.join(mod.modRequest.platformProjectRoot, 'app/src/main');
    const java = path.join(main, 'java/io/jarida/pondassist');
    fs.mkdirSync(java, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'pond-assist/PondAssist.kt'), path.join(java, 'PondAssist.kt'));
    for (const resource of RESOURCES) {
      const target = path.join(main, 'res', resource);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(__dirname, 'pond-assist/res', resource), target);
    }
    return mod;
  }]);
}

module.exports = withPondAssist;
module.exports.applyPondAssistManifest = applyPondAssistManifest;
