/** Memory types — Goose On The Go v2 design */

import type { IconName } from '@/constants/icons';

export type MemoryCategory = 'Preference' | 'Habit' | 'Person' | 'Reminder';

export interface MemoryFragment {
  id: number;
  category: MemoryCategory;
  text: string;
  icon: IconName;
  time: string;
  pinned: boolean;
}

export const SAMPLE_MEMORIES: MemoryFragment[] = [
  { id: 1, category: 'Preference', text: 'Prefers lights at 60% warmth in the evening', icon: 'light', time: '2 days ago', pinned: true },
  { id: 2, category: 'Habit', text: 'Orders from Glovo on Fridays, usually sushi or Thai', icon: 'sparkle', time: '1 week ago', pinned: true },
  { id: 3, category: 'Person', text: "Partner's name is Sam, arrives home around 6 PM", icon: 'profile', time: '3 weeks ago', pinned: false },
  { id: 4, category: 'Reminder', text: 'Dog vet appointment every 6 months \u2014 last was Sept 2024', icon: 'bell', time: '1 month ago', pinned: false },
  { id: 5, category: 'Preference', text: 'Dislikes notification sounds between 10 PM and 7 AM', icon: 'speaker', time: '2 months ago', pinned: false },
];
