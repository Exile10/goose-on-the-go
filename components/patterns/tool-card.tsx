/**
 * ToolTrail — what Goose did on the way to its answer, under it.
 *
 * Two shapes. A tool whose answer is a fact a person wants to see — the
 * weather, the devices it found, the time, the article it read — draws that
 * fact, from the card the tool itself described (`ui.card_type` on the live
 * stream). Everything else is a chip: the tool's name, whether it is still
 * running, and its raw answer one tap away, because that answer was written
 * for the model and is best kept out of the reader's way until asked for.
 *
 * It all lies flat on a hairline under the answer, which is what the turn is
 * for; a tool card wearing the plate would outrank it. A reopened conversation
 * has no card hints — the Pond strips them before saving — so its tools come
 * back as chips, with the text their card would have drawn from.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { InkEdge, InkEyebrow, inkText, useInkTheme } from '@jarida/ink/native';

import { LongTaskCard } from '@/components/patterns/long-task-card';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { humanizeTool, sourcesOf, toolIcon, toolWords } from '@/constants/tools';
import type { ToolCall } from '@/models/chat';
import { startedTaskId } from '@/models/long-tasks';
import { selectionTick } from '@/services/haptics';

/** How much of a raw tool answer a chip shows when opened: the desktop's 300. */
const RESULT_PREVIEW = 300;

type Data = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A tool's answer without the Pond's trailing source line, which draws as a link. */
function bodyOf(result: string | undefined): string {
  return (result ?? '').replace(/\n+Source:\s*\S+\s*$/i, '').trim();
}

function Weather({ data }: { data: Data }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const temp = num(data.temperature);
  const feels = num(data.feels_like);
  const humidity = num(data.humidity);
  const wind = num(data.wind_speed);
  const big = inkText(theme, { role: 'display', size: '3xl', weight: theme.weight.bold, tracking: 'title', leading: 'tight' });
  const line = inkText(theme, { size: 'md', weight: theme.weight.semibold });
  const meta = inkText(theme, { role: 'mono', size: 'xs', color: theme.color.textTertiary });
  const facts = [
    feels !== null ? t('chat.tools.feelsLike', { value: Math.round(feels) }) : '',
    humidity !== null ? t('chat.tools.humidity', { value: Math.round(humidity) }) : '',
    wind !== null ? t('chat.tools.wind', { value: Math.round(wind) }) : '',
  ].filter(Boolean);
  return (
    <View style={styles.cardBody}>
      <InkEyebrow>{str(data.location) || t('chat.tools.weather')}</InkEyebrow>
      <View style={styles.row}>
        <GIcon name={data.is_day === false ? 'moon' : 'sun'} size={28} color={theme.color.text} />
        {temp !== null ? <Text style={big.style}>{`${Math.round(temp)}°`}</Text> : null}
        <Text style={[line.style, styles.shrink]}>{str(data.condition)}</Text>
      </View>
      {facts.length > 0 ? <Text style={meta.style}>{facts.join(' · ')}</Text> : null}
    </View>
  );
}

function Devices({ data }: { data: Data }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const devices = (Array.isArray(data.devices) ? data.devices : []) as Data[];
  const online = devices.filter((d) => d.is_online === true).length;
  const name = inkText(theme, { size: 'base', weight: theme.weight.semibold });
  const meta = inkText(theme, { role: 'mono', size: 'xs', color: theme.color.textTertiary });
  return (
    <View style={styles.cardBody}>
      <InkEyebrow>
        {t('chat.tools.devicesSummary', { online, offline: devices.length - online })}
      </InkEyebrow>
      {devices.slice(0, 4).map((d, i) => (
        <View key={`${str(d.name)}-${i}`} style={styles.row}>
          <View
            style={[
              styles.dot,
              { backgroundColor: d.is_online === true ? theme.color.success : theme.color.textDisabled },
            ]}
          />
          <Text style={[name.style, styles.shrink]} numberOfLines={1}>
            {str(d.name)}
          </Text>
          <Text style={meta.style} numberOfLines={1}>
            {str(d.room)}
          </Text>
        </View>
      ))}
      {devices.length > 4 ? (
        <Text style={meta.style}>{t('chat.tools.more', { count: devices.length - 4 })}</Text>
      ) : null}
    </View>
  );
}

function Clock({ data }: { data: Data }) {
  const theme = useInkTheme();
  const big = inkText(theme, { role: 'display', size: '3xl', weight: theme.weight.bold, tracking: 'title', leading: 'tight' });
  const meta = inkText(theme, { role: 'mono', size: 'xs', color: theme.color.textTertiary });
  return (
    <View style={styles.cardBody}>
      <Text style={big.style}>{str(data.time)}</Text>
      <Text style={meta.style}>{[str(data.date), str(data.timezone)].filter(Boolean).join(' · ')}</Text>
    </View>
  );
}

function Article({ data }: { data: Data }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const title = inkText(theme, { role: 'display', size: 'md', weight: theme.weight.bold, tracking: 'snug' });
  const body = inkText(theme, { size: 'base', color: theme.color.textSecondary });
  const summary = str(data.summary) || str(data.primary);
  const heading = str(data.title) || str(data.primary_title) || str(data.query);
  return (
    <View style={styles.cardBody}>
      <InkEyebrow>{t(data.pods ? 'chat.tools.computed' : 'chat.tools.wikipedia')}</InkEyebrow>
      {heading ? <Text style={title.style}>{heading}</Text> : null}
      {summary ? (
        <Text style={body.style} numberOfLines={4}>
          {summary}
        </Text>
      ) : null}
    </View>
  );
}

function Memories({ data }: { data: Data }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const memories = (Array.isArray(data.memories) ? data.memories : []) as Data[];
  const body = inkText(theme, { size: 'base', color: theme.color.textSecondary });
  return (
    <View style={styles.cardBody}>
      <InkEyebrow>{t('chat.tools.recalled', { count: memories.length })}</InkEyebrow>
      {memories.slice(0, 3).map((m, i) => (
        <Text key={i} style={body.style} numberOfLines={2}>
          {str(m.content)}
        </Text>
      ))}
    </View>
  );
}

const CARDS: Record<string, React.ComponentType<{ data: Data }>> = {
  weather: Weather,
  devices: Devices,
  time: Clock,
  knowledge: Article,
  wolfram: Article,
  memory: Memories,
};

/** A finished tool that asked to be drawn as a card this app knows how to draw. */
const hasFact = (tool: ToolCall) => Boolean(tool.card && tool.status !== 'running' && CARDS[tool.card.type]);

const expandable = (tool: ToolCall) => tool.status !== 'running' && bodyOf(tool.result).length > 0;

const FactCard = React.memo(function FactCard({ tool }: { tool: ToolCall }) {
  const theme = useInkTheme();
  const Card = tool.card && tool.status !== 'running' ? CARDS[tool.card.type] : undefined;
  if (!Card || !tool.card) return null;
  return (
    <InkEdge raised={false} budgeted={false} radius={theme.radius.lg} contentStyle={styles.card}>
      <Card data={tool.card.data} />
    </InkEdge>
  );
});

// A running tool is drawn dimmed, not spun: the composer's line already says the turn is alive.
function ToolChip({ tool, open, onToggle }: { tool: ToolCall; open: boolean; onToggle: () => void }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const words = toolWords(tool.name);
  const label = words ? t(words.label) : humanizeTool(tool.name);
  const running = tool.status === 'running';
  const failed = tool.status === 'error';
  const canOpen = expandable(tool);
  const ink = running ? theme.color.textTertiary : theme.color.textSecondary;
  const text = inkText(theme, { role: 'mono', size: 'xs', weight: theme.weight.medium, color: ink });
  return (
    <GPressable
      feedback="tint"
      disabled={!canOpen}
      onPress={() => {
        void selectionTick();
        onToggle();
      }}
      accessibilityRole={canOpen ? 'button' : 'text'}
      accessibilityLabel={
        running ? t('chat.tools.runningLabel', { tool: label }) : failed ? t('chat.tools.failedLabel', { tool: label }) : label
      }
      accessibilityState={canOpen ? { expanded: open } : undefined}
      style={[
        styles.chip,
        {
          borderColor: theme.color.lineStrong,
          borderWidth: theme.edge.hairlineWidth,
          borderRadius: theme.radius.md,
          backgroundColor: open ? theme.color.neutralSoft : undefined,
        },
      ]}
    >
      <GIcon name={failed ? 'warn' : toolIcon(tool.name)} size={13} color={failed ? theme.color.dangerFg : ink} />
      <Text style={text.style} numberOfLines={1}>
        {label}
      </Text>
      {canOpen ? <GIcon name={open ? 'chevron' : 'chevron-right'} size={12} color={theme.color.textTertiary} /> : null}
    </GPressable>
  );
}

function ResultPanel({ tool }: { tool: ToolCall }) {
  const theme = useInkTheme();
  const body = bodyOf(tool.result);
  const text = inkText(theme, { role: 'mono', size: 'xs', color: theme.color.textSecondary });
  return (
    <View
      style={[
        styles.result,
        { borderColor: theme.color.line, borderWidth: theme.edge.hairlineWidth, borderRadius: theme.radius.md },
      ]}
    >
      <Text style={text.style} selectable>
        {body.length > RESULT_PREVIEW ? `${body.slice(0, RESULT_PREVIEW).trimEnd()}…` : body}
      </Text>
    </View>
  );
}

/** Enough to judge where an answer came from without a search's whole first page. */
const SOURCES_SHOWN = 3;

/** The pages a reply read from, each one a tap away from the in-app browser. */
function Sources({ tools }: { tools: ToolCall[] }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const sources = sourcesOf(tools);
  if (sources.length === 0) return null;
  const shown = all ? sources : sources.slice(0, SOURCES_SHOWN);
  const title = inkText(theme, { size: 'base', weight: theme.weight.semibold, leading: 'snug' });
  const site = inkText(theme, { role: 'mono', size: 'xs', color: theme.color.textTertiary });
  const more = inkText(theme, { size: 'sm', weight: theme.weight.medium, color: theme.color.accentLine });
  const rule = { borderTopWidth: theme.edge.hairlineWidth, borderTopColor: theme.color.line };
  return (
    <InkEdge raised={false} budgeted={false} radius={theme.radius.lg} contentStyle={styles.sourceCard}>
      <View style={styles.sourceHead}>
        <InkEyebrow>{t('chat.tools.sources')}</InkEyebrow>
      </View>
      {shown.map((s, i) => (
        <GPressable
          key={s.url}
          feedback="tint"
          onPress={() => void WebBrowser.openBrowserAsync(s.url)}
          accessibilityRole="link"
          accessibilityLabel={t('chat.tools.openSource', { source: s.title })}
          style={[styles.source, i > 0 ? rule : null]}
        >
          <View style={styles.sourceText}>
            <Text style={title.style} numberOfLines={2}>
              {s.title}
            </Text>
            {s.site !== s.title ? (
              <Text style={site.style} numberOfLines={1}>
                {s.site}
              </Text>
            ) : null}
          </View>
          <GIcon name="external" size={13} color={theme.color.textTertiary} />
        </GPressable>
      ))}
      {!all && sources.length > SOURCES_SHOWN ? (
        <Pressable
          onPress={() => {
            void selectionTick();
            setAll(true);
          }}
          accessibilityRole="button"
          style={[styles.source, rule]}
        >
          <Text style={more.style}>{t('chat.tools.moreSources', { count: sources.length - SOURCES_SHOWN })}</Text>
        </Pressable>
      ) : null}
    </InkEdge>
  );
}

/**
 * Everything under an answer, most useful first: the facts a tool drew, the
 * pages it read, then a chip for each step. A chip's raw answer opens below the
 * row at full width, not inside the chip's own narrow column.
 */
export const ToolTrail = React.memo(function ToolTrail({ tools, done }: { tools: ToolCall[]; done: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // A long task the turn started is followed live in place of its chip.
  const tasks = tools.flatMap((tool) => {
    const taskId = startedTaskId(tool);
    return taskId ? [{ call: tool.id, taskId }] : [];
  });
  const chips = tools.filter((tool) => !hasFact(tool) && !tasks.some((task) => task.call === tool.id));
  const open = chips.find((tool) => tool.id === openId && expandable(tool));
  return (
    <View style={styles.trail}>
      {tasks.map((task) => (
        <LongTaskCard key={task.call} taskId={task.taskId} callId={task.call} />
      ))}
      {tools.map((tool) => (
        <FactCard key={tool.id} tool={tool} />
      ))}
      {done ? <Sources tools={tools} /> : null}
      {chips.length > 0 ? (
        <View style={styles.chips}>
          {chips.map((tool) => (
            <ToolChip
              key={tool.id}
              tool={tool}
              open={tool.id === open?.id}
              onToggle={() => setOpenId((id) => (id === tool.id ? null : tool.id))}
            />
          ))}
        </View>
      ) : null}
      {open ? <ResultPanel tool={open} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  trail: { gap: 8, marginTop: 2 },
  card: { padding: 14 },
  cardBody: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shrink: { flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  result: { padding: 10 },
  sourceCard: { paddingVertical: 4 },
  sourceHead: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 2 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  sourceText: { flex: 1, gap: 2 },
});
