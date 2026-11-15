/**
 * A picture on a My Goose screen. The Pond's own paths go through `PondPicture`, over the pinned
 * transport. The readers keep nothing else, so an https address can only come from the Developer
 * mock, which draws its sample pictures straight from the web.
 */

import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useInkTheme } from '@/components/ui/ink';

import { PondPicture } from '@/components/patterns/pond-picture';
import { GIcon } from '@/components/ui/g-icon';
import type { IconName } from '@/constants/icons';

export function HubPicture({
  path,
  label,
  style,
  icon = 'photo',
  iconSize = 22,
}: {
  path: string | null;
  label: string;
  style?: StyleProp<ViewStyle>;
  /** The stand-in's glyph when there is no picture. */
  icon?: IconName;
  iconSize?: number;
}) {
  const theme = useInkTheme();
  if (path && path.startsWith('/api/')) return <PondPicture path={path} label={label} style={style} iconSize={iconSize} />;
  return (
    <View style={[{ backgroundColor: theme.color.brandSoft, overflow: 'hidden' }, styles.center, style]}>
      {path && /^https:\/\//.test(path) ? (
        <Image source={{ uri: path }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} accessibilityLabel={label} />
      ) : (
        <GIcon name={icon} size={iconSize} color={theme.color.accentLine} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({ center: { alignItems: 'center', justifyContent: 'center' } });
