import fs from 'fs';
import path from 'path';

import { applyPondAssistManifest } from '../with-pond-assist';

type Manifest = Parameters<typeof applyPondAssistManifest>[0];
type Entry = { $: Record<string, string>; 'intent-filter'?: { action: { $: Record<string, string> }[] }[]; 'meta-data'?: { $: Record<string, string> }[] };

const PACKAGE = 'io.jarida.pondassist';

function manifest(): Manifest {
  return {
    'uses-permission': [{ $: { 'android:name': 'android.permission.RECORD_AUDIO' } }],
    application: [{
      $: {},
      activity: [{ $: { 'android:name': '.MainActivity' } }],
      service: [{ $: { 'android:name': 'io.jarida.pondpresence.PondPresenceService' } }],
    }],
  };
}

const named = (entries: Entry[], name: string) => entries.find((e) => e.$['android:name'] === `${PACKAGE}.${name}`)!;
const actions = (entry: Entry) => (entry['intent-filter'] ?? []).flatMap((f) => f.action.map((a) => a.$['android:name']));

describe('applyPondAssistManifest', () => {
  it('declares the voice interaction service for the system alone, pointing at its description', () => {
    const service = named(applyPondAssistManifest(manifest()).application[0].service, 'GooseInteractionService');
    expect(service.$).toEqual({
      'android:name': `${PACKAGE}.GooseInteractionService`,
      'android:permission': 'android.permission.BIND_VOICE_INTERACTION',
      'android:exported': 'true',
    });
    expect(actions(service)).toEqual(['android.service.voice.VoiceInteractionService']);
    expect(service['meta-data']).toEqual([{ $: { 'android:name': 'android.voice_interaction', 'android:resource': '@xml/goose_interaction_service' } }]);
  });

  it('declares the session service behind the same permission', () => {
    const session = named(applyPondAssistManifest(manifest()).application[0].service, 'GooseSessionService');
    expect(session.$['android:permission']).toBe('android.permission.BIND_VOICE_INTERACTION');
  });

  it('declares the recognition service Android asks an assistant to name', () => {
    const recognizer = named(applyPondAssistManifest(manifest()).application[0].service, 'GooseRecognitionService');
    expect(actions(recognizer)).toEqual(['android.speech.RecognitionService']);
    expect(recognizer.$['android:permission']).toBe('android.permission.RECORD_AUDIO');
    expect(recognizer['meta-data']?.[0].$['android:resource']).toBe('@xml/goose_recognition_service');
  });

  it('declares the overlay as a see-through activity in its own task, out of Recents', () => {
    const overlay = named(applyPondAssistManifest(manifest()).application[0].activity, 'AssistActivity');
    expect(overlay.$).toMatchObject({
      'android:theme': '@style/Theme.GooseAssist',
      'android:exported': 'true',
      'android:taskAffinity': `${PACKAGE}.overlay`,
      'android:excludeFromRecents': 'true',
      'android:launchMode': 'singleTask',
    });
    // A translucent activity that fixes its orientation crashes on Android 8.0.
    expect(overlay.$['android:screenOrientation']).toBeUndefined();
    expect(actions(overlay)).toEqual(['android.intent.action.ASSIST', 'android.intent.action.VOICE_COMMAND']);
  });

  it('leaves the rest of the manifest alone and is a no-op the second time', () => {
    const once = applyPondAssistManifest(manifest());
    const twice = applyPondAssistManifest(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
    expect(once.application[0].service).toHaveLength(4);
    expect(once.application[0].activity).toHaveLength(2);
    expect(once['uses-permission']).toEqual(manifest()['uses-permission']);
  });
});

describe('the resources the manifest names', () => {
  const res = path.join(__dirname, '..', 'pond-assist', 'res');
  const read = (file: string) => fs.readFileSync(path.join(res, file), 'utf8');

  it('names the session and recognition services the plugin declares, and never the lock screen', () => {
    const xml = read('xml/goose_interaction_service.xml');
    expect(xml).toContain(`android:sessionService="${PACKAGE}.GooseSessionService"`);
    expect(xml).toContain(`android:recognitionService="${PACKAGE}.GooseRecognitionService"`);
    expect(xml).toContain('android:supportsAssist="true"');
    // The orb opens over the lock screen, where the Pond answers with no personal data.
    expect(xml).toContain('android:supportsLaunchVoiceAssistFromKeyguard="true"');
  });

  it('keeps the recognition service out of the Voice input picker', () => {
    expect(read('xml/goose_recognition_service.xml')).toContain('android:selectableAsDefault="false"');
  });

  it('defines the theme the overlay activity wears, see-through', () => {
    const styles = read('values/goose_assist_styles.xml');
    expect(styles).toContain('<style name="Theme.GooseAssist"');
    expect(styles).toContain('<item name="android:windowIsTranslucent">true</item>');
  });

  it('blurs the app behind from Android 12, otherwise the same theme', () => {
    const items = (xml: string) => [...xml.matchAll(/<item name="([^"]+)">([^<]+)<\/item>/g)].map((m) => `${m[1]}=${m[2]}`);
    const base = items(read('values/goose_assist_styles.xml'));
    const v31 = items(read('values-v31/goose_assist_styles.xml'));
    expect(v31.filter((item) => !item.startsWith('android:windowBlurBehind'))).toEqual(base);
    expect(v31).toEqual(expect.arrayContaining(['android:windowBlurBehindEnabled=true', expect.stringMatching(/^android:windowBlurBehindRadius=\d+px$/)]));
  });

  it('renders the component index.ts registers', () => {
    const kotlin = fs.readFileSync(path.join(__dirname, '..', 'pond-assist', 'PondAssist.kt'), 'utf8');
    const index = fs.readFileSync(path.join(__dirname, '..', '..', 'index.ts'), 'utf8');
    const component = /const val COMPONENT = "([^"]+)"/.exec(kotlin)?.[1];
    expect(component).toBe('assist');
    expect(index).toContain(`AppRegistry.registerComponent('${component}'`);
  });
});
