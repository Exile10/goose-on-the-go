/**
 * GIcon — a named icon from the app's lucide registry.
 *
 * @example
 *   <GIcon name="search" size={20} color={Grey[700]} />
 */

import React from 'react';

import { ICONS, type IconName } from '@/constants/icons';
import { Grey } from '@/constants/colors';

export interface GIconProps {
  name: IconName;
  /** Icon dimensions in dp (width = height = size). Default 18 */
  size?: number;
  /** Stroke color. Falls back to Grey.500 */
  color?: string;
  /** Stroke weight. Lucide's own default is 2; the app runs slightly lighter. */
  strokeWidth?: number;
}

function GIconInner({ name, size = 18, color, strokeWidth = 1.75 }: GIconProps) {
  const Glyph = ICONS[name];
  if (!Glyph) return null;
  return <Glyph size={size} color={color ?? Grey[500]} strokeWidth={strokeWidth} />;
}

export const GIcon = React.memo(GIconInner);
