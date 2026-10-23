/**
 * ConversationCard — one conversation on the wall, on Ink's edge.
 *
 * pond-desktop's history card, rebuilt from the native edge rather than
 * restyled: a raised face over its plate, driven down into it on touch, so it
 * reads as a key being struck rather than a rectangle getting darker. Inside,
 * the same four things in the same order — the mono "when", the title, a
 * preview that runs out rather than stopping, and the count at the foot.
 *
 * Built on `InkEdge` rather than `InkCard` for one reason: `InkCard` fixes the
 * radius at `lg`, and a tall narrow tile at 14 reads as a form field. `xl` is
 * the radius the floating bar below already uses, so the wall and the bar are
 * cut from the same corner. Nothing is painted over the edge — the card's own
 * style carries its frame and nothing else.
 *
 * A long press asks to delete, the desktop's hover affordance moved to where a
 * finger can reach it. The question is answered on the card, as there: Delete
 * or Keep, no dialog. A screen reader gets the same thing as a custom action.
 *
 * While several are being chosen for deleting, every card lies flat on a
 * hairline and a chosen one rises onto its plate. Elevation is how Ink says
 * "chosen", so the wall says it that way too. The circle in the corner is the
 * platform's mark for the mode rather than for the choice: it is on every
 * card, so a reader can see that a tap will choose rather than open.
 */

import React, { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { alpha, hitSlop } from '@jarida/ink';
import { InkEdge, InkEyebrow, InkSkeleton, InkSpinner, inkText, useInkTheme } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import type { HistoryCard } from '@/view-models/use-chat-history';

export interface ConversationCardProps {
  card: HistoryCard;
  /** Showing Delete and Keep in place of the count. */
  confirming: boolean;
  /** The wall is choosing several: a touch toggles this card rather than opening it. */
  selecting?: boolean;
  selected?: boolean;
  onOpen: (id: string) => void;
  onAskDelete: (id: string) => void;
  onDelete: (id: string) => void;
  onKeep: () => void;
  onToggle?: (id: string) => void;
  /** The card's frame on the wall. Layout only. */
  style?: StyleProp<ViewStyle>;
}

/** How long a finger rests before the card asks about deleting. The list's rows wait as long. */
export const LONG_PRESS_MS = 380;

/**
 * The Delete and Keep pills, drawn small so both fit a narrow tile's foot and
 * reaching the 44pt floor vertically only — sideways reach would let the two
 * steal each other's taps.
 */
const ANSWER_HEIGHT = 30;

/** The selection circle's diameter: about the height of the "when" line it sits beside. */
export const SELECT_MARK = 22;

/**
 * What a conversation is called and what a screen reader hears for it. The
 * list's rows use this too, so the two layouts read a conversation out alike.
 */
export function cardWords(card: HistoryCard, t: TFunction) {
  const title = card.title ?? t('chat.history.untitled');
  const count =
    card.messageCount > 0 ? t('chat.history.messages', { count: card.messageCount }) : '';
  const foot = [card.routine ? t('chat.history.routine') : '', count].filter(Boolean).join(' · ');
  const answering = card.answering ? t('chat.history.answeringLabel') : '';
  return { title, foot, label: [title, card.when, answering, foot].filter(Boolean).join(', ') };
}

/**
 * Goose still answering in a conversation: the spinner a reply carries under
 * it in the thread, and the word, in the foot's own type. The list's rows show
 * it in place of the time.
 */
export function AnsweringMark() {
  const theme = useInkTheme();
  const text = useCardText();
  const { t } = useTranslation();
  return (
    <View style={[local.answering, { gap: theme.space[2] }]}>
      <InkSpinner label={t('chat.history.answeringLabel')} size={12} />
      <Text style={[text.foot, { color: theme.color.textSecondary }]} numberOfLines={1}>
        {t('chat.history.answering')}
      </Text>
    </View>
  );
}

/**
 * The long press, for a screen reader. A card or a row is one element to it,
 * so the pills inside cannot be reached on their own; while it is asking, the
 * two answers are actions on the element instead.
 */
export function deleteActions(confirming: boolean, t: TFunction) {
  return confirming
    ? [
        { name: 'delete', label: t('chat.history.delete') },
        { name: 'keep', label: t('chat.history.keep') },
      ]
    : [{ name: 'delete', label: t('chat.history.deleteLabel') }];
}

function useCardText() {
  const theme = useInkTheme();
  return useMemo(() => {
    const preview = inkText(theme, { size: 'base', color: theme.color.textTertiary });
    return {
      title: inkText(theme, {
        role: 'display',
        size: 'md',
        weight: theme.weight.bold,
        tracking: 'snug',
        leading: 'snug',
      }).style,
      preview: preview.style,
      previewLine: preview.style.lineHeight ?? 20,
      foot: inkText(theme, {
        role: 'mono',
        size: 'xs',
        weight: theme.weight.medium,
        color: theme.color.textTertiary,
      }).style,
      yes: inkText(theme, {
        size: 'sm',
        weight: theme.weight.semibold,
        color: theme.color.dangerFg,
      }).style,
      no: inkText(theme, {
        size: 'sm',
        weight: theme.weight.semibold,
        color: theme.color.textSecondary,
      }).style,
    };
  }, [theme]);
}

/**
 * The circle that says the wall is being chosen from: hollow on everything,
 * and on what has been chosen filled the way Ink's own checkbox fills — the
 * accent inside an edge, a check on top. It is drawn and nothing more; the
 * card or row it sits on carries the state for a screen reader.
 */
export function SelectMark({
  selected,
  style,
}: {
  selected: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useInkTheme();
  return (
    <View
      pointerEvents="none"
      aria-hidden
      style={[
        local.mark,
        {
          borderWidth: theme.edge.borderWidth,
          borderColor: selected ? theme.color.edge : theme.color.textTertiary,
          backgroundColor: selected ? theme.color.accent : 'transparent',
        },
        style,
      ]}
    >
      {selected ? (
        <GIcon name="check" size={14} color={theme.color.textOnAccent} strokeWidth={3} />
      ) : null}
    </View>
  );
}

/**
 * Delete or Keep, asked in place rather than in a dialog, as the desktop asks
 * it. The list's rows and the selection bar ask with these same two pills, so
 * the question looks the same wherever it comes up.
 */
export function DeleteOrKeep({
  deleteLabel,
  onDelete,
  onKeep,
  style,
}: {
  /** What a screen reader hears for Delete: which conversation, or how many. */
  deleteLabel: string;
  onDelete: () => void;
  onKeep: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useInkTheme();
  const text = useCardText();
  const { t } = useTranslation();

  return (
    <View style={[local.confirm, { gap: theme.space[2] }, style]}>
      <GPressable
        feedback="tint"
        accessibilityRole="button"
        accessibilityLabel={deleteLabel}
        hitSlop={hitSlop(ANSWER_HEIGHT)}
        onPress={onDelete}
        style={[
          local.answer,
          {
            borderColor: theme.color.dangerFg,
            borderWidth: theme.edge.hairlineWidth,
            paddingHorizontal: theme.space[3],
          },
        ]}
      >
        <Text style={text.yes}>{t('chat.history.delete')}</Text>
      </GPressable>
      <GPressable
        feedback="tint"
        accessibilityRole="button"
        accessibilityLabel={t('chat.history.keep')}
        hitSlop={hitSlop(ANSWER_HEIGHT)}
        onPress={onKeep}
        style={[
          local.answer,
          {
            borderColor: theme.color.lineStrong,
            borderWidth: theme.edge.hairlineWidth,
            paddingHorizontal: theme.space[3],
          },
        ]}
      >
        <Text style={text.no}>{t('chat.history.keep')}</Text>
      </GPressable>
    </View>
  );
}

/**
 * The preview, cut at a whole line and faded over the last of it.
 *
 * The desktop masks the paragraph out, because "a hard ellipsis at a fixed
 * line count reads as truncation, a fade reads as more conversation below".
 * React Native has no mask, so the text stops at the last line that fits
 * (`clip`, not an ellipsis) and a gradient in the face's own colour runs over
 * it. Where the gradient is unsupported the text still ends on a whole line.
 */
function Preview({ text }: { text: string }) {
  const theme = useInkTheme();
  const styles = useCardText();
  const [lines, setLines] = useState<number | undefined>(undefined);

  return (
    <View
      style={local.preview}
      onLayout={(e) => {
        const fit = Math.floor(e.nativeEvent.layout.height / styles.previewLine);
        if (fit !== lines) setLines(fit);
      }}
    >
      {lines === 0 ? null : (
        <Text style={styles.preview} numberOfLines={lines} ellipsizeMode="clip">
          {text}
        </Text>
      )}
      <View
        pointerEvents="none"
        style={[
          local.fade,
          {
            height: Math.round(styles.previewLine * 1.5),
            experimental_backgroundImage: `linear-gradient(to bottom, ${alpha(
              theme.color.surface,
              0,
            )}, ${theme.color.surface})`,
          },
        ]}
      />
    </View>
  );
}

export const ConversationCard = React.memo(function ConversationCard({
  card,
  confirming,
  selecting = false,
  selected = false,
  onOpen,
  onAskDelete,
  onDelete,
  onKeep,
  onToggle,
  style,
}: ConversationCardProps) {
  const theme = useInkTheme();
  const text = useCardText();
  const { t } = useTranslation();
  const [pressed, setPressed] = useState(false);

  const { title, foot, label } = cardWords(card, t);
  // Flat while the wall is being chosen from; back on its plate once chosen.
  const raised = !selecting || selected;

  const onAction = (e: AccessibilityActionEvent) => {
    const name = e.nativeEvent.actionName;
    if (name === 'keep') onKeep();
    else if (name === 'delete') {
      if (confirming) onDelete(card.id);
      else onAskDelete(card.id);
    }
  };

  return (
    <Pressable
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
      // While the card is asking a question, touching it anywhere else is the
      // answer "never mind", not a request to open it. While the wall is being
      // chosen from, touching it is choosing it.
      onPress={() => (selecting ? onToggle?.(card.id) : confirming ? onKeep() : onOpen(card.id))}
      onLongPress={selecting ? undefined : () => onAskDelete(card.id)}
      delayLongPress={LONG_PRESS_MS}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={style}
    >
      <InkEdge
        raised={raised}
        // A flat card has no plate to be driven into, as with Ink's own choices.
        state={pressed && raised ? 'pressed' : 'rest'}
        radius={theme.radius.xl}
        style={local.fill}
        contentStyle={local.face}
      >
        {/* The padding is here rather than on the face, so the face has none
            and the circle's corner inset means the same thing on every Yoga. */}
        <View style={[local.fill, { padding: theme.space[4], gap: theme.space[2] }]}>
          <InkEyebrow>{card.when}</InkEyebrow>
          <Text style={text.title} numberOfLines={3}>
            {title}
          </Text>
          {card.preview ? <Preview text={card.preview} /> : <View style={local.fill} />}
          {confirming ? (
            <DeleteOrKeep
              deleteLabel={t('chat.history.deleteLabel')}
              onDelete={() => onDelete(card.id)}
              onKeep={onKeep}
            />
          ) : card.answering ? (
            <AnsweringMark />
          ) : foot ? (
            <Text style={text.foot} numberOfLines={1}>
              {foot}
            </Text>
          ) : null}
        </View>
        {selecting ? (
          <SelectMark
            selected={selected}
            style={[local.corner, { top: theme.space[3], right: theme.space[3] }]}
          />
        ) : null}
      </InkEdge>
    </Pressable>
  );
});

/**
 * The wall's shape before its contents, so nothing jumps when the cards land.
 * A hairline and no plate, like the desktop's ghost: a raised placeholder
 * would be claiming a conversation that has not arrived.
 *
 * The desktop's ghost is an empty outline. On a white phone screen a hairline
 * at that opacity all but vanishes, so these carry Ink's still skeleton bars
 * where the eyebrow and title will be — enough to read as "coming", and still
 * rather than shimmering, as Ink's skeleton is on purpose.
 */
export function GhostCard({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useInkTheme();
  return (
    <View style={[style, local.ghost]} aria-hidden>
      <InkEdge
        raised={false}
        budgeted={false}
        radius={theme.radius.xl}
        style={local.fill}
        contentStyle={[local.fill, { padding: theme.space[4], gap: theme.space[3] }]}
      >
        <InkSkeleton width="38%" height={10} />
        <InkSkeleton width="82%" height={15} />
        <InkSkeleton width="56%" height={15} />
      </InkEdge>
    </View>
  );
}

const local = StyleSheet.create({
  fill: { flex: 1 },
  face: { flex: 1, overflow: 'hidden' },
  preview: { flex: 1, overflow: 'hidden' },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  confirm: { flexDirection: 'row', justifyContent: 'flex-end' },
  answer: {
    minHeight: ANSWER_HEIGHT,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    width: SELECT_MARK,
    height: SELECT_MARK,
    borderRadius: SELECT_MARK / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  corner: { position: 'absolute' },
  ghost: { opacity: 0.7 },
  answering: { flexDirection: 'row', alignItems: 'center' },
});
