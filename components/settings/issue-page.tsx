/**
 * One issue as a page: what it is, the facts behind it, what it means, and the way to put it right
 * when there is one. Every issue in `constants/settings-issues.ts` renders through this.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton } from '@/components/ui/ink';

import { Spacing } from '@/constants/spacing';
import { factValue, ISSUE_TILES, type IssueContext, type SettingsIssue } from '@/models/settings-issues';
import { selectionTick } from '@/services/haptics';
import { SettingsGroup, SettingsHeader, SettingsRow, TILE_INSET } from './settings-list';
import { SettingsScroll } from './settings-scroll';
import { useSettingsColors } from './settings-theme';

export function IssuePage({ issue, ctx }: { issue: SettingsIssue; ctx: IssueContext }) {
  const { t } = useTranslation();
  const router = useRouter();
  const facts = issue.facts?.rows.flatMap((fact) => {
    const value = factValue(fact, ctx, t);
    return value === null ? [] : [{ label: t(fact.labelKey), value }];
  });

  return (
    <SettingsScroll>
      <SettingsHeader icon={issue.icon} tile={ISSUE_TILES[issue.tone]} title={t(issue.titleKey)} description={t(issue.summaryKey)} />

      {issue.facts && facts && facts.length > 0 ? (
        <SettingsGroup title={t(issue.facts.titleKey)}>
          {facts.map((f) => (
            <SettingsRow key={f.label} label={f.label} value={f.value} />
          ))}
        </SettingsGroup>
      ) : null}

      {issue.sections.map((section, i) => (
        <SettingsGroup
          key={section.titleKey ?? i}
          title={section.titleKey ? t(section.titleKey) : null}
          footer={section.footerKey ? t(section.footerKey) : null}
        >
          {section.lines.map((line) => (
            <SettingsRow key={line} label={t(line)} />
          ))}
        </SettingsGroup>
      ))}

      {issue.action ? (
        <View style={styles.action}>
          <InkButton
            onPress={() => {
              void selectionTick();
              router.push(issue.action!.route);
            }}
          >
            {t(issue.action.labelKey)}
          </InkButton>
        </View>
      ) : null}
    </SettingsScroll>
  );
}

/** The issues at the top of Settings, each with the dot that its tab carries too. */
export function IssueRows({ issues }: { issues: readonly SettingsIssue[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  if (issues.length === 0) return null;
  return (
    <SettingsGroup inset={TILE_INSET}>
      {issues.map((issue) => (
        <SettingsRow
          key={issue.id}
          label={t(issue.titleKey)}
          description={t(issue.rowKey)}
          icon={issue.icon}
          tile={ISSUE_TILES[issue.tone]}
          accessory="next"
          trailing={<IssueDot tone={issue.tone} />}
          onPress={() => {
            void selectionTick();
            router.push({ pathname: '/(stack)/settings-issue', params: { id: issue.id } });
          }}
        />
      ))}
    </SettingsGroup>
  );
}

export function IssueDot({ tone = 'danger' }: { tone?: SettingsIssue['tone'] }) {
  const colors = useSettingsColors();
  return <View style={[styles.dot, { backgroundColor: tone === 'info' ? colors.accent : colors.danger }]} />;
}

const styles = StyleSheet.create({
  action: { marginTop: Spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
