import fs from 'node:fs';
import path from 'node:path';

/**
 * Every notification the native code posts must wear `drawable/notification_icon`.
 *
 * The launcher icon is what Android draws as a faint white blob in the status bar, and a
 * notice built with it next to ones built with the silhouette makes the icon switch as they
 * come and go. That is how the remote-access notice looked until it was caught on a phone.
 */
function kotlinSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return kotlinSources(full);
    return entry.name.endsWith('.kt') ? [full] : [];
  });
}

const plugins = path.join(__dirname, '..');
const builders = kotlinSources(plugins).filter((file) => fs.readFileSync(file, 'utf8').includes('.setSmallIcon('));

it('finds the native notification builders', () => {
  expect(builders.map((file) => path.relative(plugins, file))).toContain(path.join('pond-tls', 'PondNetworkService.kt'));
});

it.each(builders.map((file) => [path.relative(plugins, file), file]))('%s looks up the notification icon by name', (_name, file) => {
  const source = fs.readFileSync(file, 'utf8');
  expect(source).not.toMatch(/\.setSmallIcon\(\s*context\.applicationInfo\.icon\s*\)/);
  // The name may be inline or in a constant, as PondPresence keeps it.
  expect(source).toContain('"notification_icon"');
  expect(source).toMatch(/getIdentifier\([^)]*"drawable"/);
});
