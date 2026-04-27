/**
 * GIcon — SVG icon component backed by Jarida IconPaths registry.
 *
 * Renders Lucide-style stroke icons from the design system's path data.
 * Supports both single-path and multi-path icon definitions.
 *
 * @example
 *   <GIcon name="search" size={20} color={Grey[700]} />
 */

import React from 'react';
import Svg, { Path } from 'react-native-svg';

import { IconPaths, type IconName } from '@/constants/icons';
import { Grey } from '@/constants/colors';

export interface GIconProps {
  /** Icon key from the IconPaths registry */
  name: IconName;
  /** Icon dimensions in dp (width = height = size). Default 18 */
  size?: number;
  /** Stroke color. Falls back to Grey.500 */
  color?: string;
  /** Optional fill color. Defaults to "none" (stroke-only) */
  fill?: string;
}

function GIconInner({ name, size = 18, color, fill = 'none' }: GIconProps) {
  const resolvedColor = color || Grey[500];
  const pathData = IconPaths[name];

  if (!pathData) {
    return null;
  }

  const paths = Array.isArray(pathData) ? pathData : [pathData];

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={resolvedColor}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths.map((d, index) => (
        <Path key={index} d={d} />
      ))}
    </Svg>
  );
}

export const GIcon = React.memo(GIconInner);
