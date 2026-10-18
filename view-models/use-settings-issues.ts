/**
 * The issues that apply right now, for the top of Settings and the dot on its tab. Read from what
 * the phone already holds, so the tab bar can ask on every render without reaching the Pond.
 */

import { useMemo } from 'react';

import { SETTINGS_ISSUES } from '@/constants/settings-issues';
import { activeIssues, type IssueContext, type SettingsIssue } from '@/models/settings-issues';
import { useServer } from '@/providers/server-provider';
import { insecureDevMode } from '@/services/dev-mode';

export function useIssueContext(): IssueContext {
  const { serverUrl } = useServer();
  return useMemo(() => ({ insecureDevMode, serverUrl }), [serverUrl]);
}

export function useSettingsIssues(): SettingsIssue[] {
  const ctx = useIssueContext();
  return useMemo(() => activeIssues(Object.values(SETTINGS_ISSUES), ctx), [ctx]);
}
