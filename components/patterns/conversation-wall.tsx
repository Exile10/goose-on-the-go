/**
 * ConversationWall — the cards, two columns wide, newest first.
 *
 * The desktop's wall is a CSS grid of 48px rows that each card spans three,
 * four or five of. A card here grows to hold its whole preview instead, so
 * each one goes under the shorter column at the height it drew. Until it has
 * drawn, its weight's grid frame stands in for that height: the loading wall
 * and a card far down the wall are both placed that way.
 *
 * That is what lets it window. Every card has a frame before it draws, so only
 * the ones near the viewport are mounted: a Pond that has run a daily schedule
 * for a year has several hundred conversations, and each card is an edge, a
 * plate and an animated face. The cards below one that measured differently
 * move to match, which happens below the screen more often than on it.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native';
import { useInkTheme } from '@/components/ui/ink';

import { ConversationCard, GhostCard } from '@/components/patterns/conversation-card';
import {
  WEIGHT_SPAN,
  placeOnWall,
  type CardWeight,
  type HistoryCard,
} from '@/view-models/use-chat-history';

/** The grid unit, the desktop's own: three spans are a tile, five a column. */
const ROW = 48;

/**
 * Between cards, both ways. The plate reserves 4pt of each card's frame on
 * its trailing edges, so faces stand 16pt apart — the desktop's gap.
 */
export const WALL_GAP = 12;

/** The page margin, matching the bar's own inset from the screen edge. */
export const WALL_GUTTER = 16;

/** Below this a column is too narrow for a title, and the wall goes single. */
const MIN_COLUMN = 150;

/** How far past the viewport cards stay mounted, in screen heights. */
const OVERSCAN = 1;

/** Before any card has drawn. */
const NOT_DRAWN: ReadonlyMap<string, number> = new Map();

/** The loading wall: the desktop's six, in its order. */
const GHOSTS: CardWeight[] = ['card', 'tile', 'column', 'tile', 'card', 'tile'];

function columnsFor(width: number) {
  const inner = width - WALL_GUTTER * 2;
  const columns = (inner - WALL_GAP) / 2 >= MIN_COLUMN ? 2 : 1;
  return { columns, column: Math.floor((inner - WALL_GAP * (columns - 1)) / columns) };
}

const gridHeight = (weight: CardWeight) => WEIGHT_SPAN[weight] * ROW + (WEIGHT_SPAN[weight] - 1) * WALL_GAP;

/** The loading wall, on the desktop's grid. */
function frames(weights: CardWeight[], width: number) {
  const { columns, column } = columnsFor(width);
  const slots = placeOnWall(weights, columns);
  const step = ROW + WALL_GAP;
  let height = 0;
  const placed = slots.map((slot) => {
    const frame = {
      left: slot.column * (column + WALL_GAP),
      top: slot.row * step,
      width: column,
      height: slot.span * ROW + (slot.span - 1) * WALL_GAP,
    };
    height = Math.max(height, frame.top + frame.height);
    return frame;
  });
  return { placed, height };
}

/** The cards, each under the shorter column at its drawn height, or its grid height until it has drawn. */
export function cardFrames(cards: HistoryCard[], width: number, drawn: ReadonlyMap<string, number>) {
  const { columns, column } = columnsFor(width);
  const tops = new Array<number>(columns).fill(0);
  let height = 0;
  const placed = cards.map((card) => {
    let c = 0;
    for (let i = 1; i < columns; i += 1) if (tops[i] < tops[c]) c = i;
    const h = drawn.get(card.id) ?? gridHeight(card.weight);
    const frame = { left: c * (column + WALL_GAP), top: tops[c], width: column, height: h };
    tops[c] += h + WALL_GAP;
    height = Math.max(height, frame.top + h);
    return frame;
  });
  return { placed, height };
}

export interface ConversationWallProps {
  cards: HistoryCard[];
  loading: boolean;
  /** Title, subtitle, notices — whatever scrolls above the cards. */
  header: React.ReactNode;
  /** What to show when there are no cards and nothing is loading. */
  empty: React.ReactNode;
  confirmingId: string | null;
  /** Choosing several: every card lies flat, and a touch toggles instead of opening. */
  selecting: boolean;
  selected: ReadonlySet<string>;
  onOpen: (id: string) => void;
  onAskDelete: (id: string) => void;
  onDelete: (id: string) => void;
  onKeep: () => void;
  onToggle: (id: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
  /** The chrome provider's reader, so the bar follows this list. */
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle: number;
  /** Room at the foot for the bar and the controls floating over it. */
  bottomInset: number;
}

export function ConversationWall({
  cards,
  loading,
  header,
  empty,
  confirmingId,
  selecting,
  selected,
  onOpen,
  onAskDelete,
  onDelete,
  onKeep,
  onToggle,
  refreshing,
  onRefresh,
  onScroll,
  scrollEventThrottle,
  bottomInset,
}: ConversationWallProps) {
  const theme = useInkTheme();
  const { width, height: screen } = useWindowDimensions();

  // Heights as drawn, kept while the wall is up so a card scrolled away keeps its place.
  // A new width rewraps every preview, so what was measured at the old one no longer holds.
  const [drawn, setDrawn] = useState<{ width: number; heights: ReadonlyMap<string, number> }>(() => ({
    width,
    heights: NOT_DRAWN,
  }));
  const onMeasure = useCallback(
    (id: string, height: number) => {
      setDrawn((prev) => {
        const heights = prev.width === width ? prev.heights : NOT_DRAWN;
        const was = heights.get(id);
        if (heights === prev.heights && was !== undefined && Math.abs(was - height) < 0.5) return prev;
        return { width, heights: new Map(heights).set(id, height) };
      });
    },
    [width],
  );
  const heights = drawn.width === width ? drawn.heights : NOT_DRAWN;

  const wall = useMemo(
    () => (loading ? frames(GHOSTS, width) : cardFrames(cards, width, heights)),
    [cards, loading, width, heights],
  );

  // Where the cards begin inside the scroll content, below the header.
  const [wallTop, setWallTop] = useState(0);

  // The visible band, in steps of half a screen. A step only changes a few
  // times per screenful scrolled, so the wall re-renders that often and not
  // on every frame of the gesture.
  const bandSize = Math.max(200, Math.round(screen / 2));
  const [band, setBand] = useState(0);
  const bandRef = useRef(0);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      onScroll(e);
      const next = Math.floor(Math.max(0, e.nativeEvent.contentOffset.y) / bandSize);
      if (next !== bandRef.current) {
        bandRef.current = next;
        setBand(next);
      }
    },
    [onScroll, bandSize],
  );

  const from = band * bandSize - wallTop - screen * OVERSCAN;
  const to = band * bandSize - wallTop + screen * (1 + OVERSCAN) + bandSize;
  const near = (frame: { top: number; height: number }) =>
    frame.top + frame.height >= from && frame.top <= to;

  const frameStyle = (frame: (typeof wall.placed)[number], sized: boolean): ViewStyle => ({
    position: 'absolute',
    left: frame.left,
    top: frame.top,
    width: frame.width,
    height: sized ? frame.height : undefined,
  });

  const showEmpty = !loading && cards.length === 0;

  return (
    <ScrollView
      onScroll={handleScroll}
      scrollEventThrottle={scrollEventThrottle}
      showsVerticalScrollIndicator={false}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: bottomInset }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.color.textSecondary}
          colors={[theme.color.accent]}
          progressBackgroundColor={theme.color.surface}
        />
      }
    >
      {header}
      {showEmpty ? (
        empty
      ) : (
        <View
          onLayout={(e) => setWallTop(e.nativeEvent.layout.y)}
          style={[styles.wall, { height: wall.height }]}
          accessibilityRole={loading ? 'progressbar' : undefined}
          accessibilityState={loading ? { busy: true } : undefined}
        >
          {loading
            ? wall.placed.map((frame, i) => <GhostCard key={i} style={frameStyle(frame, true)} />)
            : cards.map((card, i) => {
                const frame = wall.placed[i];
                if (!frame || !near(frame)) return null;
                return (
                  <ConversationCard
                    key={card.id}
                    card={card}
                    confirming={confirmingId === card.id}
                    selecting={selecting}
                    selected={selected.has(card.id)}
                    onOpen={onOpen}
                    onAskDelete={onAskDelete}
                    onDelete={onDelete}
                    onKeep={onKeep}
                    onToggle={onToggle}
                    onMeasure={onMeasure}
                    style={frameStyle(frame, false)}
                  />
                );
              })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wall: { marginHorizontal: WALL_GUTTER },
});
