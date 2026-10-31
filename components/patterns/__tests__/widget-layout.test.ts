/**
 * Home's board: widgets land where they were arranged, a band of small ones ends on one edge, and
 * a move puts a widget exactly where it was dropped.
 */

import { moveTo, stagger, stepAmong, tileAt, type Tile } from '../widget-layout';

const WIDTH = 208;
const GAP = 8;
const COLUMN = 100;

const heights: Record<string, number> = { wide: 60, a: 100, b: 80, c: 40, d: 70, tail: 50 };
const place = (tiles: Tile[]) => stagger(tiles, (key) => heights[key], WIDTH, GAP);
const small = (key: string): Tile => ({ key, span: 1 });
const wide = (key: string): Tile => ({ key, span: 2 });

describe('stagger', () => {
  it('lays small widgets left then right in turn, whatever their heights', () => {
    const { rects } = place([small('a'), small('b'), small('c'), small('d')]);
    expect([rects.a.x, rects.b.x, rects.c.x, rects.d.x]).toEqual([0, COLUMN + GAP, 0, COLUMN + GAP]);
    expect(rects.c.y).toBe(100 + GAP);
    expect(rects.d.y).toBe(80 + GAP);
  });

  it('ends a band on one edge, by growing the shorter column\'s last widget', () => {
    const { rects } = place([small('a'), small('b'), small('c'), small('d'), wide('tail')]);
    const left = rects.c.y + rects.c.height;
    const right = rects.d.y + rects.d.height;
    expect(left).toBe(right);
    // Left reached 156 and right 166, so the left column's last widget took the 10 between.
    expect(rects.c.height).toBe(50);
    expect(rects.d.height).toBe(70);
    expect(rects.tail.y).toBe(left + GAP);
  });

  it('gives a small widget alone in its band the whole row', () => {
    const { rects } = place([wide('wide'), small('a'), wide('tail')]);
    expect(rects.a).toEqual({ x: 0, y: 60 + GAP, width: WIDTH, height: 100 });
    expect(rects.tail.y).toBe(60 + GAP + 100 + GAP);
  });

  it('is as tall as its last widget reaches, and nothing when empty', () => {
    expect(place([wide('wide'), wide('tail')]).height).toBe(60 + GAP + 50);
    expect(place([]).height).toBe(0);
  });
});

describe('tileAt', () => {
  const { rects } = place([small('a'), small('b'), wide('tail')]);

  it('finds the widget under a point, never the one being carried', () => {
    expect(tileAt(rects, 150, 20, 'a')).toBe('b');
    expect(tileAt(rects, 20, 20, 'a')).toBeNull();
    expect(tileAt(rects, 20, 140, 'a')).toBe('tail');
  });
});

describe('moveTo', () => {
  it('puts a widget where the one it was dropped on was, in either direction', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTo(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('leaves the order alone for a drop on itself or on nothing it knows', () => {
    const order = ['a', 'b'];
    expect(moveTo(order, 'a', 'a')).toBe(order);
    expect(moveTo(order, 'a', 'z')).toBe(order);
  });
});

describe('stepAmong', () => {
  it('steps past a widget that is not on screen, so every step visibly moves', () => {
    expect(stepAmong(['a', 'hidden', 'b', 'c'], ['a', 'b', 'c'], 'a', 1)).toEqual(['hidden', 'b', 'a', 'c']);
    expect(stepAmong(['a', 'b', 'c'], ['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
  });

  it('goes no further than either end', () => {
    const order = ['a', 'b'];
    expect(stepAmong(order, order, 'a', -1)).toBe(order);
    expect(stepAmong(order, order, 'b', 1)).toBe(order);
  });
});
