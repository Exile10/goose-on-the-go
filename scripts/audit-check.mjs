#!/usr/bin/env node
/**
 * npm-audit gate with documented exceptions.
 *
 * `npm audit` has no ignore file, so it offers only two bad options: fail the
 * build on advisories nobody can fix today, or lower the threshold and stop
 * seeing the ones that matter. This keeps the threshold at high+ and requires
 * every exception to be written down in `.audit-allowlist.json` with a reason
 * and a review date — the same policy as the Pond's `.cargo/audit.toml`.
 *
 * The allowlist is also checked against reality, so it cannot quietly rot:
 *
 *   - an entry whose advisory no longer appears fails the run (it is stale and
 *     should be deleted, and its absence is good news worth noticing)
 *   - an entry past its reviewBy date fails the run (exceptions expire; they
 *     are deferrals, not pardons)
 *
 * Usage: node scripts/audit-check.mjs [--threshold high]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical'];
const ALLOWLIST_PATH = new URL('../.audit-allowlist.json', import.meta.url);

const thresholdArg = process.argv.indexOf('--threshold');
const threshold = thresholdArg === -1 ? 'high' : process.argv[thresholdArg + 1];
const minSeverity = SEVERITY_ORDER.indexOf(threshold);
if (minSeverity === -1) {
  console.error(`unknown severity threshold: ${threshold}`);
  process.exit(2);
}

/** `npm audit` exits non-zero when it finds anything, so capture rather than throw. */
function runAudit() {
  try {
    return execFileSync('npm', ['audit', '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    if (e.stdout) return e.stdout;
    throw e;
  }
}

/** Every GHSA id attached to a vulnerability entry. */
function advisoryIds(vuln) {
  const ids = new Set();
  for (const via of vuln.via ?? []) {
    if (typeof via === 'object' && via.url) {
      const match = /(GHSA-[a-z0-9-]+)/i.exec(via.url);
      if (match) ids.add(match[1]);
    }
  }
  return ids;
}

const report = JSON.parse(runAudit());
const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
const allowed = new Map(allowlist.allow.map((entry) => [entry.advisory, entry]));
const usedAllowances = new Set();

const blocking = [];
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  if (SEVERITY_ORDER.indexOf(vuln.severity) < minSeverity) continue;

  const ids = advisoryIds(vuln);
  const unexcused = [...ids].filter((id) => !allowed.has(id));
  for (const id of ids) if (allowed.has(id)) usedAllowances.add(id);

  // Only excused when every advisory behind it is individually excused.
  if (ids.size > 0 && unexcused.length === 0) continue;
  blocking.push({ name, severity: vuln.severity, ids: [...ids], unexcused });
}

const problems = [];

if (blocking.length > 0) {
  problems.push(`${blocking.length} unexcused advisory group(s) at ${threshold}+:`);
  for (const b of blocking) {
    problems.push(`  ${b.severity.toUpperCase()} ${b.name} — ${b.unexcused.join(', ') || '(no GHSA id)'}`);
  }
  problems.push('  Fix them, or add a justified entry to .audit-allowlist.json.');
}

const stale = [...allowed.keys()].filter((id) => !usedAllowances.has(id));
if (stale.length > 0) {
  problems.push(`${stale.length} stale allowlist entr(ies) — the advisory is gone, delete them:`);
  for (const id of stale) problems.push(`  ${id} (${allowed.get(id).package})`);
}

const today = new Date().toISOString().slice(0, 10);
const expired = allowlist.allow.filter((e) => e.reviewBy && e.reviewBy < today);
if (expired.length > 0) {
  problems.push(`${expired.length} allowlist entr(ies) past review date — re-assess or extend:`);
  for (const e of expired) problems.push(`  ${e.advisory} (${e.package}) due ${e.reviewBy}`);
}

if (problems.length > 0) {
  console.error('npm audit gate FAILED\n');
  console.error(problems.join('\n'));
  process.exit(1);
}

const counts = report.metadata?.vulnerabilities ?? {};
console.log(
  `npm audit gate passed at ${threshold}+ ` +
    `(${allowlist.allow.length} documented exception(s); ` +
    `below threshold: ${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low)`,
);
