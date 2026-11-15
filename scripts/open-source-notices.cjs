#!/usr/bin/env node
/* global __dirname */
/**
 * The open-source notices the app shows (Settings, Privacy and licenses, Open-source licences):
 * every package this app actually ships, with its licence, generated from a release build so the
 * list can neither miss what ships nor list what does not.
 *
 *   node scripts/open-source-notices.cjs --sourcemap <index.android.bundle.map> [--android <dir>]
 *
 * - JavaScript: the packages the release bundle contains, read from its source map, each with its
 *   version, its declared licence and the text of its licence file.
 * - Android libraries: `--android` (the prebuilt `android/` directory) asks Gradle for the release
 *   runtime classpath, and each library's published POM for its licence's name and address.
 * - Embedded native libraries: their own notice files, verbatim (`native/*\/THIRD_PARTY_NOTICES.txt`).
 *
 * Writes `assets/legal/open-source.json`. A licence text shared by many packages is stored once.
 * Run it after a release build, before a release; docs/LICENSES.md says when.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets/legal/open-source.json');
const LICENSE_FILE = /^(licen[cs]e|copying|unlicense)(\.(md|txt|markdown))?$/i;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
}

/** The package directory a bundled source path belongs to: the last `node_modules/<name>`. */
function packageRoot(source) {
  const at = source.lastIndexOf('node_modules/');
  if (at < 0) return null;
  const rest = source.slice(at + 'node_modules/'.length).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  return { name, dir: source.slice(0, at) + 'node_modules/' + name };
}

/** A package.json `license` in its many historical shapes, as one SPDX-like string. */
function declared(pkg) {
  const l = pkg.license ?? pkg.licenses;
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) return l.map((x) => (typeof x === 'string' ? x : x.type)).join(' OR ');
  if (l && typeof l === 'object') return l.type ?? 'UNKNOWN';
  return 'UNKNOWN';
}

function licenseText(dir) {
  const file = fs.readdirSync(dir).find((f) => LICENSE_FILE.test(f));
  return file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : null;
}

/** The MIT licence for a package that declares MIT and ships no text, its author as the holder. */
function mitFor(pkg) {
  if (declared(pkg) !== 'MIT') return null;
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
  const holder = author ? author.replace(/\s*[<(].*$/, '').trim() : null;
  if (!holder) return null;
  return `MIT License\n\nCopyright (c) ${holder}\n\n${MIT_BODY}`;
}

const MIT_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

/**
 * Packages published from a monorepo often ship without a licence file of their own: the
 * project's licence covers them. React Native's and Expo's are used for their own packages.
 */
function projectLicense(name) {
  const project = name.startsWith('@react-native/') ? 'react-native' : /^(@expo\/|expo-|expo$)/.test(name) ? 'expo' : null;
  return project ? licenseText(path.join(ROOT, 'node_modules', project)) : null;
}

/** Texts by a short hash, so the many identical licences are stored once. */
const texts = {};
function keep(text) {
  if (!text) return null;
  const id = crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
  texts[id] = text;
  return id;
}

function javascriptPackages(sourcemap) {
  const map = JSON.parse(fs.readFileSync(sourcemap, 'utf8'));
  const found = new Map();
  for (const source of map.sources) {
    // Metro writes paths from the project folder's name ("/goose-on-the-go/node_modules/..."),
    // so each is read from its first node_modules, against this checkout's own.
    const at = source.indexOf('node_modules/');
    if (at < 0) continue;
    const root = packageRoot(path.join(ROOT, source.slice(at)));
    if (!root || found.has(root.dir)) continue;
    const manifest = path.join(root.dir, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    found.set(root.dir, {
      name: pkg.name ?? root.name,
      version: pkg.version ?? '',
      license: declared(pkg),
      text: keep(licenseText(root.dir) ?? projectLicense(pkg.name ?? root.name) ?? mitFor(pkg)),
      url: typeof pkg.homepage === 'string' ? pkg.homepage : null,
    });
  }
  // One entry per name and version, whichever copy of it the bundle took.
  const unique = new Map([...found.values()].map((p) => [`${p.name}@${p.version}`, p]));
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** `group:artifact:version` of every library in the release runtime classpath. */
function androidCoordinates(androidDir) {
  const out = execFileSync('./gradlew', [':app:dependencies', '--configuration', 'releaseRuntimeClasspath', '-q'], {
    cwd: androidDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const coordinates = new Set();
  for (const line of out.split('\n')) {
    const m = line.match(/[+\\]--- ([\w.-]+):([\w.-]+):([\w.+-]+)(?: -> ([\w.+-]+))?/);
    if (m && !m[1].startsWith('project')) coordinates.add(`${m[1]}:${m[2]}:${m[4] ?? m[3]}`);
  }
  return [...coordinates].sort();
}

/** Where Gradle resolves the app's libraries from, in its own order. */
const REPOSITORIES = ['https://dl.google.com/dl/android/maven2', 'https://repo1.maven.org/maven2', 'https://jitpack.io'];
const POM_CACHE = path.join(os.homedir(), '.cache/gotg-notices/poms');

/** A library's POM, from the local cache or the first repository that has it; null if none. */
async function pom(group, artifact, version) {
  const file = path.join(POM_CACHE, `${group}__${artifact}__${version}.pom`);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  for (const repo of REPOSITORIES) {
    const res = await fetch(`${repo}/${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}.pom`);
    if (!res.ok) continue;
    const xml = await res.text();
    fs.mkdirSync(POM_CACHE, { recursive: true });
    fs.writeFileSync(file, xml);
    return xml;
  }
  return null;
}

/** The licence a library's POM declares, following its parent POM when it declares none. */
async function pomLicense(group, artifact, version, depth = 0) {
  const xml = await pom(group, artifact, version);
  if (!xml) return null;
  const licence = xml.match(/<licenses>[\s\S]*?<name>([^<]+)<\/name>(?:[\s\S]*?<url>([^<]+)<\/url>)?/);
  if (licence) return { license: licence[1].trim(), url: licence[2] ? licence[2].trim() : null };
  const parent = xml.match(/<parent>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<version>([^<]+)<\/version>/);
  return parent && depth < 4 ? pomLicense(parent[1].trim(), parent[2].trim(), parent[3].trim(), depth + 1) : null;
}

/** The Apache License 2.0, shipped once in full: section 4 asks that recipients get a copy. */
async function apacheText() {
  const file = path.join(path.dirname(POM_CACHE), 'apache-2.0.txt');
  if (!fs.existsSync(file)) {
    const res = await fetch('https://www.apache.org/licenses/LICENSE-2.0.txt');
    if (!res.ok) throw new Error(`could not fetch the Apache License text: ${res.status}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await res.text());
  }
  return fs.readFileSync(file, 'utf8').trim();
}

async function androidLibraries(androidDir) {
  const apache = keep(await apacheText());
  const out = [];
  for (const coordinate of androidCoordinates(androidDir)) {
    const [group, artifact, version] = coordinate.split(':');
    // The native halves of React Native's and Expo's own modules are built from their npm
    // packages, whose licence covers them; they publish no POM of their own.
    const project = group === 'com.facebook.react' ? 'react-native' : /^(expo\.modules|host\.exp)/.test(group) ? 'expo' : null;
    const found = project ? null : await pomLicense(group, artifact, version);
    const license = project ? `MIT (${project})` : found?.license ?? 'Not declared by the library';
    out.push({
      name: `${group}:${artifact}`,
      version,
      license,
      url: found?.url ?? null,
      text: project ? keep(licenseText(path.join(ROOT, 'node_modules', project))) : /apache/i.test(license) && /2/.test(license) ? apache : null,
    });
  }
  return out;
}

function embeddedNotices() {
  const native = path.join(ROOT, 'native');
  return fs
    .readdirSync(native)
    .map((dir) => path.join(native, dir, 'THIRD_PARTY_NOTICES.txt'))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({
      title: fs.readFileSync(file, 'utf8').split('\n')[0].trim(),
      text: fs.readFileSync(file, 'utf8').trim(),
    }));
}

async function main() {
  const sourcemap = arg('--sourcemap');
  if (!sourcemap) throw new Error('--sourcemap <release bundle source map> is required');
  const androidDir = arg('--android');
  const notices = {
    javascript: javascriptPackages(sourcemap),
    android: androidDir ? await androidLibraries(androidDir) : [],
    embedded: embeddedNotices(),
    texts,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(notices) + '\n');
  console.log(
    `open-source notices: ${notices.javascript.length} JavaScript packages, ${notices.android.length} Android libraries, ` +
      `${notices.embedded.length} embedded notices, ${Object.keys(texts).length} distinct licence texts`,
  );
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
module.exports = { packageRoot, declared };
