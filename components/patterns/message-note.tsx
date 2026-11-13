/**
 * What the Pond stored beside a message, drawn around it: one quiet line above saying where the
 * message came from, a chip under it for each thing it set or failed to set, and what it offers
 * to do. All of it comes from the saved note or a live tool result, never from the reply's words.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { toneColors } from '@jarida/ink';
import { InkButton, inkText, useInkTheme } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import type { NoteFrom, Offer, Receipt } from '@/models/message-note';
import { selectionTick } from '@/services/haptics';
import { fromIcon, fromWords, offerStateWords, receiptWords } from '@/view-models/note-words';

export function FromLine({ from, mine = false }: { from: NoteFrom; mine?: boolean }) {
  const theme = useInkTheme();
  const words = fromWords(from);
  const text = inkText(theme, { role: 'mono', size: 'xs', color: theme.color.textTertiary });
  if (!words) return null;
  return (
    <View style={[styles.from, mine ? styles.mine : null]}>
      <GIcon name={fromIcon(from.kind)} size={12} color={theme.color.textTertiary} />
      <Text style={[text.style, styles.shrink]} numberOfLines={2}>
        {words}
      </Text>
    </View>
  );
}

function ReceiptChip({ receipt }: { receipt: Receipt }) {
  const theme = useInkTheme();
  const set = receipt.outcome === 'set';
  const tone = toneColors(set ? 'success' : 'warning', theme.color);
  const words = inkText(theme, { role: 'mono', size: 'xs', weight: theme.weight.medium, color: tone.fg });
  const reason = inkText(theme, { size: 'xs', color: tone.fg });
  const line = receiptWords(receipt);
  return (
    <View
      accessible
      accessibilityLabel={receipt.reason && !set ? `${line}. ${receipt.reason}` : line}
      style={[styles.chip, { backgroundColor: tone.soft, borderRadius: theme.radius.md }]}
    >
      <GIcon name={set ? 'check' : 'warn'} size={13} color={tone.fg} />
      <View style={styles.shrink}>
        <Text style={words.style}>{line}</Text>
        {!set && receipt.reason ? <Text style={reason.style}>{receipt.reason}</Text> : null}
      </View>
    </View>
  );
}

export function ReceiptChips({ receipts }: { receipts: Receipt[] }) {
  return (
    <View style={styles.chips}>
      {receipts.map((receipt, i) => (
        <ReceiptChip key={`${i}:${receipt.what}`} receipt={receipt} />
      ))}
    </View>
  );
}

export function OfferPanel({ offer, onAnswer }: { offer: Offer; onAnswer?: (take: boolean) => Promise<void> | void }) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const [answering, setAnswering] = useState<boolean | null>(null);
  const quiet = inkText(theme, { size: 'sm', color: theme.color.textSecondary });
  const state = inkText(theme, { role: 'mono', size: 'xs', color: theme.color.textTertiary });
  const answered = offerStateWords(offer.state);

  const answer = async (take: boolean) => {
    if (answering !== null || !onAnswer) return;
    void selectionTick();
    setAnswering(take);
    try {
      await onAnswer(take);
    } finally {
      setAnswering(null);
    }
  };

  return (
    <View style={styles.offer}>
      <Text style={quiet.style}>{offer.noticed}</Text>
      {answered ? (
        <Text style={state.style}>{answered}</Text>
      ) : onAnswer ? (
        <View style={styles.answers}>
          <InkButton variant="primary" size="sm" loading={answering === true} disabled={answering !== null} onPress={() => void answer(true)}>
            {offer.action || t('chat.note.offer.take')}
          </InkButton>
          <InkButton variant="quiet" size="sm" loading={answering === false} disabled={answering !== null} onPress={() => void answer(false)}>
            {t('chat.note.offer.pass')}
          </InkButton>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  from: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mine: { justifyContent: 'flex-end' },
  shrink: { flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 9, paddingVertical: 5, maxWidth: '100%' },
  offer: { gap: 8 },
  answers: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
