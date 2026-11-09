/**
 * ConversationList — the wall's conversations, read as an index instead.
 *
 * The wall is for scanning: every card on the edge, sized by how much was
 * said. This is for finding: one line of title and the whole preview, set as
 * markdown as on the cards, under a heading that says roughly when. So nothing here wears the edge. The rows
 * lie flat on the page between hairlines — a list in which every row is
 * raised is a list in which nothing is.
 *
 * A `SectionList` rather than the wall's windowed scroll view, because a
 * row's height is not known before it draws: a preview of any length, and a
 * question about deleting when one is asked. The list measures as
 * it goes and mounts only what is near the viewport, which is what the wall
 * gets from its own arithmetic.
 *
 * The headings stick while their rows pass beneath them, on the page's own
 * colour, so whatever is scrolling past is always named.
 *
 * Everything else is the wall's: the same header and empty states, the same
 * long press asking Delete or Keep in place, the same pull to refresh, and the
 * same way of choosing several. A flat row has no plate to rise onto, so a
 * chosen one takes the accent's faintest tint instead, beside a filled circle.
 */

import React, { useCallback, useMemo } from 'react';
import {
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type SectionListData,
  type SectionListRenderItemInfo,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkSkeleton, InkTitle, inkText, useInkTheme } from '@/components/ui/ink';

import {
  AnsweringMark,
  DeleteOrKeep,
  LONG_PRESS_MS,
  SelectMark,
  cardWords,
  deleteActions,
} from '@/components/patterns/conversation-card';
import { Markdown } from '@/components/patterns/markdown';
import { WALL_GUTTER } from '@/components/patterns/conversation-wall';
import { GPressable } from '@/components/ui/g-pressable';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';
import type { HistoryCard, HistorySection } from '@/view-models/use-chat-history';

/** The loading list, in rows: a title's width, then each preview line's. */
const GHOSTS: { title: `${number}%`; lines: `${number}%`[] }[] = [
  { title: '62%', lines: ['92%', '70%'] },
  { title: '44%', lines: ['84%'] },
  { title: '70%', lines: ['95%', '52%'] },
  { title: '38%', lines: ['80%', '66%'] },
  { title: '56%', lines: ['88%'] },
  { title: '66%', lines: ['90%', '58%'] },
];

const keyOf = (card: HistoryCard) => card.id;

function useRowText() {
  const theme = useInkTheme();
  return useMemo(
    () => ({
      title: inkText(theme, {
        role: 'display',
        size: 'md',
        weight: theme.weight.semibold,
        tracking: 'snug',
        leading: 'snug',
      }).style,
      meta: inkText(theme, {
        role: 'mono',
        size: 'xs',
        weight: theme.weight.medium,
        color: theme.color.textTertiary,
      }).style,
    }),
    [theme],
  );
}

export interface ConversationRowProps {
  card: HistoryCard;
  /** Showing Delete and Keep under the preview. */
  confirming: boolean;
  /** Choosing several: a touch toggles this row rather than opening it. */
  selecting: boolean;
  selected: boolean;
  onOpen: (id: string) => void;
  onAskDelete: (id: string) => void;
  onDelete: (id: string) => void;
  onKeep: () => void;
  onToggle: (id: string) => void;
}

export const ConversationRow = React.memo(function ConversationRow({
  card,
  confirming,
  selecting,
  selected,
  onOpen,
  onAskDelete,
  onDelete,
  onKeep,
  onToggle,
}: ConversationRowProps) {
  const theme = useInkTheme();
  const text = useRowText();
  const { t } = useTranslation();

  const { title, label } = cardWords(card, t);
  // Beside the time rather than on a line of its own, so a routine's row is no
  // taller than a chat's.
  const meta = [card.routine ? t('chat.history.routine') : '', card.when]
    .filter(Boolean)
    .join(' · ');

  const onAction = (e: AccessibilityActionEvent) => {
    const name = e.nativeEvent.actionName;
    if (name === 'keep') onKeep();
    else if (name === 'delete') {
      if (confirming) onDelete(card.id);
      else onAskDelete(card.id);
    }
  };

  return (
    <GPressable
      feedback="tint"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t(
        selecting
          ? selected
            ? 'chat.history.deselectHint'
            : 'chat.history.selectHint'
          : 'chat.history.openHint',
      )}
      accessibilityState={selecting ? { selected } : undefined}
      accessibilityActions={selecting ? undefined : deleteActions(confirming, t)}
      onAccessibilityAction={selecting ? undefined : onAction}
      // As on a card: while the row is asking, a touch anywhere else on it is
      // "never mind", and while the list is being chosen from it is a choice.
      onPress={() => (selecting ? onToggle(card.id) : confirming ? onKeep() : onOpen(card.id))}
      onLongPress={selecting ? undefined : () => onAskDelete(card.id)}
      delayLongPress={LONG_PRESS_MS}
      style={[
        local.row,
        {
          gap: theme.space[3],
          paddingVertical: theme.space[3],
          minHeight: theme.touch.tapMin,
        },
        selecting && selected ? { backgroundColor: theme.color.accentSofter } : null,
      ]}
    >
      {selecting ? <SelectMark selected={selected} /> : null}
      <View style={local.body}>
        <View style={[local.line, { gap: theme.space[3] }]}>
          <Text style={[text.title, local.title]} numberOfLines={1}>
            {title}
          </Text>
          {card.answering ? (
            <AnsweringMark />
          ) : meta ? (
            <Text style={text.meta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        {card.preview ? <Markdown source={card.preview} size="base" tone="tertiary" selectable={false} /> : null}
        {confirming ? (
          <DeleteOrKeep
            deleteLabel={t('chat.history.deleteLabel')}
            onDelete={() => onDelete(card.id)}
            onKeep={onKeep}
            style={{ marginTop: theme.space[2] }}
          />
        ) : null}
      </View>
    </GPressable>
  );
});

/** Between rows, inset to the gutter the text keeps. */
function Separator() {
  const theme = useInkTheme();
  return (
    <View
      style={[
        local.rule,
        { height: theme.edge.hairlineWidth, backgroundColor: theme.color.line },
      ]}
    />
  );
}

/** A section's heading, on the page's colour so the rows sliding under it stay under it. */
function SectionHead({ title }: { title: string }) {
  const theme = useInkTheme();
  const page = useThemedStyles(makePageStyles);
  return (
    <View style={[page.head, { paddingTop: theme.space[4], paddingBottom: theme.space[1] }]}>
      <InkTitle level={3}>{title}</InkTitle>
    </View>
  );
}

/**
 * The list's shape before its contents: a heading and a few rows, in Ink's
 * still skeleton bars, as the wall's ghosts are.
 */
function GhostRows() {
  const theme = useInkTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityState={{ busy: true }} style={local.ghosts}>
      <View
        aria-hidden
        style={[local.gutter, { paddingTop: theme.space[4], paddingBottom: theme.space[2] }]}
      >
        <InkSkeleton width="30%" height={16} />
      </View>
      {GHOSTS.map((ghost, i) => (
        <View key={i} aria-hidden>
          {i > 0 ? <Separator /> : null}
          <View style={[local.gutter, { paddingVertical: theme.space[3], gap: theme.space[2] }]}>
            <InkSkeleton width={ghost.title} height={15} />
            {ghost.lines.map((width, j) => (
              <InkSkeleton key={j} width={width} height={11} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export interface ConversationListProps {
  sections: HistorySection[];
  loading: boolean;
  /** Title, subtitle, notices — the same header the wall scrolls. */
  header: React.ReactElement;
  /** What to show when there is nothing to list and nothing loading. */
  empty: React.ReactElement | null;
  confirmingId: string | null;
  selecting: boolean;
  selected: ReadonlySet<string>;
  onOpen: (id: string) => void;
  onAskDelete: (id: string) => void;
  onDelete: (id: string) => void;
  onKeep: () => void;
  onToggle: (id: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
  /** The chrome provider's reader, so the bar follows this list as it follows the wall. */
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle: number;
  /** Room at the foot for the bar and the controls floating over it. */
  bottomInset: number;
}

export function ConversationList({
  sections,
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
}: ConversationListProps) {
  const theme = useInkTheme();

  const renderItem = useCallback(
    ({ item }: SectionListRenderItemInfo<HistoryCard, HistorySection>) => (
      <ConversationRow
        card={item}
        confirming={confirmingId === item.id}
        selecting={selecting}
        selected={selected.has(item.id)}
        onOpen={onOpen}
        onAskDelete={onAskDelete}
        onDelete={onDelete}
        onKeep={onKeep}
        onToggle={onToggle}
      />
    ),
    [confirmingId, selecting, selected, onOpen, onAskDelete, onDelete, onKeep, onToggle],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: SectionListData<HistoryCard, HistorySection> }) => (
      <SectionHead title={section.title} />
    ),
    [],
  );

  // What the rows read besides their own card, so the list redraws the ones
  // on screen when it changes rather than only when the cards do.
  const extraData = useMemo(
    () => ({ confirmingId, selecting, selected }),
    [confirmingId, selecting, selected],
  );

  return (
    <SectionList
      sections={sections}
      keyExtractor={keyOf}
      renderItem={renderItem}
      renderSectionHeader={renderSectionHeader}
      ItemSeparatorComponent={Separator}
      ListHeaderComponent={header}
      ListEmptyComponent={loading ? <GhostRows /> : empty}
      extraData={extraData}
      stickySectionHeadersEnabled
      initialNumToRender={14}
      onScroll={onScroll}
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
    />
  );
}

const makePageStyles = (c: ThemeColors) =>
  StyleSheet.create({
    head: { backgroundColor: c.background, paddingHorizontal: WALL_GUTTER },
  });

const local = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: WALL_GUTTER },
  body: { flex: 1, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'baseline' },
  title: { flex: 1 },
  rule: { marginHorizontal: WALL_GUTTER },
  gutter: { paddingHorizontal: WALL_GUTTER },
  ghosts: { opacity: 0.7 },
});
