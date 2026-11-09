#!/usr/bin/env node
/* global __dirname */
/**
 * The privacy policy and the terms of use, from the documents a lawyer reviews into the app.
 *
 * `docs/PRIVACY.md` and `docs/TERMS.md` are the source. The app shows each from
 * `services/i18n/locales/en.json` (`legal.privacyPolicy`, `legal.terms`), so a translator works
 * with them like any other copy. This copies a document's "Last updated" line and everything after
 * its `---` separator, leaving out the title and the drafting status above it.
 *
 *   node scripts/legal-copy.cjs          write the copies into en.json
 *   node scripts/legal-copy.cjs --check  exit 1 when en.json is behind the documents
 *
 * `constants/__tests__/legal-copy.test.ts` runs the check, so the app cannot ship a policy that
 * differs from the reviewed one.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EN = path.join(ROOT, 'services/i18n/locales/en.json');
const DOCUMENTS = { privacyPolicy: 'docs/PRIVACY.md', terms: 'docs/TERMS.md' };

/** A document as the app shows it: its "Last updated" line, then its body. */
function inAppText(markdown) {
  const updated = markdown.split('\n').find((line) => line.startsWith('Last updated:'));
  const separator = markdown.indexOf('\n---\n');
  if (!updated || separator < 0) throw new Error('a legal document needs a "Last updated:" line and a --- separator');
  return `${updated}\n\n${markdown.slice(separator + 5).trim()}\n`;
}

/** What en.json's `legal` block should hold. */
function expected() {
  const out = {};
  for (const [key, file] of Object.entries(DOCUMENTS)) {
    out[key] = inAppText(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  }
  return out;
}

function main() {
  const raw = fs.readFileSync(EN, 'utf8');
  const en = JSON.parse(raw);
  const want = expected();
  const same = JSON.stringify(en.legal) === JSON.stringify(want);
  if (process.argv.includes('--check')) {
    if (!same) {
      console.error('en.json is behind docs/PRIVACY.md or docs/TERMS.md: run node scripts/legal-copy.cjs');
      process.exit(1);
    }
    return;
  }
  if (same) return;
  en.legal = want;
  fs.writeFileSync(EN, JSON.stringify(en, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
  console.log('legal copy written to en.json');
}

if (require.main === module) main();
module.exports = { inAppText, expected };
