/**
 * MessageRow — one turn of the conversation.
 *
 * What a person said is a bubble, Ink's, with any pictures they sent above it.
 * What Goose said is not: it is the page's text, full width, set from the
 * markdown the model writes, the way pond-desktop sets a reply — a bubble
 * around every answer makes a long one a box to scroll inside. Below the
 * answer, what Goose did to reach it: the facts its tools drew, the pages it
 * read, and a chip for each step. While a reply has no words yet, the thinking
 * line holds its place. Once it has them, the turn can still be running — the
 * Pond can take another model pass after the words appear before it calls the
 * turn done — so the composer's glowing line keeps going until it does, with
 * the Pond's own status under the words when it gives one. Without it, a
 * message queued behind a finished-looking answer looks stuck.
 *
 * A message written while Goose was still answering sits at the foot of the
 * thread, where it will be asked, drawn as Ink's bubble in its sending state
 * with a note that it is queued and a way to take it back. pond-desktop marks
 * a queued message the same way, in place rather than in a tray, so the queue
 * is visible and not a silent buffer.
 */

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { InkBubble, inkText, useInkTheme, type BubblePosition } from '@jarida/ink/native';

import { Markdown } from '@/components/patterns/markdown';
import { ThinkingQuips } from '@/components/patterns/thinking-quips';
import { ToolTrail } from '@/components/patterns/tool-card';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { clockWords } from '@/components/patterns/voice-note-mic';
import type { ChatImage, ChatVoiceNote, Message } from '@/models/chat';
import { api } from '@/services/api-client';
import { selectionTick } from '@/services/haptics';
import { playFile } from '@/services/voice-io';

/** One picture on its own is shown large; several share a row. */
const SINGLE = 220;
const TILE = 104;

function Pictures({ images }: { images: ChatImage[] }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const single = images.length === 1;
  return (
    <View style={[styles.pictures, single ? null : styles.grid]}>
      {images.map((image, i) => {
        const ratio = image.width && image.height ? image.width / image.height : 1;
        const width = single ? SINGLE : TILE;
        const height = single ? Math.round(SINGLE / Math.max(0.5, Math.min(2, ratio))) : TILE;
        return (
          <Image
            key={image.id}
            source={image.local ? { uri: image.uri } : api.imageSource(image.uri)}
            style={{ width, height, borderRadius: theme.radius.lg, backgroundColor: theme.color.line }}
            contentFit="cover"
            transition={120}
            accessibilityLabel={t('chat.attachedPicture', { index: i + 1 })}
          />
        );
      })}
    </View>
  );
}

/** "Queued", and the way to take it back, under a message still waiting its turn. */
/** A voice note the person sent: played back from this phone, which is where it was recorded. */
function VoiceNoteChip({ note }: { note: ChatVoiceNote }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const [at, setAt] = useState<number | null>(null);
  const playing = useRef<{ stop: () => void } | null>(null);
  useEffect(() => () => playing.current?.stop(), []);
  const toggle = () => {
    void selectionTick();
    if (playing.current) {
      playing.current.stop();
      return;
    }
    const run = playFile(note.uri, (secs) => setAt(secs * 1000));
    playing.current = run;
    setAt(0);
    void run.done.then(() => {
      playing.current = null;
      setAt(null);
    });
  };
  const words = inkText(theme, { role: 'mono', size: 'sm', color: theme.color.textOnAccent });
  return (
    <GPressable
      feedback="lift"
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={t(at === null ? 'chat.voiceNote.play' : 'chat.voiceNote.stop', { length: clockWords(note.durationMs) })}
      style={[styles.voice, { backgroundColor: theme.color.accent, borderRadius: theme.radius.pill }]}
    >
      <GIcon name={at === null ? 'play' : 'stop'} size={16} color={theme.color.textOnAccent} />
      <GIcon name="voice" size={16} color={theme.color.textOnAccent} />
      <Text style={words.style}>{clockWords(at === null ? note.durationMs : Math.min(at, note.durationMs))}</Text>
    </GPressable>
  );
}

function QueuedNote({ onRemove }: { onRemove: () => void }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const note = inkText(theme, { role: 'mono', size: 'xs', color: theme.color.textTertiary });
  return (
    <View style={styles.queuedNote}>
      <Text style={note.style}>{t('chat.queued')}</Text>
      <GPressable
        feedback="tint"
        onPress={() => {
          void selectionTick();
          onRemove();
        }}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={t('chat.unqueue')}
        style={styles.unqueue}
      >
        <GIcon name="x" size={12} color={theme.color.textTertiary} />
      </GPressable>
    </View>
  );
}

export interface MessageRowProps {
  message: Message;
  position: BubblePosition;
  /** What Goose says it is doing, for the reply still being written. */
  status: string | null;
  turnSeed: number;
  /** Written while Goose was answering, and not yet sent. */
  queued?: boolean;
  /** Take a queued message back, by id. */
  onUnqueue?: (id: string) => void;
}

export const MessageRow = React.memo(function MessageRow({
  message,
  position,
  status,
  turnSeed,
  queued = false,
  onUnqueue,
}: MessageRowProps) {
  const theme = useInkTheme();

  if (message.role === 'user') {
    return (
      <View style={styles.mine}>
        {message.images?.length ? (
          <View style={queued ? styles.waiting : null}>
            <Pictures images={message.images} />
          </View>
        ) : null}
        {message.voice ? (
          <View style={queued ? styles.waiting : null}>
            <VoiceNoteChip note={message.voice} />
          </View>
        ) : null}
        {message.content ? (
          <InkBubble mine position={position} status={queued ? 'sending' : 'sent'}>
            {message.content}
          </InkBubble>
        ) : null}
        {queued && onUnqueue ? <QueuedNote onRemove={() => onUnqueue(message.id)} /> : null}
      </View>
    );
  }

  const waiting = message.pending && !message.content;
  const unfinished = Boolean(message.pending && message.content);
  const note = inkText(theme, { role: 'mono', size: 'xs', color: theme.color.textTertiary });

  return (
    <View style={styles.theirs}>
      {message.content ? <Markdown source={message.content} /> : null}
      {waiting ? <ThinkingQuips status={status} seed={turnSeed} /> : null}
      {unfinished && status ? (
        <Text style={note.style} numberOfLines={1} accessibilityLiveRegion="polite">
          {status}
        </Text>
      ) : null}
      {message.tools?.length ? <ToolTrail tools={message.tools} steps={message.steps} done={!message.pending} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  mine: { alignItems: 'flex-end', gap: 6, marginBottom: 10 },
  theirs: { gap: 10, marginBottom: 18, paddingRight: 8 },
  pictures: { alignItems: 'flex-end' },
  voice: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  // Ink's bubble dims to this while sending; its pictures match it.
  waiting: { opacity: 0.6 },
  queuedNote: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12 },
  unqueue: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6, maxWidth: 3 * TILE + 12 },
});
