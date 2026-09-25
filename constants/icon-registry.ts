/**
 * Registers this app's icon set with @jarida/ink's icon system (issue #19).
 *
 * `IconPaths` is already lucide-shaped 24x24 path data (it used to feed the
 * hand-rolled GIcon renderer directly). Ink's registry wants each icon as a
 * list of SVG element tuples rather than a bare `d` string, so this only
 * reshapes the existing data — the geometry itself doesn't change.
 *
 * Side-effecting on import (registerIcons/configureIconPrimitives are calls,
 * not exports with a side effect, per ink's own docs) — import this once from
 * the app's entry point before anything renders an InkIcon.
 */
import { createElement, type ComponentProps } from 'react';
import { Platform } from 'react-native';
import * as Svg from 'react-native-svg';
import { registerIcons, configureIconPrimitives, type InkIconsFrom } from '@jarida/ink';

import { IconPaths } from './icons';

type SvgProps = ComponentProps<typeof Svg.Svg> & {
  accessible?: boolean;
  accessibilityElementsHidden?: boolean;
  importantForAccessibility?: string;
  accessibilityRole?: string;
  accessibilityLabel?: string;
};

/**
 * InkIcon spreads React Native's a11y props onto <Svg>. Native reads them;
 * on web react-native-svg hands them straight to the <svg> DOM node, and
 * React warns about each one ("React does not recognize the
 * `accessibilityElementsHidden` prop…", "Received `false` for a non-boolean
 * attribute `accessible`"). Translate them to their ARIA equivalents here.
 *
 * Workaround for ink's InkIcon, not a fix — delete once ink does this itself.
 */
function WebSvg({
  accessible,
  accessibilityElementsHidden,
  importantForAccessibility,
  accessibilityRole,
  accessibilityLabel,
  ...rest
}: SvgProps) {
  const hidden =
    accessible === false ||
    accessibilityElementsHidden === true ||
    importantForAccessibility === 'no-hide-descendants';
  const aria = hidden
    ? { 'aria-hidden': true }
    : accessibilityLabel
      ? { role: accessibilityRole === 'image' ? 'img' : accessibilityRole, 'aria-label': accessibilityLabel }
      : {};
  return createElement(Svg.Svg, { ...rest, ...aria } as ComponentProps<typeof Svg.Svg>);
}

const primitives = Platform.OS === 'web' ? { ...Svg, Svg: WebSvg } : Svg;

function toIconNode(data: string | readonly string[]) {
  const paths = Array.isArray(data) ? data : [data];
  return paths.map((d) => ['path', { d }] as const);
}

const ICONS = Object.fromEntries(
  Object.entries(IconPaths).map(([name, data]) => [name, toIconNode(data)]),
) as { [K in keyof typeof IconPaths]: ReturnType<typeof toIconNode> };

configureIconPrimitives(primitives);
registerIcons(ICONS);

declare module '@jarida/ink' {
  interface InkIconRegistry extends InkIconsFrom<typeof ICONS> {}
}
