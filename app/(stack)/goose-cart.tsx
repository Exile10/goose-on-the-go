/**
 * My Goose's cart: the hub's screen for a Pond that serves `/me/hub`, else the older one.
 */

import React from 'react';

import { HubCart } from '@/components/goose/hub-cart';
import { OlderCart } from '@/components/goose/older-cart';
import { useHub } from '@/view-models/use-hub';

export default function GooseCartScreen() {
  const { served, state } = useHub();
  if (state === 'probing') return null;
  return served ? <HubCart /> : <OlderCart />;
}
