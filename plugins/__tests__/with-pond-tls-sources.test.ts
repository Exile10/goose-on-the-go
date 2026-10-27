import fs from 'node:fs';
import path from 'node:path';

/**
 * Every Kotlin file under plugins/pond-tls reaches the generated Android project.
 *
 * The plugin copies them by name, so a new source it does not name is silently left out of
 * prebuild, and the app fails to compile only once someone builds for Android. RemoteNotice.kt,
 * which the remote-access service needs, is the kind of file this catches.
 */
const dir = path.join(__dirname, '..', 'pond-tls');
const plugin = fs.readFileSync(path.join(__dirname, '..', 'with-pond-tls.js'), 'utf8');
const sources = fs.readdirSync(dir).filter((name) => name.endsWith('.kt'));

it('finds the Kotlin sources', () => {
  expect(sources).toEqual(expect.arrayContaining(['PondNetworkService.kt', 'RemoteNotice.kt', 'RemoteNoticeTest.kt']));
});

/** The tests the plugin copies into app/src/test, by name. */
const tests = (plugin.match(/for \(const test of \[([^\]]*)\]\)/)?.[1] ?? '').match(/[A-Za-z]+\.kt/g) ?? [];

it.each(sources)('copies %s into the Android project', (name) => {
  if (name.endsWith('Test.kt')) expect(tests).toContain(name);
  else expect(plugin).toContain(`'pond-tls/${name}'`);
});
