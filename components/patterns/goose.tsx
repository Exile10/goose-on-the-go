/**
 * Goose — the Pond's bird, afloat. A shared illustration, not a decoration.
 *
 * The drawing and its motion live in `goose-motion.ts`, which pond-desktop's `<Goose />` shares file
 * for file, so the phone and the dashboard draw the same bird and move it the same way. The neck and
 * head are rebuilt every frame along a curved spine, so they bend as one body; every other part turns
 * about its own pivot. With `water`, the goose floats on a pond with drifting waves, glints, and a
 * reflection the ripples break up.
 *
 * One Reanimated frame callback keeps the clock and one derived value computes the whole frame, both
 * on the UI thread: the goose works hardest while the Pond is answering, which is when the JS thread
 * is busiest, so nothing here waits on it.
 *
 * Reduced motion draws one resting frame.
 */

import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedProps,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import Svg, { ClipPath, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useInkTheme, useReduceMotion } from '@jarida/ink/native';

import {
  BACK_SHEEN, BANDS, BELLY, BODY, CHEST_SHEEN, GLINTS, HEAD_DETAIL, PRIMARIES, RIPPLE, SCALLOPS, TAIL, WAKE, WAVES, WING,
  WING_LINES, easeListen, neckFrame, neckPose, partsFrame, restingParts, wavePath,
  type GooseMood, type NeckFrame, type PartsFrame,
} from '@/components/patterns/goose-motion';

export type GooseState = GooseMood;

export interface GooseProps {
  /** Idle: afloat. Working: the Pond is answering. Listening: it is hearing speech. */
  state: GooseState;
  /** Width in points; the height follows the drawing. */
  size?: number;
  /**
   * The pond under the goose. Off for inline use, where the drawing crops to the bird, so a small goose
   * does not spend half its box on water.
   */
  water?: boolean;
  /**
   * The colour behind the goose. The ripples that break the reflection up are drawn in it, so it has to
   * match what is there; the theme's surface, a card's face, by default.
   */
  ground?: string;
  /** One resting frame and no clock: a goose that is small, or on a screen out of sight. */
  still?: boolean;
}

type Matrix = [number, number, number, number, number, number];

/** Frames a second while it swims or listens, and while it only drifts and blinks. */
const FPS = 30;
const IDLE_FPS = 20;

/** The native components take `matrix`; the JS ones only reach it through `transform`. */
type WithMatrix<P> = React.ComponentType<P & { matrix?: Matrix }>;
const AG = Animated.createAnimatedComponent(G as WithMatrix<React.ComponentProps<typeof G>>);
const APath = Animated.createAnimatedComponent(Path);
const AEllipse = Animated.createAnimatedComponent(Ellipse as WithMatrix<React.ComponentProps<typeof Ellipse>>);

// Animated transforms go to react-native-svg's native `matrix` prop, [a b c d tx ty], directly.
// Reanimated reads an animated `transform` as a React Native style transform, a list of objects,
// and a six-number SVG matrix there crashes the draw ("expected dynamic type 'object'").

/** a then b: the matrix that applies `b` first and `a` after, as SVG's transform lists compose. */
function times(a: Matrix, b: Matrix): Matrix {
  'worklet';
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** A linear map [a b c d] about the point (x, y). */
function about(a: number, b: number, c: number, d: number, x: number, y: number): Matrix {
  'worklet';
  return [a, b, c, d, x - a * x - c * y, y - b * x - d * y];
}

function turn(deg: number, x: number, y: number): Matrix {
  'worklet';
  const r = (deg * Math.PI) / 180;
  return about(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), x, y);
}

const shift = (x: number, y: number): Matrix => {
  'worklet';
  return [1, 0, 0, 1, x, y];
};

/** One hex colour mixed toward another, `p` of the way. Anything but #rrggbb passes through. */
function mix(from: string, to: string, p: number): string {
  const hex = (s: string) => (/^#[0-9a-f]{6}$/i.test(s) ? [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) : null);
  const a = hex(from), b = hex(to);
  if (!a || !b) return from;
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * p).toString(16).padStart(2, '0')).join('')}`;
}

interface Palette { accent: string; light: string; deep: string; darkest: string; beak: string; beakDeep: string; ground: string }

interface Frame { neck: NeckFrame; lid: number; parts: PartsFrame }

/**
 * A frame given outright. The parts under it draw it as plain props, once, instead of following a
 * shared value every frame: a goose that never moves, and the reflection of one that does.
 */
const Still = React.createContext<Frame | null>(null);

/** The goose at rest in `mood`, as reduced motion draws it, worked out on the JS thread. */
function restFrame(mood: GooseMood): Frame {
  const pose = neckPose(0, mood, mood === 'listening' ? 1 : 0);
  return { neck: neckFrame(pose), lid: pose.lid, parts: restingParts(mood) };
}

type MovingProps = { frame: SharedValue<Frame>; at: (f: Frame) => Matrix; children: React.ReactNode };

/** One part whose transform the frame sets. */
function Moving(props: MovingProps) {
  const still = React.useContext(Still);
  return still ? <G transform={props.at(still)}>{props.children}</G> : <LiveMoving {...props} />;
}

function LiveMoving({ frame, at, children }: MovingProps) {
  const props = useAnimatedProps(() => ({ matrix: at(frame.get()) }));
  return <AG animatedProps={props}>{children}</AG>;
}

type RebuiltProps = { frame: SharedValue<Frame>; pick: (n: NeckFrame) => string } & React.ComponentProps<typeof Path>;

/** The neck, its highlight and the head: outlines the frame rebuilds. */
function Rebuilt(props: RebuiltProps) {
  const still = React.useContext(Still);
  if (!still) return <LiveRebuilt {...props} />;
  const { frame: _frame, pick, ...rest } = props;
  return <Path d={pick(still.neck)} {...rest} />;
}

function LiveRebuilt({ frame, pick, ...rest }: RebuiltProps) {
  const props = useAnimatedProps(() => ({ d: pick(frame.get().neck) }));
  return <APath animatedProps={props} {...rest} />;
}

type RingProps = { frame: SharedValue<Frame>; i: number; color: string };

function Ring(props: RingProps) {
  const still = React.useContext(Still);
  if (!still) return <LiveRing {...props} />;
  const c = still.neck.ringCentre, r = still.parts.rings[props.i];
  return <Ellipse cx={c[0]} cy={c[1]} rx={r.r} ry={r.r} opacity={r.opacity} fill="none" stroke={props.color} strokeWidth={1.3} />;
}

function LiveRing({ frame, i, color }: RingProps) {
  const props = useAnimatedProps(() => {
    const c = frame.get().neck.ringCentre, r = frame.get().parts.rings[i];
    return { cx: c[0], cy: c[1], rx: r.r, ry: r.r, opacity: r.opacity };
  });
  return <AEllipse animatedProps={props} fill="none" stroke={color} strokeWidth={1.3} />;
}

/** One goose, drawn in full; `tag` keeps ids unique when it is drawn twice (the bird and its reflection). */
function Bird({ id, tag, frame, p }: { id: string; tag: string; frame: SharedValue<Frame>; p: Palette }) {
  const u = (n: string) => `${id}-${tag}-${n}`;
  const D = HEAD_DETAIL;
  const head = (f: Frame) => {
    'worklet';
    return f.neck.headMatrix;
  };
  const eye = (f: Frame) => {
    'worklet';
    return times(f.neck.headMatrix, about(1, 0, 0, f.lid, D.eye.cx, D.eye.cy));
  };
  return (
    <>
      <Defs>
        <LinearGradient id={u('body')} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={p.light} /><Stop offset=".45" stopColor={p.accent} /><Stop offset="1" stopColor={p.darkest} /></LinearGradient>
        <LinearGradient id={u('wing')} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={p.accent} /><Stop offset="1" stopColor={p.darkest} /></LinearGradient>
        <LinearGradient id={u('prim')} x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor={p.deep} /><Stop offset="1" stopColor={p.darkest} /></LinearGradient>
        <LinearGradient id={u('tail')} x1="0" y1="1" x2="1" y2="0"><Stop offset="0" stopColor={p.deep} /><Stop offset="1" stopColor={p.darkest} /></LinearGradient>
        <LinearGradient id={u('nh')} gradientUnits="userSpaceOnUse" x1="42" y1="0" x2="70" y2="0"><Stop offset="0" stopColor={p.light} /><Stop offset=".45" stopColor={p.accent} /><Stop offset="1" stopColor={p.deep} /></LinearGradient>
        <LinearGradient id={u('beak')} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#ffd27a" /><Stop offset="1" stopColor={p.beak} /></LinearGradient>
        <ClipPath id={u('above')}><Rect x="0" y="0" width="160" height="99" /></ClipPath>
        <ClipPath id={u('bodyClip')}><Path d={BODY} /></ClipPath>
      </Defs>
      {/* The neck and head, rebuilt every frame; the neck's root sits behind the chest. */}
      <Rebuilt frame={frame} pick={(n) => { 'worklet'; return n.neck; }} fill={`url(#${u('nh')})`} />
      <Rebuilt frame={frame} pick={(n) => { 'worklet'; return n.highlight; }} fill="none" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" opacity={0.26} />
      {/* The beak's root runs under the head, so no turn opens a notch. */}
      <Moving frame={frame} at={head}>
        <Path fill={`url(#${u('beak')})`} d={D.beakUpper} />
        <Path fill={p.beakDeep} d={D.beakLower} />
        <Path fill="none" stroke={p.beakDeep} strokeWidth={0.45} strokeLinecap="round" opacity={0.7} d={D.beakSeam} />
        <Ellipse fill={p.beakDeep} {...D.nostril} transform={turn(6, D.nostril.cx, D.nostril.cy)} />
      </Moving>
      <Rebuilt frame={frame} pick={(n) => { 'worklet'; return n.head; }} fill={`url(#${u('nh')})`} />
      <Moving frame={frame} at={head}>
        <Path fill={p.darkest} opacity={0.22} d={D.throatShade} />
        <Ellipse fill="#fff" opacity={0.42} {...D.gloss} transform={turn(-6, D.gloss.cx, D.gloss.cy)} />
        <Path fill="#fff" opacity={0.94} d={D.chinstrap} />
      </Moving>
      <Moving frame={frame} at={eye}>
        <Ellipse fill="#fff" cx={D.eye.cx} cy={D.eye.cy} rx={D.eye.r} ry={D.eye.r} />
        <Ellipse fill="#14111c" cx={D.pupil.cx} cy={D.pupil.cy} rx={D.pupil.r} ry={D.pupil.r} />
        <Ellipse fill="#fff" cx={D.catchlight.cx} cy={D.catchlight.cy} rx={D.catchlight.r} ry={D.catchlight.r} />
      </Moving>
      {[0, 1, 2].map((i) => <Ring key={i} frame={frame} i={i} color={p.accent} />)}
      <G clipPath={`url(#${u('above')})`}>
        <Moving frame={frame} at={(f) => { 'worklet'; return turn(f.parts.tail, 120, 78); }}>
          <Path fill={p.darkest} d={TAIL[0]} />
          <Path fill={`url(#${u('tail')})`} d={TAIL[1]} />
          <Path fill={p.accent} d={TAIL[2]} />
        </Moving>
        <Path fill={`url(#${u('body')})`} d={BODY} />
        <G clipPath={`url(#${u('bodyClip')})`}>
          <Path fill={p.darkest} opacity={0.32} d={BELLY} />
          <Path fill="#fff" opacity={0.34} d={BACK_SHEEN} />
          <Path fill="#fff" opacity={0.2} d={CHEST_SHEEN} />
          {SCALLOPS.map((d, i) => <Path key={d} fill="none" stroke="#fff" strokeWidth={1} strokeLinecap="round" opacity={i ? 0.16 : 0.22} d={d} />)}
        </G>
        <Moving frame={frame} at={(f) => { 'worklet'; return about(f.parts.wing, 0, 0, f.parts.wing, 76, 82); }}>
          {PRIMARIES.map((d, i) => (
            <Moving key={d} frame={frame} at={(f) => { 'worklet'; return turn(f.parts.primaries[i], 104, 84); }}>
              <Path fill={`url(#${u('prim')})`} d={d} />
            </Moving>
          ))}
          <Path fill={`url(#${u('wing')})`} d={WING} />
          {WING_LINES.coverts.map((d, i) => <Path key={d} fill="none" stroke="#fff" strokeWidth={i ? 0.8 : 0.9} strokeLinecap="round" opacity={i ? 0.2 : 0.28} d={d} />)}
          <Path fill="none" stroke={p.darkest} strokeWidth={0.7} strokeLinecap="round" opacity={0.45} d={WING_LINES.edge} />
        </Moving>
      </G>
    </>
  );
}

type WakeProps = { frame: SharedValue<Frame>; i: number; d: string; color: string };

function Wake(props: WakeProps) {
  const still = React.useContext(Still);
  if (!still) return <LiveWake {...props} />;
  const w = still.parts.wake[props.i];
  return <Path strokeDashoffset={w.offset} opacity={w.opacity} d={props.d} fill="none" stroke={props.color} strokeWidth={1.3} strokeLinecap="round" strokeDasharray="14 60" />;
}

function LiveWake({ frame, i, d, color }: WakeProps) {
  const props = useAnimatedProps(() => ({ strokeDashoffset: frame.get().parts.wake[i].offset, opacity: frame.get().parts.wake[i].opacity }));
  return <APath animatedProps={props} d={d} fill="none" stroke={color} strokeWidth={1.3} strokeLinecap="round" strokeDasharray="14 60" />;
}

type GlintProps = { frame: SharedValue<Frame>; i: number; color: string };

function glintMatrix(f: Frame, i: number): Matrix {
  'worklet';
  const [cx, cy] = GLINTS[i];
  const g = f.parts.glints[i];
  return times(shift(g.x, 0), about(g.sx, 0, 0, 1, cx, cy));
}

function Glint(props: GlintProps) {
  const still = React.useContext(Still);
  if (!still) return <LiveGlint {...props} />;
  const [cx, cy, rx, ry] = GLINTS[props.i];
  return <Ellipse transform={glintMatrix(still, props.i)} opacity={still.parts.glints[props.i].opacity} fill={props.color} cx={cx} cy={cy} rx={rx} ry={ry} />;
}

function LiveGlint({ frame, i, color }: GlintProps) {
  const [cx, cy, rx, ry] = GLINTS[i];
  const props = useAnimatedProps(() => ({ matrix: glintMatrix(frame.get(), i), opacity: frame.get().parts.glints[i].opacity }));
  return <AEllipse animatedProps={props} fill={color} cx={cx} cy={cy} rx={rx} ry={ry} />;
}

type RippleProps = { frame: SharedValue<Frame>; i: number; color: string };

function Ripple(props: RippleProps) {
  const still = React.useContext(Still);
  if (!still) return <LiveRipple {...props} />;
  const r = still.parts.ripples[props.i];
  return <Ellipse transform={about(r.scale, 0, 0, r.scale, 88, 98)} opacity={r.opacity} cx={RIPPLE[0]} cy={RIPPLE[1]} rx={RIPPLE[2]} ry={RIPPLE[3]} fill="none" stroke={props.color} strokeWidth={1.3} />;
}

function LiveRipple({ frame, i, color }: RippleProps) {
  const props = useAnimatedProps(() => {
    const r = frame.get().parts.ripples[i];
    return { matrix: about(r.scale, 0, 0, r.scale, 88, 98), opacity: r.opacity };
  });
  // Hung from the waterline: its top edge stays on it as it spreads, so the ring lies on the water.
  return <AEllipse animatedProps={props} cx={RIPPLE[0]} cy={RIPPLE[1]} rx={RIPPLE[2]} ry={RIPPLE[3]} fill="none" stroke={color} strokeWidth={1.3} />;
}

type ShadowProps = { frame: SharedValue<Frame>; id: string };

function Shadow(props: ShadowProps) {
  const still = React.useContext(Still);
  if (!still) return <LiveShadow {...props} />;
  const s = still.parts.shadow;
  return (
    <G transform={about(s.scale, 0, 0, s.scale, 90, 99)} opacity={s.opacity}>
      <Ellipse fill={`url(#${props.id}-shadow)`} cx={90} cy={99} rx={46} ry={4.2} />
    </G>
  );
}

function LiveShadow({ frame, id }: ShadowProps) {
  const props = useAnimatedProps(() => {
    const s = frame.get().parts.shadow;
    return { matrix: about(s.scale, 0, 0, s.scale, 90, 99), opacity: s.opacity };
  });
  return <AG animatedProps={props}><Ellipse fill={`url(#${id}-shadow)`} cx={90} cy={99} rx={46} ry={4.2} /></AG>;
}

/**
 * The pond, back to front: the reflection, the water, the bands that break the reflection, the waves,
 * then the ground drawn over its edges, then the glints, shadow, wake and ripples.
 *
 * The dashboard fades the pond's edges with SVG masks over an elliptical gradient. On the device
 * react-native-svg drew nothing inside those masks, and it ignores a radial gradient's separate rx and
 * ry, so here the ground itself is laid over the pond with linear gradients, clear in the middle and
 * solid at the sides and toward the bottom. The reflection is cut at the waterline with a clip path.
 */
function Pond({ id, frame, p, rest }: { id: string; frame: SharedValue<Frame>; p: Palette; rest: Frame }) {
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}-deep`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="98" y2="138">
          <Stop offset="0" stopColor={p.accent} stopOpacity={0.24} /><Stop offset=".45" stopColor={p.accent} stopOpacity={0.1} /><Stop offset="1" stopColor={p.accent} stopOpacity={0} />
        </LinearGradient>
        <RadialGradient id={`${id}-shadow`} cx=".5" cy=".5" r=".5"><Stop offset="0" stopColor="#000" stopOpacity={0.26} /><Stop offset="1" stopColor="#000" stopOpacity={0} /></RadialGradient>
        {/* The pond's sides: clear in the middle, the ground at either end. Linear, because the phone's
            renderer ignores a radial gradient's separate rx and ry and would cover the whole pond. */}
        <LinearGradient id={`${id}-edge`} gradientUnits="userSpaceOnUse" x1="4" x2="156" y1="0" y2="0">
          <Stop offset="0" stopColor={p.ground} stopOpacity={1} /><Stop offset=".22" stopColor={p.ground} stopOpacity={0} />
          <Stop offset=".78" stopColor={p.ground} stopOpacity={0} /><Stop offset="1" stopColor={p.ground} stopOpacity={1} />
        </LinearGradient>
        {/* The reflection's fade with depth. */}
        <LinearGradient id={`${id}-depth`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="98" y2="136">
          <Stop offset="0" stopColor={p.ground} stopOpacity={0} /><Stop offset=".45" stopColor={p.ground} stopOpacity={0.45} /><Stop offset="1" stopColor={p.ground} stopOpacity={1} />
        </LinearGradient>
        <ClipPath id={`${id}-below`}><Rect x="0" y="98" width="160" height="42" /></ClipPath>
      </Defs>
      <G clipPath={`url(#${id}-below)`}>
        <Moving frame={frame} at={(f) => {
          'worklet';
          const r = f.parts.reflection;
          return times(shift(0, r.y), about(1, 0, Math.tan((r.skew * Math.PI) / 180) * r.sy, r.sy, 88, 98));
        }}>
          {/* At rest inside, moving only as a whole with the swell: redrawn every frame, the second bird
              doubled the work of each, under a fade and the bands that break it up anyway. */}
          <Still.Provider value={rest}>
            <G opacity={0.42} transform={[1, 0, 0, -1, 0, 196]}><Bird id={id} tag="r" frame={frame} p={p} /></G>
          </Still.Provider>
        </Moving>
      </G>
      <Rect x="0" y="98" width="160" height="42" fill={`url(#${id}-deep)`} />
      {BANDS.map(([y, width, dash], i) => (
        <Moving key={y} frame={frame} at={(f) => { 'worklet'; return shift(f.parts.bands[i], 0); }}>
          <Path d={`M-80 ${y}h320`} fill="none" stroke={p.ground} strokeWidth={width} strokeDasharray={dash} opacity={0.7} />
        </Moving>
      ))}
      {WAVES.map(([y, amplitude, wavelength, width, opacity], i) => (
        <Moving key={y} frame={frame} at={(f) => { 'worklet'; return shift(f.parts.waves[i], 0); }}>
          <Path d={wavePath(y, amplitude, wavelength)} fill="none" stroke={p.accent} strokeWidth={width} strokeLinecap="round" opacity={opacity} />
        </Moving>
      ))}
      <Rect x="-40" y="94" width="240" height="50" fill={`url(#${id}-depth)`} />
      <Rect x="-40" y="94" width="240" height="50" fill={`url(#${id}-edge)`} />
      {GLINTS.map(([cx], i) => <Glint key={cx} frame={frame} i={i} color={p.light} />)}
      <Shadow frame={frame} id={id} />
      {WAKE.map((d, i) => <Wake key={d} frame={frame} i={i} d={d} color={p.accent} />)}
      {[0, 1].map((i) => <Ripple key={i} frame={frame} i={i} color={p.accent} />)}
    </>
  );
}

let gooseIds = 0;

/** The goose's colours, from the theme's accent. */
function usePalette(ground: string | undefined): Palette {
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

/** The drawing itself, around whichever frame it is given. */
function Drawing({ id, frame, p, size, water, rest }: { id: string; frame: SharedValue<Frame>; p: Palette; size: number; water: boolean; rest: Frame }) {
  const ratio = water ? 140 / 160 : 96 / 136;
  return (
    <Svg width={size} height={size * ratio} viewBox={water ? '0 0 160 140' : '22 6 136 96'} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {water ? <Pond id={id} frame={frame} p={p} rest={rest} /> : null}
      <Moving frame={frame} at={(f) => {
        'worklet';
        const b = f.parts.bob;
        return times(shift(0, b.y), times(about(b.sx, 0, 0, b.sy, 88, 98), turn(f.parts.roll, 88, 98)));
      }}>
        <Bird id={id} tag="b" frame={frame} p={p} />
      </Moving>
      {water ? <Path d="M10 98.4h140" fill="none" stroke={p.light} strokeWidth={0.9} strokeLinecap="round" opacity={0.7} /> : null}
    </Svg>
  );
}

/**
 * The goose at rest, drawn once as plain SVG: no clock, and nothing following a shared value. For a
 * goose that never moves, such as the one beside each finished reply's thoughts, it costs no more
 * than an icon.
 */
export const GooseStill = React.memo(function GooseStill({ state = 'idle', size = 150, water = true, ground }: Partial<Pick<GooseProps, 'state'>> & Omit<GooseProps, 'state' | 'still'>) {
  const p = usePalette(ground);
  const [id] = React.useState(() => `goose${gooseIds++}`);
  const rest = React.useMemo(() => restFrame(state), [state]);
  // The parts take a shared value for when they move; under `Still` they never read it.
  const frame = useSharedValue(rest);
  return (
    <Still.Provider value={rest}>
      <Drawing id={id} frame={frame} p={p} size={size} water={water} rest={rest} />
    </Still.Provider>
  );
});

export const Goose = React.memo(function Goose({ state, size = 150, water = true, ground, still = false }: GooseProps) {
  // The web preview draws the resting frame too: the old goose's motion took a chat down there
  // (2b8aafd), and this one's matrices go through react-native-svg's native props.
  const reduced = useReduceMotion() || Platform.OS === 'web' || still;
  const [id] = React.useState(() => `goose${gooseIds++}`);
  const p = usePalette(ground);
  const rest = React.useMemo(() => restFrame(state), [state]);

  const mood = useSharedValue<GooseMood>(state);
  const clock = useSharedValue(0);
  const listen = useSharedValue(state === 'listening' ? 1 : 0);
  useEffect(() => {
    mood.set(state);
    if (reduced) listen.set(state === 'listening' ? 1 : 0);
  }, [state, reduced, mood, listen]);

  // Every frame drawn sends the whole bird through react-native-svg's props, so it is drawn at `FPS`,
  // or `IDLE_FPS` afloat, rather than the screen's rate: the motion is slow enough not to show it.
  const drawn = useSharedValue(-1);
  useFrameCallback((info) => {
    'worklet';
    const now = info.timeSinceFirstFrame;
    const since = now - drawn.get();
    const step = 1000 / (mood.get() === 'idle' ? IDLE_FPS : FPS);
    // A clock that restarts on resuming reads as negative, and draws at once.
    if (drawn.get() >= 0 && since >= 0 && since < step) return;
    const dt = Math.min(0.1, (since > 0 && drawn.get() >= 0 ? since : step) / 1000);
    drawn.set(now);
    clock.set(now / 1000);
    listen.set(easeListen(listen.get(), mood.get(), dt));
  }, !reduced);

  const frame = useDerivedValue<Frame>(() => {
    const t = reduced ? 0 : clock.get();
    const m = mood.get(), l = listen.get();
    const pose = neckPose(t, m, l);
    return {
      neck: neckFrame(pose),
      lid: pose.lid,
      parts: reduced ? restingParts(m) : partsFrame(t, m, l),
    };
  });

  return <Drawing id={id} frame={frame} p={p} size={size} water={water} rest={rest} />;
});
