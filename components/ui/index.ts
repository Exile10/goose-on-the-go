/**
 * Jarida UI — Barrel Export
 *
 * The primitives that used to live here have moved to `@jarida/ink/native`
 * (issue #17) — import those directly, e.g. `InkButton` from
 * '@jarida/ink/native'. Icons are named strings resolved through ink's own
 * `InkIcon` (issue #19); the app's set is registered in
 * `constants/icon-registry.ts`. Every icon usage goes through `InkIcon` now,
 * including the handful that used to need an arbitrary hex color (reversed
 * white-on-solid-fill icons, per-device-type/per-category dots) — those now
 * take the nearest `tone`, or none, rather than a raw-SVG escape hatch.
 *
 * One exception remains: `GKeyboardView`, which has no ink equivalent.
 */

export { GKeyboardView } from './g-keyboard-view';
