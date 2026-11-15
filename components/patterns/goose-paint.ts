/**
 * What the goose's two drawings share, react-native-svg's and Skia's: its colours from the theme,
 * the affine matrices its parts move by, in SVG's order [a b c d e f], and its resting frame.
 */

import { useInkTheme } from '@/components/ui/ink';

import { neckFrame, neckPose, restingParts, type GooseMood, type NeckFrame, type PartsFrame } from '@/components/patterns/goose-motion';

export type Matrix = [number, number, number, number, number, number];

/** a then b: the matrix that applies `b` first and `a` after, as SVG's transform lists compose. */
export function times(a: Matrix, b: Matrix): Matrix {
  'worklet';
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** A linear map [a b c d] about the point (x, y). */
export function about(a: number, b: number, c: number, d: number, x: number, y: number): Matrix {
  'worklet';
  return [a, b, c, d, x - a * x - c * y, y - b * x - d * y];
}

export function turn(deg: number, x: number, y: number): Matrix {
  'worklet';
  const r = (deg * Math.PI) / 180;
  return about(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), x, y);
}

export const shift = (x: number, y: number): Matrix => {
  'worklet';
  return [1, 0, 0, 1, x, y];
};

/** One hex colour mixed toward another, `p` of the way. Anything but #rrggbb passes through. */
export function mix(from: string, to: string, p: number): string {
  const hex = (s: string) => (/^#[0-9a-f]{6}$/i.test(s) ? [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) : null);
  const a = hex(from), b = hex(to);
  if (!a || !b) return from;
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * p).toString(16).padStart(2, '0')).join('')}`;
}

export interface Palette { accent: string; light: string; deep: string; darkest: string; beak: string; beakDeep: string; ground: string }

export interface Frame { neck: NeckFrame; lid: number; parts: PartsFrame }

/** The goose at rest in `mood`, as reduced motion draws it, worked out on the JS thread. */
export function restFrame(mood: GooseMood): Frame {
  const pose = neckPose(0, mood, mood === 'listening' ? 1 : 0);
  return { neck: neckFrame(pose), lid: pose.lid, parts: restingParts(mood) };
}

/** The goose's colours, from the theme's accent. */
export function usePalette(ground: string | undefined): Palette {
  const c = useInkTheme().color;
  return {
    accent: c.accent,
    light: mix(c.accent, '#ffffff', 0.42),
    deep: c.accentPressed,
    darkest: mix(c.accentPressed, '#000000', 0.38),
    beak: c.warning,
    beakDeep: mix(c.warning, '#000000', 0.24),
    ground: ground ?? c.surface,
  };
}
