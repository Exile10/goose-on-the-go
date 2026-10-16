/**
 * An issue is reached only through its id, so one whose text is missing or that never applies is
 * a row nobody can see or a page that renders keys.
 */

import { SETTINGS_ISSUES } from '@/constants/settings-issues';
import i18n from '@/services/i18n';
import { activeIssues, factValue, type IssueContext, type SettingsIssue } from '@/models/settings-issues';

const lookup = i18n.t as unknown as (key: string) => string;
const ctx: IssueContext = { insecureDevMode: true, serverUrl: 'http://192.168.1.9:4080' };

describe('the issue catalogue', () => {
  const issues = Object.entries(SETTINGS_ISSUES);

  it('files each issue under its own id', () => {
    expect(issues.filter(([id, issue]) => id !== issue.id)).toEqual([]);
  });

  it('resolves every piece of text it names', () => {
    const keys = issues.flatMap(([, issue]) => [
      issue.titleKey,
      issue.rowKey,
      issue.summaryKey,
      issue.facts?.titleKey,
      ...(issue.facts?.rows.flatMap((f) => [f.labelKey, typeof f.value === 'string' ? f.value : undefined]) ?? []),
      ...issue.sections.flatMap((s) => [s.titleKey, s.footerKey, ...s.lines]),
      issue.action?.labelKey,
    ]);
    expect(keys.filter((k): k is NonNullable<typeof k> => !!k).filter((k) => lookup(k) === k)).toEqual([]);
  });

  it('raises the insecure connection only in insecure development mode', () => {
    expect(SETTINGS_ISSUES.insecureConnection.active(ctx)).toBe(true);
    expect(SETTINGS_ISSUES.insecureConnection.active({ ...ctx, insecureDevMode: false })).toBe(false);
  });
});

describe('choosing what to show', () => {
  const issue = (id: string, tone: SettingsIssue['tone'], on = true) =>
    ({ ...SETTINGS_ISSUES.insecureConnection, id, tone, active: () => on }) as unknown as SettingsIssue;

  it('lists only what applies, the most serious first', () => {
    const shown = activeIssues([issue('a', 'info'), issue('b', 'warning'), issue('c', 'danger', false), issue('d', 'danger')], ctx);
    expect(shown.map((i) => i.id)).toEqual(['d', 'b', 'a']);
  });

  it('reads a fact from the context, and leaves out one it has no answer for', () => {
    const address = SETTINGS_ISSUES.insecureConnection.facts!.rows[0];
    expect(factValue(address, ctx, lookup)).toBe('http://192.168.1.9:4080');
    expect(factValue(address, { ...ctx, serverUrl: '' }, lookup)).toBeNull();
  });
});
