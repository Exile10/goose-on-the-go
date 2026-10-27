/**
 * VisionEventRow -- one thing a camera saw, as a flat row between hairlines: its picture, who or
 * what it was, how sure the pond was, and when.
 *
 * Nothing here wears the edge. A list in which every row is raised is a list in which nothing is,
 * so the row lies flat and the one thing that sets one apart is the "New" it carries until
 * somebody acknowledges it. The sheet it opens is where the picture is large and the edge is spent.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkBadge, inkText, useInkTheme } from '@jarida/ink/native';

import { PondPicture } from '@/components/patterns/pond-picture';
import { GPressable } from '@/components/ui/g-pressable';
import { describeEvent, summaryLine, whenOf } from '@/models/vision';
import type { CameraEvent } from '@/services/types';
import { Spacing } from '@/constants/spacing';

const THUMB = 72;

export interface VisionEventRowProps {
  event: CameraEvent;
  /** A person's name from their profile id, or null for one the household no longer has. */
  nameOf: (profileId: string) => string | null;
  onOpen: (event: CameraEvent) => void;
}

function useRowText() {
  const theme = useInkTheme();
  return useMemo(
    () => ({
      title: inkText(theme, { role: 'display', size: 'md', weight: theme.weight.semibold, tracking: 'snug', leading: 'snug' }).style,
      summary: inkText(theme, { size: 'sm', color: theme.color.textSecondary }).style,
      meta: inkText(theme, { role: 'mono', size: 'xs', weight: theme.weight.medium, color: theme.color.textTertiary }).style,
    }),
    [theme],
  );
}

export const VisionEventRow = React.memo(function VisionEventRow({ event, nameOf, onOpen }: VisionEventRowProps) {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const text = useRowText();
  const title = describeEvent(event, nameOf);
  const summary = summaryLine(event);
  const meta = t('visionEvents.meta', { camera: event.camera_id, when: whenOf(event) });
  const label = [title, summary, meta, event.acknowledged ? t('visionEvents.acknowledged') : t('visionEvents.new')]
    .filter(Boolean)
    .join(', ');

  return (
    <GPressable feedback="tint" accessibilityRole="button" accessibilityLabel={label} onPress={() => onOpen(event)}>
      <View style={styles.row}>
        <PondPicture
          path={event.snapshot_url}
          version={event.created_at}
          label={title}
          style={{ width: THUMB, height: THUMB, borderRadius: theme.radius.md, borderWidth: theme.edge.hairlineWidth, borderColor: theme.color.lineStrong }}
        />
        <View style={styles.words}>
          <View style={styles.head}>
            <Text style={[text.title, styles.title]} numberOfLines={2}>
              {title}
            </Text>
            {event.acknowledged ? null : <InkBadge tone="warning">{t('visionEvents.new')}</InkBadge>}
          </View>
          {summary ? (
            <Text style={text.summary} numberOfLines={1}>
              {summary}
            </Text>
          ) : null}
          <Text style={text.meta} numberOfLines={1}>
            {meta}
          </Text>
        </View>
      </View>
    </GPressable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  words: { flex: 1, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  title: { flex: 1 },
});
