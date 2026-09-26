/**
 * The Profile hub's shape: which screens exist, and how they group.
 *
 * Labels are catalogue keys rather than text. A module constant is evaluated
 * once at import, before i18next has a language, so a literal here would freeze
 * the app in whatever the build shipped with.
 *
 * Every row has to reach a screen file: `constants/__tests__/navigation.test.ts`
 * fails on one that does not, because expo-router resolves routes at runtime and
 * nothing else would notice until someone tapped it.
 */

import type { TranslationKey } from '@/services/i18n';

import type { IconName } from './icons';

export interface NavItem {
  id: string;
  /** Key into the string catalogue — resolve with `t()` at render. */
  labelKey: TranslationKey;
  icon: IconName;
  /** Route path for expo-router */
  route: string;
}

export interface NavGroup {
  /** Key into the string catalogue — resolve with `t()` at render. */
  groupKey: TranslationKey;
  items: NavItem[];
}

export const PROFILE_NAV: NavGroup[] = [
  {
    groupKey: 'nav.goose',
    items: [
      { id: 'models', labelKey: 'screens.models', icon: 'models', route: '/(stack)/models' },
      { id: 'memories', labelKey: 'screens.memories', icon: 'memory', route: '/(stack)/memories' },
      { id: 'sessions', labelKey: 'screens.sessions', icon: 'chat', route: '/(stack)/sessions' },
      { id: 'logs', labelKey: 'screens.logs', icon: 'logs', route: '/(stack)/logs' },
      { id: 'schedule', labelKey: 'screens.schedule', icon: 'schedule', route: '/(stack)/schedule' },
    ],
  },
  {
    groupKey: 'nav.integrations',
    items: [
      { id: 'appManagement', labelKey: 'screens.appManagement', icon: 'link', route: '/(stack)/app-management' },
      { id: 'mcpServers', labelKey: 'screens.mcpServers', icon: 'globe', route: '/(stack)/mcp-servers' },
    ],
  },
  {
    groupKey: 'nav.household',
    items: [
      { id: 'addUsers', labelKey: 'screens.addUsers', icon: 'users', route: '/(stack)/add-users' },
      { id: 'homeManagement', labelKey: 'screens.homeManagement', icon: 'home', route: '/(stack)/home-management' },
    ],
  },
  {
    groupKey: 'nav.privacy',
    items: [
      { id: 'remoteAccess', labelKey: 'screens.remoteAccess', icon: 'lock', route: '/(stack)/remote-access' },
      { id: 'privacy', labelKey: 'screens.privacy', icon: 'shield', route: '/(stack)/privacy' },
    ],
  },
  // Dev-only: the per-screen mock/real backend toggle (#21). Discoverable in a
  // dev build without a code change; absent entirely from production.
  ...(__DEV__
    ? ([
        {
          groupKey: 'nav.developer',
          items: [
            { id: 'developer', labelKey: 'nav.developerMode', icon: 'cpu', route: '/(stack)/developer' },
          ],
        },
      ] satisfies NavGroup[])
    : []),
];
