/**
 * The wall places a card by the height it drew, so a card can grow to hold its whole preview, and
 * by its weight's grid height until it has drawn.
 */

import { WALL_GAP, WALL_GUTTER, cardFrames } from '@/components/patterns/conversation-wall';
import type { HistoryCard } from '@/view-models/use-chat-history';

jest.mock('@/components/patterns/conversation-card', () => ({ ConversationCard: () => null, GhostCard: () => null }));

// Wide enough for two columns of 150 or more.
const WIDTH = 2 * WALL_GUTTER + 2 * 160 + WALL_GAP;

const card = (id: string, weight: HistoryCard['weight'] = 'tile') => ({ id, weight }) as HistoryCard;

describe('cardFrames', () => {
  it('stands a card that has not drawn on its weight’s grid height', () => {
    const { placed } = cardFrames([card('a', 'tile'), card('b', 'column')], WIDTH, new Map());
    expect(placed[0].height).toBe(3 * 48 + 2 * WALL_GAP);
    expect(placed[1].height).toBe(5 * 48 + 4 * WALL_GAP);
  });

  it('places a drawn card at its own height, and the next under the shorter column', () => {
    const drawn = new Map([
      ['a', 400],
      ['b', 100],
    ]);
    const { placed, height } = cardFrames([card('a'), card('b'), card('c')], WIDTH, drawn);

    expect(placed[0]).toMatchObject({ left: 0, top: 0, height: 400 });
    expect(placed[1].left).toBeGreaterThan(0);
    expect(placed[1]).toMatchObject({ top: 0, height: 100 });
    // Under b, the shorter column, not under a.
    expect(placed[2]).toMatchObject({ left: placed[1].left, top: 100 + WALL_GAP });
    expect(height).toBe(400);
  });
});
