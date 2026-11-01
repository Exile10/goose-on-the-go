/**
 * Where each of Home's widgets goes: two columns, small widgets left then right in turn, a wide one
 * across both. Pure, so placement and every move are tested without a screen.
 */

export type Span = 1 | 2;

export interface Tile {
  key: string;
  span: Span;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Board {
  rects: Record<string, Rect>;
  height: number;
}

/**
 * Stagger the tiles in order. Small tiles between two wide ones form a band, and a band always ends
 * on one edge: the shorter column's last tile grows to meet the other, or a tile alone in its band
 * takes the whole row, because a half-empty row reads as something missing.
 *
 * Columns alternate rather than filling whichever is shorter. Shorter-first packs tighter, but it
 * puts a widget in a different column folded than open, so a rearrangement would not stay where
 * it was put.
 */
export function stagger(tiles: Tile[], heightOf: (key: string) => number, width: number, gap: number): Board {
  const column = (width - gap) / 2;
  const rects: Record<string, Rect> = {};
  const bottoms: [number, number] = [0, 0];
  let lastIn: [string | null, string | null] = [null, null];
  let band: string[] = [];

  const closeBand = () => {
    if (band.length === 1) {
      const r = rects[band[0]];
      rects[band[0]] = { x: 0, y: r.y, width, height: r.height };
      bottoms[0] = bottoms[1] = r.y + r.height + gap;
    } else if (band.length > 1) {
      const short = bottoms[0] < bottoms[1] ? 0 : 1;
      const key = lastIn[short];
      const reach = bottoms[1 - short] - bottoms[short];
      if (key && reach > 0) rects[key] = { ...rects[key], height: rects[key].height + reach };
      bottoms[short] = bottoms[1 - short];
    }
    band = [];
    lastIn = [null, null];
  };

  for (const tile of tiles) {
    const height = heightOf(tile.key);
    if (tile.span === 2) {
      closeBand();
      const y = Math.max(bottoms[0], bottoms[1]);
      rects[tile.key] = { x: 0, y, width, height };
      bottoms[0] = bottoms[1] = y + height + gap;
    } else {
      const c = band.length % 2;
      rects[tile.key] = { x: c * (column + gap), y: bottoms[c], width: column, height };
      bottoms[c] += height + gap;
      lastIn[c] = tile.key;
      band.push(tile.key);
    }
  }
  closeBand();

  return { rects, height: tiles.length > 0 ? Math.max(bottoms[0], bottoms[1]) - gap : 0 };
}

/** The tile under a point, other than the one being carried. */
export function tileAt(rects: Record<string, Rect>, x: number, y: number, except: string): string | null {
  for (const [key, r] of Object.entries(rects)) {
    if (key === except) continue;
    if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return key;
  }
  return null;
}

/** `key` moved to where `target` is, which pushes `target` one place on in the direction moved. */
export function moveTo(order: string[], key: string, target: string): string[] {
  const to = order.indexOf(target);
  if (key === target || to < 0 || !order.includes(key)) return order;
  const next = order.filter((k) => k !== key);
  next.splice(to, 0, key);
  return next;
}

/**
 * One step earlier or later among the tiles on screen. A widget with nothing to say is still in
 * the order, so stepping past it would look like a step that did nothing.
 */
export function stepAmong(order: string[], shown: string[], key: string, delta: -1 | 1): string[] {
  const at = shown.indexOf(key);
  const target = shown[at + delta];
  return at < 0 || target === undefined ? order : moveTo(order, key, target);
}
