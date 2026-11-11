/**
 * My Goose's ideas: the hub's screen for a Pond that serves `/me/hub`, else the older one.
 */

import React from 'react';

import { HubIdeas } from '@/components/goose/hub-ideas';
import { OlderIdeas } from '@/components/goose/older-ideas';
import { useHub } from '@/view-models/use-hub';

export default function GooseIdeasScreen() {
  const { served, state } = useHub();
  if (state === 'probing') return null;
  return served ? <HubIdeas /> : <OlderIdeas />;
}
