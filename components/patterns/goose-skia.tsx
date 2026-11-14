/**
 * The goose drawn with Skia, on the GPU: the same bird and the same motion as the drawn goose, part
 * for part from `goose-motion.ts`, so the neck bends as one body, the head glances, the wing ruffles
 * and the pond moves. react-native-svg paints the whole picture in software on the UI thread at every
 * change, about 230 ms a frame on an A16; Skia records the frame and the GPU draws it.
 *
 * Gradients given in SVG's object units are set from each shape's bounds, which Skia does not work
 * out for itself, and SVG's matrices [a b c d e f] are handed over as the row-major 3×3 Skia
 * concatenates, plain numbers each frame rather than a native object.
 */

import React, { useEffect, useMemo } from 'react';
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  LinearGradient,
  Oval,
  Path,
  RadialGradient,
  Rect,
  Skia,
  vec,
  type SkPath,
  type SkRect,
} from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useReduceMotion } from '@jarida/ink/native';

import {
  BACK_SHEEN,
  BANDS,
  BELLY,
  BODY,
  CHEST_SHEEN,
  GLINTS,
  HEAD_DETAIL,
  PRIMARIES,
  RIPPLE,
  SCALLOPS,
  TAIL,
  WAKE,
  WAVES,
  WING,
  WING_LINES,
  easeListen,
  neckFrame,
  neckPose,
  partsFrame,
  restingParts,
  wavePath,
  type GooseMood,
  type NeckFrame,
} from '@/components/patterns/goose-motion';
import { about, restFrame, shift, times, turn, usePalette, type Frame, type Matrix, type Palette } from '@/components/patterns/goose-paint';
import type { GooseProps } from '@/components/patterns/goose';

/**
 * Frames a second the pose is worked out at. Skia's drawing is cheap; the pose's maths runs on the UI
 * thread, which a debug build slows several times over, and 30 divides 60, 90 and 120 Hz evenly.
 */
const FPS = 30;

/** SVG's [a b c d e f] as the row-major 3×3 Skia concatenates. */
function sk(m: Matrix): number[] {
  'worklet';
  return [m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1];
}

/** A colour at an opacity, as Skia takes a gradient stop's alpha: in the colour. */
function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
}

const parse = (d: string): SkPath => Skia.Path.MakeFromSVGString(d) ?? Skia.Path.Make();

const ellipse = (cx: number, cy: number, rx: number, ry: number): SkRect => ({ x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 });

/** SVG's objectBoundingBox: a gradient's ends as fractions of the shape's own bounds. */
function across(b: SkRect, x1: number, y1: number, x2: number, y2: number) {
  return { start: vec(b.x + x1 * b.width, b.y + y1 * b.height), end: vec(b.x + x2 * b.width, b.y + y2 * b.height) };
}

/** The drawing's fixed shapes, parsed once for every goose, and the bounds their gradients span. */
interface Shapes {
  body: SkPath;
  belly: SkPath;
  backSheen: SkPath;
  chestSheen: SkPath;
  scallops: SkPath[];
  tail: SkPath[];
  wing: SkPath;
  primaries: SkPath[];
  coverts: SkPath[];
  edge: SkPath;
  beakUpper: SkPath;
  beakLower: SkPath;
  beakSeam: SkPath;
  throatShade: SkPath;
  chinstrap: SkPath;
  waves: SkPath[];
  bands: SkPath[];
  wake: SkPath[];
  waterline: SkPath;
  bounds: { body: SkRect; tail: SkRect; wing: SkRect; primaries: SkRect[]; beak: SkRect };
  reflection: ReturnType<typeof Skia.Paint>;
}

let made: Shapes | null = null;

function shapes(): Shapes {
  if (made) return made;
  const D = HEAD_DETAIL;
  const body = parse(BODY);
  const tail = TAIL.map(parse);
  const wing = parse(WING);
  const primaries = PRIMARIES.map(parse);
  const beakUpper = parse(D.beakUpper);
  // The reflection is one layer at 0.42, as SVG's group opacity is, so overlapping parts do not darken.
  const reflection = Skia.Paint();
  reflection.setAlphaf(0.42);
  made = {
    body,
    belly: parse(BELLY),
    backSheen: parse(BACK_SHEEN),
    chestSheen: parse(CHEST_SHEEN),
    scallops: SCALLOPS.map(parse),
    tail,
    wing,
    primaries,
    coverts: WING_LINES.coverts.map(parse),
    edge: parse(WING_LINES.edge),
    beakUpper,
    beakLower: parse(D.beakLower),
    beakSeam: parse(D.beakSeam),
    throatShade: parse(D.throatShade),
    chinstrap: parse(D.chinstrap),
    waves: WAVES.map(([y, amplitude, wavelength]) => parse(wavePath(y, amplitude, wavelength))),
    bands: BANDS.map(([y]) => parse(`M-80 ${y}h320`)),
    wake: WAKE.map(parse),
    waterline: parse('M10 98.4h140'),
    bounds: {
      body: body.computeTightBounds(),
      tail: tail[1].computeTightBounds(),
      wing: wing.computeTightBounds(),
      primaries: primaries.map((p) => p.computeTightBounds()),
      beak: beakUpper.computeTightBounds(),
    },
    reflection,
  };
  return made;
}

/** One part whose transform the frame sets. */
function Moving({ frame, at, children }: { frame: SharedValue<Frame>; at: (f: Frame) => Matrix; children: React.ReactNode }) {
  const m = useDerivedValue(() => sk(at(frame.get())));
  return <Group matrix={m}>{children}</Group>;
}

/** The neck, its highlight and the head: outlines the frame rebuilds. */
function Rebuilt({
  frame,
  pick,
  children,
  ...paint
}: {
  frame: SharedValue<Frame>;
  pick: (n: NeckFrame) => string;
  children?: React.ReactNode;
} & Omit<React.ComponentProps<typeof Path>, 'path'>) {
  const path = useDerivedValue(() => Skia.Path.MakeFromSVGString(pick(frame.get().neck)) ?? Skia.Path.Make());
  return (
    <Path path={path} {...paint}>
      {children}
    </Path>
  );
}

function Ring({ frame, i, color }: { frame: SharedValue<Frame>; i: number; color: string }) {
  const rect = useDerivedValue(() => {
    const c = frame.get().neck.ringCentre, r = frame.get().parts.rings[i];
    return { x: c[0] - r.r, y: c[1] - r.r, width: r.r * 2, height: r.r * 2 };
  });
  const opacity = useDerivedValue(() => frame.get().parts.rings[i].opacity);
  return <Oval rect={rect} style="stroke" strokeWidth={1.3} color={color} opacity={opacity} />;
}

/** One goose; drawn twice on water, the second time as its reflection. */
function Bird({ frame, p, s }: { frame: SharedValue<Frame>; p: Palette; s: Shapes }) {
  const D = HEAD_DETAIL;
  const head = (f: Frame) => {
    'worklet';
    return f.neck.headMatrix;
  };
  const eye = (f: Frame) => {
    'worklet';
    return times(f.neck.headMatrix, about(1, 0, 0, f.lid, D.eye.cx, D.eye.cy));
  };
  const nh = <LinearGradient start={vec(42, 0)} end={vec(70, 0)} colors={[p.light, p.accent, p.deep]} positions={[0, 0.45, 1]} />;
  return (
    <Group>
      {/* The neck and head, rebuilt every frame; the neck's root sits behind the chest. */}
      <Rebuilt frame={frame} pick={(n) => { 'worklet'; return n.neck; }}>{nh}</Rebuilt>
      <Rebuilt frame={frame} pick={(n) => { 'worklet'; return n.highlight; }} style="stroke" strokeWidth={1.5} strokeCap="round" color="#fff" opacity={0.26} />
      {/* The beak's root runs under the head, so no turn opens a notch. */}
      <Moving frame={frame} at={head}>
        <Path path={s.beakUpper}>
          <LinearGradient {...across(s.bounds.beak, 0, 0, 0, 1)} colors={['#ffd27a', p.beak]} />
        </Path>
        <Path path={s.beakLower} color={p.beakDeep} />
        <Path path={s.beakSeam} style="stroke" strokeWidth={0.45} strokeCap="round" color={p.beakDeep} opacity={0.7} />
        <Group matrix={sk(turn(6, D.nostril.cx, D.nostril.cy))}>
          <Oval rect={ellipse(D.nostril.cx, D.nostril.cy, D.nostril.rx, D.nostril.ry)} color={p.beakDeep} />
        </Group>
      </Moving>
      <Rebuilt frame={frame} pick={(n) => { 'worklet'; return n.head; }}>{nh}</Rebuilt>
      <Moving frame={frame} at={head}>
        <Path path={s.throatShade} color={p.darkest} opacity={0.22} />
        <Group matrix={sk(turn(-6, D.gloss.cx, D.gloss.cy))}>
          <Oval rect={ellipse(D.gloss.cx, D.gloss.cy, D.gloss.rx, D.gloss.ry)} color="#fff" opacity={0.42} />
        </Group>
        <Path path={s.chinstrap} color="#fff" opacity={0.94} />
      </Moving>
      <Moving frame={frame} at={eye}>
        <Circle cx={D.eye.cx} cy={D.eye.cy} r={D.eye.r} color="#fff" />
        <Circle cx={D.pupil.cx} cy={D.pupil.cy} r={D.pupil.r} color="#14111c" />
        <Circle cx={D.catchlight.cx} cy={D.catchlight.cy} r={D.catchlight.r} color="#fff" />
      </Moving>
      {[0, 1, 2].map((i) => <Ring key={i} frame={frame} i={i} color={p.accent} />)}
      <Group clip={{ x: 0, y: 0, width: 160, height: 99 }}>
        <Moving frame={frame} at={(f) => { 'worklet'; return turn(f.parts.tail, 120, 78); }}>
          <Path path={s.tail[0]} color={p.darkest} />
          <Path path={s.tail[1]}>
            <LinearGradient {...across(s.bounds.tail, 0, 1, 1, 0)} colors={[p.deep, p.darkest]} />
          </Path>
          <Path path={s.tail[2]} color={p.accent} />
        </Moving>
        <Path path={s.body}>
          <LinearGradient {...across(s.bounds.body, 0, 0, 0, 1)} colors={[p.light, p.accent, p.darkest]} positions={[0, 0.45, 1]} />
        </Path>
        <Group clip={s.body}>
          <Path path={s.belly} color={p.darkest} opacity={0.32} />
          <Path path={s.backSheen} color="#fff" opacity={0.34} />
          <Path path={s.chestSheen} color="#fff" opacity={0.2} />
          {s.scallops.map((d, i) => (
            <Path key={i} path={d} style="stroke" strokeWidth={1} strokeCap="round" color="#fff" opacity={i ? 0.16 : 0.22} />
          ))}
        </Group>
        <Moving frame={frame} at={(f) => { 'worklet'; return about(f.parts.wing, 0, 0, f.parts.wing, 76, 82); }}>
          {s.primaries.map((d, i) => (
            <Moving key={i} frame={frame} at={(f) => { 'worklet'; return turn(f.parts.primaries[i], 104, 84); }}>
              <Path path={d}>
                <LinearGradient {...across(s.bounds.primaries[i], 0, 0, 1, 0)} colors={[p.deep, p.darkest]} />
              </Path>
            </Moving>
          ))}
          <Path path={s.wing}>
            <LinearGradient {...across(s.bounds.wing, 0, 0, 1, 1)} colors={[p.accent, p.darkest]} />
          </Path>
          {s.coverts.map((d, i) => (
            <Path key={i} path={d} style="stroke" strokeWidth={i ? 0.8 : 0.9} strokeCap="round" color="#fff" opacity={i ? 0.2 : 0.28} />
          ))}
          <Path path={s.edge} style="stroke" strokeWidth={0.7} strokeCap="round" color={p.darkest} opacity={0.45} />
        </Moving>
      </Group>
    </Group>
  );
}

function Glint({ frame, i, color }: { frame: SharedValue<Frame>; i: number; color: string }) {
  const [cx, cy, rx, ry] = GLINTS[i];
  const m = useDerivedValue(() => {
    const g = frame.get().parts.glints[i];
    return sk(times(shift(g.x, 0), about(g.sx, 0, 0, 1, cx, cy)));
  });
  const opacity = useDerivedValue(() => frame.get().parts.glints[i].opacity);
  return (
    <Group matrix={m} opacity={opacity}>
      <Oval rect={ellipse(cx, cy, rx, ry)} color={color} />
    </Group>
  );
}

function Ripple({ frame, i, color }: { frame: SharedValue<Frame>; i: number; color: string }) {
  const m = useDerivedValue(() => {
    const r = frame.get().parts.ripples[i];
    return sk(about(r.scale, 0, 0, r.scale, 88, 98));
  });
  const opacity = useDerivedValue(() => frame.get().parts.ripples[i].opacity);
  // Hung from the waterline: its top edge stays on it as it spreads, so the ring lies on the water.
  return (
    <Group matrix={m} opacity={opacity}>
      <Oval rect={ellipse(RIPPLE[0], RIPPLE[1], RIPPLE[2], RIPPLE[3])} style="stroke" strokeWidth={1.3} color={color} />
    </Group>
  );
}

function Shadow({ frame }: { frame: SharedValue<Frame> }) {
  const m = useDerivedValue(() => {
    const s = frame.get().parts.shadow;
    return sk(about(s.scale, 0, 0, s.scale, 90, 99));
  });
  const opacity = useDerivedValue(() => frame.get().parts.shadow.opacity);
  return (
    <Group matrix={m} opacity={opacity}>
      <Oval rect={ellipse(90, 99, 46, 4.2)}>
        {/* SVG's radial gradient over the ellipse's own box: a circle squashed to the ellipse's height. */}
        <RadialGradient c={vec(90, 99)} r={46} colors={['rgba(0, 0, 0, 0.26)', 'rgba(0, 0, 0, 0)']} transform={[{ scaleY: 4.2 / 46 }]} origin={vec(90, 99)} />
      </Oval>
    </Group>
  );
}

function Wake({ frame, i, path, color }: { frame: SharedValue<Frame>; i: number; path: SkPath; color: string }) {
  const phase = useDerivedValue(() => frame.get().parts.wake[i].offset);
  const opacity = useDerivedValue(() => frame.get().parts.wake[i].opacity);
  return (
    <Path path={path} style="stroke" strokeWidth={1.3} strokeCap="round" color={color} opacity={opacity}>
      <DashPathEffect intervals={[14, 60]} phase={phase} />
    </Path>
  );
}

/**
 * The pond, back to front: the reflection, the water, the bands that break the reflection, the waves,
 * then the ground over its edges, then the glints, shadow, wake and ripples. The reflection holds the
 * goose's resting pose and moves as a whole with the swell, as the drawn goose's does.
 */
function Pond({ frame, rest, p, s }: { frame: SharedValue<Frame>; rest: SharedValue<Frame>; p: Palette; s: Shapes }) {
  return (
    <>
      <Group clip={{ x: 0, y: 98, width: 160, height: 42 }}>
        <Moving
          frame={frame}
          at={(f) => {
            'worklet';
            const r = f.parts.reflection;
            return times(shift(0, r.y), about(1, 0, Math.tan((r.skew * Math.PI) / 180) * r.sy, r.sy, 88, 98));
          }}
        >
          <Group matrix={sk([1, 0, 0, -1, 0, 196])} layer={s.reflection}>
            <Bird frame={rest} p={p} s={s} />
          </Group>
        </Moving>
      </Group>
      <Rect x={0} y={98} width={160} height={42}>
        <LinearGradient start={vec(0, 98)} end={vec(0, 138)} colors={[alpha(p.accent, 0.24), alpha(p.accent, 0.1), alpha(p.accent, 0)]} positions={[0, 0.45, 1]} />
      </Rect>
      {BANDS.map(([, width, dash], i) => (
        <Moving key={i} frame={frame} at={(f) => { 'worklet'; return shift(f.parts.bands[i], 0); }}>
          <Path path={s.bands[i]} style="stroke" strokeWidth={width} color={p.ground} opacity={0.7}>
            <DashPathEffect intervals={dash.split(' ').map(Number)} />
          </Path>
        </Moving>
      ))}
      {WAVES.map(([, , , width, opacity], i) => (
        <Moving key={i} frame={frame} at={(f) => { 'worklet'; return shift(f.parts.waves[i], 0); }}>
          <Path path={s.waves[i]} style="stroke" strokeWidth={width} strokeCap="round" color={p.accent} opacity={opacity} />
        </Moving>
      ))}
      <Rect x={-40} y={94} width={240} height={50}>
        <LinearGradient start={vec(0, 98)} end={vec(0, 136)} colors={[alpha(p.ground, 0), alpha(p.ground, 0.45), alpha(p.ground, 1)]} positions={[0, 0.45, 1]} />
      </Rect>
      <Rect x={-40} y={94} width={240} height={50}>
        <LinearGradient
          start={vec(4, 0)}
          end={vec(156, 0)}
          colors={[alpha(p.ground, 1), alpha(p.ground, 0), alpha(p.ground, 0), alpha(p.ground, 1)]}
          positions={[0, 0.22, 0.78, 1]}
        />
      </Rect>
      {GLINTS.map((_, i) => <Glint key={i} frame={frame} i={i} color={p.light} />)}
      <Shadow frame={frame} />
      {s.wake.map((path, i) => <Wake key={i} frame={frame} i={i} path={path} color={p.accent} />)}
      {[0, 1].map((i) => <Ripple key={i} frame={frame} i={i} color={p.accent} />)}
    </>
  );
}

export function GooseSkia({ state, size = 150, water = true, ground, still = false }: GooseProps) {
  const reduced = useReduceMotion() || still;
  const p = usePalette(ground);
  const s = useMemo(() => shapes(), []);

  const mood = useSharedValue<GooseMood>(state);
  const clock = useSharedValue(0);
  const listen = useSharedValue(state === 'listening' ? 1 : 0);
  const rest = useSharedValue<Frame>(restFrame(state));
  useEffect(() => {
    mood.set(state);
    rest.set(restFrame(state));
    if (reduced) listen.set(state === 'listening' ? 1 : 0);
  }, [state, reduced, mood, listen, rest]);

  const drawn = useSharedValue(-1);
  useFrameCallback((info) => {
    'worklet';
    const now = info.timeSinceFirstFrame;
    const since = now - drawn.get();
    // A clock that restarts on resuming reads as negative, and draws at once.
    if (drawn.get() >= 0 && since >= 0 && since < 1000 / FPS) return;
    const dt = Math.min(0.1, (since > 0 && drawn.get() >= 0 ? since : 1000 / FPS) / 1000);
    drawn.set(now);
    clock.set(now / 1000);
    listen.set(easeListen(listen.get(), mood.get(), dt));
  }, !reduced);

  const frame = useDerivedValue<Frame>(() => {
    const t = reduced ? 0 : clock.get();
    const m = mood.get(), l = listen.get();
    const pose = neckPose(t, m, l);
    return { neck: neckFrame(pose), lid: pose.lid, parts: reduced ? restingParts(m) : partsFrame(t, m, l) };
  });

  // Drawing units to points: the pond's box is 160 by 140, the bird's own crop 136 by 96 from (22, 6).
  const k = size / (water ? 160 : 136);
  const root = water ? [k, 0, 0, 0, k, 0, 0, 0, 1] : [k, 0, -22 * k, 0, k, -6 * k, 0, 0, 1];
  return (
    <Canvas
      style={{ width: size, height: size * (water ? 140 / 160 : 96 / 136) }}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Group matrix={root}>
        {water ? <Pond frame={frame} rest={rest} p={p} s={s} /> : null}
        <Moving
          frame={frame}
          at={(f) => {
            'worklet';
            const b = f.parts.bob;
            return times(shift(0, b.y), times(about(b.sx, 0, 0, b.sy, 88, 98), turn(f.parts.roll, 88, 98)));
          }}
        >
          <Bird frame={frame} p={p} s={s} />
        </Moving>
        {water ? <Path path={s.waterline} style="stroke" strokeWidth={0.9} strokeCap="round" color={p.light} opacity={0.7} /> : null}
      </Group>
    </Canvas>
  );
}
