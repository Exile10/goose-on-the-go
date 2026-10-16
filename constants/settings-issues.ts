/**
 * Every issue Settings can raise. Keys only, like `settings-pages.ts`, so `t()` runs at render time
 * and a key that does not exist fails to compile.
 */

import type { IssueId, SettingsIssue } from '@/models/settings-issues';

const insecureConnection: SettingsIssue = {
  id: 'insecureConnection',
  tone: 'danger',
  icon: 'warn',
  titleKey: 'settings.issue.insecureConnection.title',
  rowKey: 'settings.issue.insecureConnection.row',
  summaryKey: 'settings.issue.insecureConnection.summary',
  facts: {
    titleKey: 'settings.issue.insecureConnection.connection',
    rows: [
      { labelKey: 'settings.issue.insecureConnection.address', value: (ctx) => ctx.serverUrl || null },
      { labelKey: 'settings.issue.insecureConnection.encryption', value: 'settings.issue.insecureConnection.none' },
      { labelKey: 'settings.issue.insecureConnection.identity', value: 'settings.summary.off' },
    ],
  },
  sections: [
    {
      titleKey: 'settings.issue.insecureConnection.exposure',
      lines: [
        'settings.issue.insecureConnection.read',
        'settings.issue.insecureConnection.replay',
        'settings.issue.insecureConnection.pretend',
      ],
      footerKey: 'settings.issue.insecureConnection.exposureFooter',
    },
    { titleKey: 'settings.issue.insecureConnection.why', lines: ['settings.issue.insecureConnection.whyBody'] },
    { titleKey: 'settings.issue.insecureConnection.off', lines: ['settings.issue.insecureConnection.offBody'] },
  ],
  active: (ctx) => ctx.insecureDevMode,
};

export const SETTINGS_ISSUES: Record<IssueId, SettingsIssue> = {
  insecureConnection,
};
