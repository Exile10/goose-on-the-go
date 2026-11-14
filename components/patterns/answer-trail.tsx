/**
 * How an answer was reached, folded into one small chip under it: the pages it read and the tools it
 * ran, which a reader wants now and then rather than every time. The chip names its one source or
 * tool, or counts them, and opens a sheet listing each page by site and title, and each tool with
 * its raw answer a tap away. A number in the answer's text opens the same sheet at its page.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { hitSlop } from '@jarida/ink';
import { InkSheet, inkText, useInkTheme } from '@jarida/ink/native';

import type { SourceChips } from '@/components/patterns/markdown';
import { ToolRow } from '@/components/patterns/tool-card';
import { SettingsGroup } from '@/components/settings/settings-list';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { Spacing } from '@/constants/spacing';
import { humanizeTool, siteName, toolWords } from '@/constants/tools';
import type { ToolCall } from '@/models/chat';
import type { CitedSource } from '@/models/sources';
import { selectionTick } from '@/services/haptics';

export interface TrailState {
  sources: CitedSource[];
  /** How the answer's text numbers its pages, and what a tap on a number does. */
  chips: SourceChips | undefined;
  /** Null while the sheet is shut; otherwise the page it was opened at, or '' for none. */
  focus: string | null;
  /** The sheet has been opened once, so it stays mounted to animate shut; most answers never open it. */
  mounted: boolean;
  openSheet: (at?: string) => void;
  closeSheet: () => void;
}

export function useTrail(sources: CitedSource[]): TrailState {
  const [focus, setFocus] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const openSheet = useCallback((at = '') => {
    void selectionTick();
    setMounted(true);
    setFocus(at);
  }, []);
  const closeSheet = useCallback(() => setFocus(null), []);
  const chips = useMemo<SourceChips | undefined>(() => {
    if (sources.length === 0) return undefined;
    return {
      numberOf: (url) => {
        const i = sources.findIndex((s) => s.url === url);
        return i === -1 ? undefined : i + 1;
      },
      open: (url) => openSheet(url),
    };
  }, [sources, openSheet]);
  return { sources, chips, focus, mounted, openSheet, closeSheet };
}

function toolLabel(tool: ToolCall, t: TFunction): string {
  const words = toolWords(tool.name);
  return words ? t(words.label) : humanizeTool(tool.name);
}

/** One page by its site, as a person names it; one tool by its name; more than one, counted. */
export function trailWords(sources: CitedSource[], tools: ToolCall[], t: TFunction): string {
  const pages =
    sources.length === 1
      ? (siteName(sources[0].url) ?? sources[0].title)
      : sources.length > 1
        ? t('chat.trail.sources', { count: sources.length })
        : null;
  const ran =
    tools.length === 1 ? toolLabel(tools[0], t) : tools.length > 1 ? t('chat.trail.tools', { count: tools.length }) : null;
  return pages && ran ? t('chat.trail.both', { sources: pages, tools: ran }) : (pages ?? ran ?? '');
}

/** The chip under an answer. A tool that did not finish marks it, so a failure is not folded out of sight. */
export function TrailChip({ state, tools }: { state: TrailState; tools: ToolCall[] }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  if (state.sources.length === 0 && tools.length === 0) return null;
  const running = tools.some((tool) => tool.status === 'running');
  const failed = tools.some((tool) => tool.status === 'error');
  const words = trailWords(state.sources, tools, t);
  const text = inkText(theme, {
    size: 'sm',
    weight: theme.weight.medium,
    color: running ? theme.color.textTertiary : theme.color.textSecondary,
  });
  return (
    <GPressable
      feedback="tint"
      onPress={() => state.openSheet()}
      accessibilityRole="button"
      accessibilityLabel={words}
      accessibilityHint={t('chat.trail.hint')}
      hitSlop={hitSlop(CHIP_HEIGHT)}
      style={[styles.chip, { backgroundColor: theme.color.neutralSoft, borderRadius: theme.radius.pill }]}
    >
      {failed ? <GIcon name="warn" size={13} color={theme.color.dangerFg} /> : null}
      <Text style={text.style} numberOfLines={1}>
        {words}
      </Text>
    </GPressable>
  );
}

/** A page in the sheet: its number as the answer's text gives it, its site, its title, and the way to it. */
function SourceRow({ source, number, focused }: { source: CitedSource; number: number; focused: boolean }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const site = siteName(source.url) ?? source.url;
  const siteOnly = source.title === site;
  const siteText = inkText(theme, { size: 'sm', color: theme.color.textSecondary });
  const title = inkText(theme, { size: 'md', weight: theme.weight.semibold, leading: 'snug' });
  const badge = inkText(theme, { role: 'mono', size: 'xs', weight: theme.weight.semibold, color: theme.color.accentLine });
  return (
    <Pressable
      onPress={() => void WebBrowser.openBrowserAsync(source.url)}
      accessibilityRole="link"
      accessibilityLabel={t('chat.trail.openPage', { title: source.title, site })}
      style={({ pressed }) => [styles.row, pressed || focused ? { backgroundColor: theme.color.neutralSoft } : null]}
    >
      <View style={styles.rowText}>
        <View style={styles.siteLine}>
          <View style={[styles.number, { borderColor: theme.color.lineStrong, borderRadius: theme.radius.xs }]}>
            <Text style={badge.style}>{number}</Text>
          </View>
          {/* A site kept without its page, as a web search's is, is named once. */}
          <Text style={[siteOnly ? title.style : siteText.style, styles.shrink]} numberOfLines={1}>
            {site}
          </Text>
        </View>
        {siteOnly ? null : (
          <Text style={title.style} numberOfLines={2}>
            {source.title}
          </Text>
        )}
      </View>
      <GIcon name="external" size={14} color={theme.color.textTertiary} />
    </Pressable>
  );
}

/** The pages and the tools, each in a group of its own, named when both are there. */
export function TrailSheet({ state, tools }: { state: TrailState; tools: ToolCall[] }) {
  const { t } = useTranslation();
  const { sources, focus, closeSheet } = state;
  const both = sources.length > 0 && tools.length > 0;
  const title = both
    ? t('chat.trail.titleBoth')
    : sources.length > 0
      ? t('chat.trail.titleSources')
      : t('chat.trail.titleTools');
  return (
    <InkSheet open={focus !== null} onClose={closeSheet} title={title}>
      {sources.length > 0 ? (
        <SettingsGroup title={both ? t('chat.trail.titleSources') : null} style={styles.group}>
          {sources.map((source, i) => (
            <SourceRow key={source.url} source={source} number={i + 1} focused={source.url === focus} />
          ))}
        </SettingsGroup>
      ) : null}
      {tools.length > 0 ? (
        <SettingsGroup title={both ? t('chat.trail.titleTools') : null} style={styles.group}>
          {tools.map((tool) => (
            <ToolRow key={tool.id} tool={tool} />
          ))}
        </SettingsGroup>
      ) : null}
      <View style={styles.foot} />
    </InkSheet>
  );
}

/** The chip's height: small enough to sit under a line of text as a footnote does. */
const CHIP_HEIGHT = 24;

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: CHIP_HEIGHT,
    paddingHorizontal: Spacing.md,
    maxWidth: '100%',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  rowText: { flex: 1, gap: 2 },
  siteLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  number: { minWidth: 18, height: 18, paddingHorizontal: 3, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  shrink: { flexShrink: 1 },
  // The sheet spaces its own children; a settings page's gap under each group would double it.
  group: { marginBottom: 0 },
  foot: { height: Spacing.xl },
});
