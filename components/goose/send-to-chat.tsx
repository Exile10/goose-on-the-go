/**
 * "Send to chat" for anything My Goose shows as a card. The conversation opens with the card
 * attached; the Pond gives that turn what the member read with Goose's own notes on it. Nothing is
 * drawn on a Pond that cannot send this kind of card.
 */

import React from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton } from '@/components/ui/ink';

import { cardParams, type CardKind } from '@/models/cards';
import { selectionTick } from '@/services/haptics';
import { useHub } from '@/view-models/use-hub';

export function SendToChat({ kind, id, title, size = 'sm' }: { kind: CardKind; id: string; title: string; size?: 'sm' | 'md' }) {
  const { t } = useTranslation();
  const { hub } = useHub();
  if (!hub?.cards.includes(kind)) return null;
  return (
    <InkButton
      size={size}
      variant="quiet"
      icon="chat"
      onPress={() => {
        void selectionTick();
        router.push({ pathname: '/conversation', params: cardParams({ kind, id, title }) });
      }}
      style={{ alignSelf: 'flex-start' }}
    >
      {t('goose.cards.sendToChat')}
    </InkButton>
  );
}
