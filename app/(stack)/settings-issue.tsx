import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { IssuePage } from '@/components/settings/issue-page';
import { SETTINGS_ISSUES } from '@/constants/settings-issues';
import type { IssueId } from '@/models/settings-issues';
import { useIssueContext } from '@/view-models/use-settings-issues';

export default function SettingsIssueScreen() {
  const { id } = useLocalSearchParams<{ id: IssueId }>();
  const ctx = useIssueContext();
  const issue = id ? SETTINGS_ISSUES[id] : undefined;
  if (!issue) return null;
  return <IssuePage issue={issue} ctx={ctx} />;
}
