/**
 * Jarida UI — Barrel Export
 *
 * The primitives that used to live here have moved to `@jarida/ink/native`
 * (issue #17) — import those directly, e.g. `InkButton` from
 * '@jarida/ink/native'.
 *
 * Two exceptions remain and are exported here:
 *   - `GIcon`, pending the icon-registry work in #19.
 *   - `GKeyboardView`, which has no ink equivalent.
 */

export { GIcon, type GIconProps } from './g-icon';
export { GKeyboardView } from './g-keyboard-view';
