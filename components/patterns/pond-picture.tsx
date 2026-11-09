/**
 * PondPicture -- a picture the Pond serves, drawn once it has loaded, with a stand-in until then
 * and a plain one for an event that kept no picture or whose picture would not load.
 *
 * It is read over the Pond's own transport and kept (`services/pond-images.ts`), so the thumbnail
 * in a list and the large picture in the sheet are one read between them.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useInkTheme } from '@/components/ui/ink';

import { GIcon } from '@/components/ui/g-icon';
import type { IconName } from '@/constants/icons';
import { usePondImage } from '@/view-models/use-pond-image';

export interface PondPictureProps {
  /** The picture's Pond path, or null for an event that kept none. */
  path: string | null;
  /** Something that never repeats for this picture, such as the event's time. */
  version?: string;
  style?: StyleProp<ViewStyle>;
  contentFit?: 'cover' | 'contain';
  /** What the picture shows, for a screen reader. */
  label: string;
  /** The stand-in's size. */
  iconSize?: number;
  /** The picture's own size once loaded, so a frame can take its shape instead of cropping it. */
  onSize?: (size: { width: number; height: number }) => void;
}

/** Shapes of pictures already drawn, so a frame drawn again starts right instead of jumping. */
const RATIOS = new Map<string, number>();
const MAX_RATIOS = 256;

/** A picture's width over its height, `fallback` until it has loaded once. */
export function usePictureRatio(path: string | null, fallback: number) {
  const [ratio, setRatio] = useState(() => (path ? RATIOS.get(path) : undefined) ?? fallback);
  const onSize = useCallback(
    ({ width, height }: { width: number; height: number }) => {
      if (!path || width <= 0 || height <= 0) return;
      const next = width / height;
      if (RATIOS.size >= MAX_RATIOS && !RATIOS.has(path)) {
        const oldest = RATIOS.keys().next().value;
        if (oldest !== undefined) RATIOS.delete(oldest);
      }
      RATIOS.set(path, next);
      setRatio(next);
    },
    [path],
  );
  return [ratio, onSize] as const;
}

export const PondPicture = React.memo(function PondPicture({
  path,
  version = '',
  style,
  contentFit = 'cover',
  label,
  iconSize = 22,
  onSize,
}: PondPictureProps) {
  const theme = useInkTheme();
  const { uri, failed } = usePondImage(path, version);
  const standIn = path === null || failed;
  const icon: IconName = path === null ? 'camera' : 'eye-off';

  return (
    <View style={[{ backgroundColor: theme.color.line, overflow: 'hidden' }, style]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          transition={120}
          accessibilityLabel={label}
          onLoad={onSize ? (e) => onSize({ width: e.source.width, height: e.source.height }) : undefined}
        />
      ) : standIn ? (
        <View style={styles.center}>
          <GIcon name={icon} size={iconSize} color={theme.color.textTertiary} />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});
