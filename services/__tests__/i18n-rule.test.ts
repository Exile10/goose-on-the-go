/**
 * @jest-environment node
 *
 * The literal-string rule, run for real with this repository's config.
 *
 * The rule looked enforced and was not. `eslint-plugin-i18next` skips every string inside a
 * variable whose name is all capitals, and this codebase keeps its copy in exactly such constants,
 * so about seventy strings passed a rule described as covering the whole surface. Nothing noticed,
 * because no test ever asked the rule what it would flag. This one does, so a plugin upgrade or a
 * tidy-up that drops the wrapper in `eslint.config.js` fails here rather than in a screenshot.
 */
import { spawnSync } from 'child_process';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const ESLINT_BIN = path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');

/**
 * What the real ESLint command line flags in `code`, as if it were a screen file.
 *
 * A child process rather than ESLint's API, on purpose. Inside Jest's module system the plugin's
 * rule arrives without its `meta` -- Jest intercepts even `createRequire` -- so an in-process run
 * checks a different rule from the one `npx eslint` and CI run. This is that command.
 */
function flagged(code: string): string[] {
  const run = spawnSync(
    process.execPath,
    [ESLINT_BIN, '--stdin', '--stdin-filename', path.join(ROOT, 'app/(stack)/rule-probe.tsx'), '-f', 'json'],
    { cwd: ROOT, input: code, encoding: 'utf8' },
  );
  if (!run.stdout) throw new Error(`eslint produced no report: ${run.stderr}`);
  const [result] = JSON.parse(run.stdout) as { messages: { ruleId: string | null; message: string }[] }[];
  return result.messages.filter((m) => m.ruleId === 'i18next/no-literal-string').map((m) => m.message);
}

it('flags copy inside an all-caps constant, as it does inside any other', () => {
  const messages = flagged(
    "export const SECTIONS = [{ id: 'a', title: 'Where your data lives' }];\n" +
      "export const HEADLINE = 'Access your Pond from anywhere';\n",
  );
  expect(messages).toHaveLength(2);
}, 60_000);

// Closing the hole must not start flagging constants that are not copy, or the rule becomes one
// people switch off.
it('still leaves identifiers, paths and colours alone', () => {
  const messages = flagged(
    "export const ROUTE = '/api/v1/devices';\n" +
      "export const STORAGE_KEY = 'connection.profile';\n" +
      "export const ACCENT = '#8C4BFF';\n",
  );
  expect(messages).toEqual([]);
}, 60_000);
