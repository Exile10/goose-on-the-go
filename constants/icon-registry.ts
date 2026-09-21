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
import * as Svg from 'react-native-svg';
import { registerIcons, configureIconPrimitives, type InkIconsFrom } from '@jarida/ink';

import { IconPaths } from './icons';

function toIconNode(data: string | readonly string[]) {
  const paths = Array.isArray(data) ? data : [data];
  return paths.map((d) => ['path', { d }] as const);
}

const ICONS = Object.fromEntries(
  Object.entries(IconPaths).map(([name, data]) => [name, toIconNode(data)]),
) as { [K in keyof typeof IconPaths]: ReturnType<typeof toIconNode> };

configureIconPrimitives(Svg);
registerIcons(ICONS);

declare module '@jarida/ink' {
  interface InkIconRegistry extends InkIconsFrom<typeof ICONS> {}
}
