/**
 * Reminders: on a Pond that serves `/me/hub`, the dated mentions lifted from chats are offered as
 * to-dos, added with one tap; on an older Pond, the reminders list as before.
 */

import React from 'react';

import { HubOffers } from '@/components/goose/hub-offers';
import { OlderReminders } from '@/components/goose/older-reminders';
import { useHub } from '@/view-models/use-hub';

export default function RemindersScreen() {
  const { served, hub, state } = useHub();
  if (state === 'probing') return null;
  return served && hub?.todos ? <HubOffers /> : <OlderReminders />;
}
