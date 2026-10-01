/**
 * ToolCard — one thing Goose did on the way to its answer.
 *
 * Two shapes. A tool whose answer is a fact a person wants to see — the
 * weather, the devices it found, the time, the article it read — draws that
 * fact, from the card the tool itself described (`ui.card_type` on the live
 * stream). Everything else is a chip: the tool's name, whether it is still
 * running, and its raw answer one tap away, because that answer was written
 * for the model and is best kept out of the reader's way until asked for.
 *
 * Cards lie flat on a hairline. The answer below them is what the turn is
 * for; a tool card wearing the plate would outrank it. A reopened conversation
 * has no card hints — the Pond strips them before saving — so its tools come
 * back as chips, with the text their card would have drawn from.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { InkEdge, InkEyebrow, InkSpinner, inkText, useInkTheme } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { humanizeTool, sourcesOf, toolIcon, toolWords } from '@/constants/tools';
import type { ToolCall } from '@/models/chat';
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

export const ToolCard = React.memo(function ToolCard({ tool }: { tool: ToolCall }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const words = toolWords(tool.name);
  const label = words ? t(words.label) : humanizeTool(tool.name);
  const Card = tool.card ? CARDS[tool.card.type] : undefined;

  if (Card && tool.card && tool.status !== 'running') {
    return (
      <InkEdge raised={false} budgeted={false} radius={theme.radius.lg} contentStyle={styles.card}>
        <Card data={tool.card.data} />
      </InkEdge>
    );
  }

  const body = bodyOf(tool.result);
  const expandable = tool.status !== 'running' && body.length > 0;
  const chipText = inkText(theme, { role: 'mono', size: 'xs', weight: theme.weight.medium, color: theme.color.textSecondary });
  const resultText = inkText(theme, { role: 'mono', size: 'xs', color: theme.color.textSecondary });

  return (
    <View style={styles.chipWrap}>
      <GPressable
        feedback="tint"
        disabled={!expandable}
        onPress={() => {
          void selectionTick();
          setOpen((o) => !o);
        }}
        accessibilityRole={expandable ? 'button' : 'text'}
        accessibilityLabel={
          tool.status === 'running'
            ? t('chat.tools.runningLabel', { tool: label })
            : tool.status === 'error'
              ? t('chat.tools.failedLabel', { tool: label })
              : label
        }
        accessibilityState={expandable ? { expanded: open } : undefined}
        style={[
          styles.chip,
          {
            borderColor: theme.color.lineStrong,
            borderWidth: theme.edge.hairlineWidth,
            borderRadius: theme.radius.md,
          },
        ]}
      >
        {tool.status === 'running' ? (
          <InkSpinner label={label} size={12} />
        ) : (
          <GIcon
            name={tool.status === 'error' ? 'warn' : toolIcon(tool.name)}
            size={13}
            color={tool.status === 'error' ? theme.color.dangerFg : theme.color.textSecondary}
          />
        )}
        <Text style={chipText.style} numberOfLines={1}>
          {label}
        </Text>
        {expandable ? (
          <GIcon name={open ? 'chevron' : 'chevron-right'} size={12} color={theme.color.textTertiary} />
        ) : null}
      </GPressable>
      {open && expandable ? (
        <View
          style={[
            styles.result,
            { borderColor: theme.color.line, borderWidth: theme.edge.hairlineWidth, borderRadius: theme.radius.md },
          ]}
        >
          <Text style={resultText.style} selectable>
            {body.length > RESULT_PREVIEW ? `${body.slice(0, RESULT_PREVIEW).trimEnd()}…` : body}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

/** The pages a reply read from, as chips under it: the first, and how many more. */
export function SourceChips({ tools }: { tools: ToolCall[] | undefined }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const sources = sourcesOf(tools);
  if (sources.length === 0) return null;
  const shown = all ? sources : sources.slice(0, 1);
  const text = inkText(theme, { role: 'mono', size: 'xs', weight: theme.weight.medium, color: theme.color.textSecondary });
  const chip = {
    borderColor: theme.color.lineStrong,
    borderWidth: theme.edge.hairlineWidth,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.chrome,
  };
  return (
    <View style={styles.sources}>
      {shown.map((s) => (
        <GPressable
          key={s.url}
          feedback="tint"
          onPress={() => void WebBrowser.openBrowserAsync(s.url)}
          accessibilityRole="link"
          accessibilityLabel={t('chat.tools.openSource', { source: s.label })}
          style={[styles.source, chip]}
        >
          <GIcon name="globe" size={12} color={theme.color.textSecondary} />
          <Text style={text.style} numberOfLines={1}>
            {s.label}
          </Text>
        </GPressable>
      ))}
      {!all && sources.length > 1 ? (
        <Pressable
          onPress={() => setAll(true)}
          accessibilityRole="button"
          accessibilityLabel={t('chat.tools.moreSources', { count: sources.length - 1 })}
          style={[styles.source, chip]}
        >
          <Text style={text.style}>{`+${sources.length - 1}`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14 },
  cardBody: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shrink: { flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipWrap: { alignSelf: 'flex-start', gap: 6, maxWidth: '100%' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  result: { padding: 10 },
  sources: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  source: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
});
