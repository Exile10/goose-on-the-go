/**
 * Something about the Pond or this phone that a household should know about, listed at the top of
 * Settings and opened as a page of its own. Each one is data, so a new one is an entry in
 * `constants/settings-issues.ts` and not a new screen.
 */

import type { Href } from 'expo-router';

import type { TileColor } from '@/constants/colors';
import type { IconName } from '@/constants/icons';
import type { TranslationKey } from '@/services/i18n';

export type IssueId = 'insecureConnection';

/** How much it matters: `danger` puts something at risk, `warning` stops something working. */
export type IssueTone = 'danger' | 'warning' | 'info';

/** What an issue may read to decide whether it applies, and to fill in its facts. */
export interface IssueContext {
  insecureDevMode: boolean;
  serverUrl: string;
}

export interface IssueFact {
  labelKey: TranslationKey;
  /** A fixed answer, or one read from the context; null leaves the row out. */
  value: TranslationKey | ((ctx: IssueContext) => string | null);
}

export interface IssueSection {
  titleKey?: TranslationKey;
  /** One row each: a list of short points, or a single paragraph. */
  lines: TranslationKey[];
  footerKey?: TranslationKey;
}

export interface IssueAction {
  labelKey: TranslationKey;
  route: Href;
}

export interface SettingsIssue {
  id: IssueId;
  tone: IssueTone;
  icon: IconName;
  titleKey: TranslationKey;
  /** One line under the title on the Settings row. */
  rowKey: TranslationKey;
  /** Under the title at the top of the page. */
  summaryKey: TranslationKey;
  facts?: { titleKey: TranslationKey; rows: IssueFact[] };
  sections: IssueSection[];
  /** Where to go to put it right, when the phone can. */
  action?: IssueAction;
  active: (ctx: IssueContext) => boolean;
}

export const ISSUE_TILES: Record<IssueTone, TileColor> = {
  danger: 'red',
  warning: 'amber',
  info: 'blue',
};

const TONE_ORDER: Record<IssueTone, number> = { danger: 0, warning: 1, info: 2 };

/** The issues that apply, the most serious first. */
export function activeIssues(all: readonly SettingsIssue[], ctx: IssueContext): SettingsIssue[] {
  return all.filter((issue) => issue.active(ctx)).sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}

/** A fact's answer, or null when the context has none to give. */
export function factValue(fact: IssueFact, ctx: IssueContext, t: (key: TranslationKey) => string): string | null {
  return typeof fact.value === 'function' ? fact.value(ctx) : t(fact.value);
}
