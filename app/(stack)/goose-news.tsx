/**
 * My Goose's news: the hub's screen for a Pond that serves `/me/hub`, else the older one.
 */

import React from 'react';

import { HubNews } from '@/components/goose/hub-news';
import { OlderNews } from '@/components/goose/older-news';
import { useHub } from '@/view-models/use-hub';

export default function GooseNewsScreen() {
  const { served, state } = useHub();
  if (state === 'probing') return null;
  return served ? <HubNews /> : <OlderNews />;
}
