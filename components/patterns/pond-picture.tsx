/**
 * PondPicture -- a picture the Pond serves, drawn once it has loaded, with a stand-in until then
 * and a plain one for an event that kept no picture or whose picture would not load.
 *
 * It is read over the Pond's own transport and kept (`services/pond-images.ts`), so the thumbnail
 * in a list and the large picture in the sheet are one read between them.
 */

import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useInkTheme } from '@jarida/ink/native';

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
}

export const PondPicture = React.memo(function PondPicture({
  path,
  version = '',
  style,
  contentFit = 'cover',
  label,
  iconSize = 22,
}: PondPictureProps) {
  const theme = useInkTheme();
  const { uri, failed } = usePondImage(path, version);
  const standIn = path === null || failed;
  const icon: IconName = path === null ? 'camera' : 'eye-off';

  return (
    <View style={[{ backgroundColor: theme.color.line, overflow: 'hidden' }, style]}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit={contentFit} transition={120} accessibilityLabel={label} />
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
