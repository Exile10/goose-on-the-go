/**
 * Navigation structure — Goose On The Go v2 design.
 * Profile hub groups and sub-screen routes.
 */

import type { IconName } from './icons';

export interface NavItem {
  id: string;
  /** i18n key, not copy. The lint rule cannot see literals in a data structure, so the
   *  type is what keeps them out: a bare label here would be a key that does not resolve,
   *  and services/__tests__/i18n.test.ts fails on that. */
  labelKey: string;
  icon: IconName;
  /** Route path for Expo Router */
  route: string;
}

export interface NavGroup {
  /** i18n key, not copy. */
  groupKey: string;
  items: NavItem[];
}

/** Screens accessible from the Profile hub */
export const PROFILE_NAV: NavGroup[] = [
  {
    groupKey: 'nav.groupGoose',
    items: [
      { id: 'models', labelKey: 'nav.models', icon: 'models', route: '/(stack)/models' },
      { id: 'memories', labelKey: 'nav.memories', icon: 'memory', route: '/(stack)/memories' },
      { id: 'logs', labelKey: 'nav.logs', icon: 'logs', route: '/(stack)/logs' },
      { id: 'schedule', labelKey: 'nav.schedule', icon: 'schedule', route: '/(stack)/schedule' },
    ],
  },
  {
    groupKey: 'nav.groupIntegrations',
    items: [
      { id: 'appManagement', labelKey: 'nav.appManagement', icon: 'link', route: '/(stack)/app-management' },
      { id: 'mcpServers', labelKey: 'nav.mcpServers', icon: 'globe', route: '/(stack)/mcp-servers' },
    ],
  },
  {
    groupKey: 'nav.groupHousehold',
    items: [
      { id: 'addUsers', labelKey: 'nav.addUsers', icon: 'users', route: '/(stack)/add-users' },
      { id: 'homeManagement', labelKey: 'nav.homeManagement', icon: 'home', route: '/(stack)/home-management' },
    ],
  },
  {
    groupKey: 'nav.groupPrivacy',
    items: [
      { id: 'privacy', labelKey: 'nav.privacy', icon: 'shield', route: '/(stack)/privacy' },
    ],
  },
  // Dev-only: the per-screen mock/real backend toggle (#21). Discoverable in a
  // dev build without a code change; absent entirely from production.
  ...(__DEV__
    ? [
        {
          groupKey: 'nav.groupDeveloper',
          items: [
            { id: 'developer', labelKey: 'nav.developer', icon: 'cpu', route: '/(stack)/developer' },
          ],
        },
      ]
    : []),
];

/** Shortcut items for the home screen carousel */
export interface ShortcutItem {
  id: string;
  /** i18n key, not copy. */
  labelKey: string;
  iconName: string;
  color: string;
}

export const HOME_SHORTCUTS: ShortcutItem[] = [
  { id: 'morning', labelKey: 'nav.shortcutMorning', iconName: 'sun', color: '#FEF3C7' },
  { id: 'home', labelKey: 'nav.shortcutHome', iconName: 'home', color: '#DBEAFE' },
  { id: 'night', labelKey: 'nav.shortcutNight', iconName: 'moon', color: '#EDE9FE' },
  { id: 'music', labelKey: 'nav.shortcutMusic', iconName: 'music', color: '#FCE7F3' },
  { id: 'packages', labelKey: 'nav.shortcutPackages', iconName: 'package', color: '#FEE2E2' },
];
