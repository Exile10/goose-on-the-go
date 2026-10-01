/**
 * Jarida UI — Barrel Export
 *
 * The primitives that used to live here have moved to `@jarida/ink/native`
 * (issue #17) — import those directly, e.g. `InkButton` from
 * '@jarida/ink/native'.
 *
 * Icons have one registry, `constants/icons.ts`, whose names are the set of
 * valid icons. `GIcon` draws one directly; `components/ui/ink-icons.ts`
 * registers the same set with Ink, so an `InkIcon` or an Ink `icon=` slot
 * resolves the same artwork.
 *
 * `GKeyboardView` has no ink equivalent.
 */

export { GIcon } from './g-icon';
export { GKeyboardView } from './g-keyboard-view';
