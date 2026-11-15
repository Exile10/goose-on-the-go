/**
 * What Goose thought and noted on the way to an answer, tucked into one line at the top of the
 * reply. While it thinks, the line is the newest of its thinking, cut from the front so the words
 * arriving stay in view, beside the goose bobbing on a pond that ripples while the turn runs; while
 * a tool runs, it names the tool. Before either comes, the line is a quip, so the wait still reads
 * as alive. Once the reply is done it settles to "Thoughts". A tap opens the whole of it, the
 * thinking and then the steps, and closes it again.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { inkText, useInkTheme } from '@/components/ui/ink';

import { Markdown } from '@/components/patterns/markdown';
import { PondRipple } from '@/components/patterns/pond-ripple';
import { ThinkingQuips } from '@/components/patterns/thinking-quips';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import type { ToolCall } from '@/models/chat';
import { selectionTick } from '@/services/haptics';

/** The thinking as one text: the Pond streams it in pieces, which run on from each other. */
export function thoughtOf(thinking: string[] | undefined): string {
  return (thinking ?? []).join('').trim();
}

/**
 * A tool as the line names it: its whole name with `_` and `-` read as spaces, in lower case for the
 * sentence it sits in, and the Pond's own servers (`giap-…`) called the Pond.
 */
export function toolPhrase(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/giap/gi, 'pond')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The line a thought is tucked into: its newest line, without the marks of markdown. */
export function lastLine(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/^[#>\s*-]+/, '').replace(/[*_`]/g, '').trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

export function ReplyThoughts({
  thinking,
  steps,
  tools,
  live,
  waiting,
  seed,
}: {
  thinking?: string[];
  steps?: string[];
  /** The reply's tool calls; one still running names itself on the line. */
  tools?: ToolCall[];
  /** The turn is still running. */
  live: boolean;
  /** Nothing of the answer has come yet, which is when a quip holds the line. */
  waiting: boolean;
  seed: number;
}) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const thought = thoughtOf(thinking);
  const notes = steps?.filter((step) => step.trim()) ?? [];
  const running = live ? [...(tools ?? [])].reverse().find((tool) => tool.status === 'running') : undefined;
  const line = !live
    ? thought || notes.length
      ? t('chat.thoughts.done')
      : ''
    : running
      ? t('chat.thoughts.usingTool', { tool: toolPhrase(running.name) })
      : lastLine(thought) || lastLine(notes[notes.length - 1] ?? '');
  const quipping = live && waiting && !line;
  if (!line && !quipping) return null;

  const text = inkText(theme, { size: 'sm', color: theme.color.textSecondary });
  if (quipping) {
    return (
      <View style={styles.line}>
        <PondRipple live />
        <View style={styles.words}>
          <ThinkingQuips status={null} seed={seed} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.block}>
      <GPressable
        feedback="tint"
        onPress={() => {
          void selectionTick();
          setOpen((value) => !value);
        }}
        accessibilityRole="button"
        accessibilityLabel={t('chat.thoughts.label')}
        accessibilityHint={line}
        accessibilityState={{ expanded: open, busy: live }}
        style={styles.line}
      >
        <PondRipple live={live} />
        <Text
          style={[text.style, styles.words, styles.italic]}
          numberOfLines={1}
          // While it is written, the newest words are the ones to see.
          ellipsizeMode={live && !running ? 'head' : 'tail'}
        >
          {line}
        </Text>
        <GIcon name={open ? 'chevron' : 'chevron-right'} size={12} color={theme.color.textTertiary} />
      </GPressable>
      {open ? (
        <View style={[styles.opened, { borderLeftColor: theme.color.line }]}>
          {thought ? <Markdown source={thought} size="xs" tone="tertiary" /> : null}
          {notes.map((step, i) => (
            <Markdown key={i} source={step} size="xs" tone="tertiary" />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30 },
  words: { flex: 1 },
  // A synthesised oblique, as the quips have: Quicksand has no italic face, and here the slant is a tone of voice.
  italic: { fontStyle: 'italic' },
  opened: { gap: 8, borderLeftWidth: 2, paddingLeft: 12, marginLeft: 10 },
});
