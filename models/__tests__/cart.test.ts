/**
 * Watched links: prices compared only in one currency, a pasted link found in whatever was pasted,
 * and the history drawn as a line only when there is a line to draw.
 */

import { atLowest, atTarget, cartWrite, linkFromPaste, priceMove, readCart, readCartItem, sparkline, targetFrom } from '@/models/cart';

const item = {
  id: 'c-1',
  url: 'https://autochek.africa/ke/car/1',
  title: 'Toyota Fielder 2016',
  picture: '/api/v1/report-images/f',
  site: 'Autochek',
  price: { amount: 1150000, currency: 'KSh' },
  previous: { amount: 1190000, currency: 'KSh' },
  lowest: { amount: 1150000, currency: 'KSh' },
  highest: { amount: 1240000, currency: 'KSh' },
  target: { amount: 1200000, currency: 'KSh' },
  in_stock: true,
  history: [
    { at: '2026-11-05T00:00:00Z', amount: 1240000 },
    { at: '2026-11-01T00:00:00Z', amount: 1240000 },
    { at: '2026-11-09T00:00:00Z', amount: 1150000 },
  ],
  status: 'ok',
  checked_at: '2026-11-09T08:00:00Z',
  next_check_at: null,
  every_hours: 12,
  collection: 'Fielder',
  notify: 'drop',
};

describe('reading a watched link', () => {
  it('keeps its prices and sorts its history oldest first', () => {
    const read = readCartItem(item)!;
    expect(read.history.map((h) => h.amount)).toEqual([1240000, 1240000, 1150000]);
    expect(read).toMatchObject({ site: 'Autochek', everyHours: 12, inStock: true, status: 'ok' });
  });

  it('reads unknown choices as the quietest, and a link with no address as none', () => {
    expect(readCartItem({ ...item, notify: 'every_second', status: 'exploded', every_hours: -3 })).toMatchObject({ notify: 'drop', status: 'ok', everyHours: 24 });
    expect(readCartItem({ ...item, url: 'not a link' })).toBeNull();
    expect(readCart({ items: [item, {}] })).toHaveLength(1);
  });

  it('says how the price moved, only within one currency', () => {
    expect(priceMove(readCartItem(item)!)).toEqual({ direction: 'down', by: { amount: 40000, currency: 'KSh' } });
    expect(priceMove({ price: { amount: 10, currency: 'USD' }, previous: { amount: 12, currency: 'KSh' } })).toBeNull();
    expect(priceMove({ price: { amount: 10, currency: 'KSh' }, previous: { amount: 10, currency: 'KSh' } })).toBeNull();
  });

  it('knows when it is at the member’s price and at its lowest', () => {
    const read = readCartItem(item)!;
    expect(atTarget(read)).toBe(true);
    expect(atLowest(read)).toBe(true);
    expect(atTarget({ ...read, target: null })).toBe(false);
  });
});

describe('drawing and typing', () => {
  it('draws history across the box, and nothing for fewer than two points', () => {
    const points = sparkline(readCartItem(item)!.history, 100, 20, 0);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[2]).toEqual({ x: 100, y: 20 });
    expect(sparkline([{ at: '2026-11-01T00:00:00Z', amount: 5 }], 100, 20)).toEqual([]);
  });

  it('finds the link in a pasted share text', () => {
    expect(linkFromPaste('Look at this one https://jiji.co.ke/cars/fielder-1). Nice?')).toBe('https://jiji.co.ke/cars/fielder-1');
    expect(linkFromPaste('no link here')).toBeNull();
  });

  it('reads a typed target in the link’s currency', () => {
    expect(targetFrom('1,100,000', 'KSh')).toEqual({ amount: 1100000, currency: 'KSh' });
    expect(targetFrom('', 'KSh')).toBeNull();
    expect(cartWrite({ notify: 'any', everyHours: 6 })).toEqual({ notify: 'any', every_hours: 6 });
  });
});
