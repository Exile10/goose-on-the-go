/**
 * Teach Ink the app's icons.
 *
 * Ink names an icon in plain text and resolves the artwork from whatever the
 * platform has. React Native ships no drawing primitive, so on device every
 * `icon=` slot renders an empty gap until something is registered — Ink's own
 * eighteen built-ins only resolve on the web, where there is an `<svg>`.
 */

import { registerIcons } from '@jarida/ink';

import { ICONS } from '@/constants/icons';

registerIcons(ICONS);
