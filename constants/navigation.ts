/**
 * The Profile hub's shape: which screens exist, and how they group.
 *
 * Labels are catalogue keys rather than text. A module constant is evaluated
 * once at import, before i18next has a language, so a literal here would freeze
 * the app in whatever the build shipped with.
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
    groupKey: 'nav.media',
    items: [
      { id: 'userMedia', labelKey: 'screens.userMedia', icon: 'photo', route: '/(stack)/user-media' },
      { id: 'photoUpload', labelKey: 'screens.photoUpload', icon: 'upload', route: '/(stack)/photo-upload' },
    ],
  },
  {
    groupKey: 'nav.household',
    items: [
      { id: 'addUsers', labelKey: 'screens.addUsers', icon: 'users', route: '/(stack)/add-users' },
      { id: 'biometrics', labelKey: 'screens.biometrics', icon: 'shield', route: '/(stack)/biometrics' },
      { id: 'homeManagement', labelKey: 'screens.homeManagement', icon: 'home', route: '/(stack)/home-management' },
    ],
  },
  {
    groupKey: 'nav.privacy',
    items: [
      { id: 'backup', labelKey: 'screens.backup', icon: 'cloud', route: '/(stack)/backup' },
      { id: 'restore', labelKey: 'screens.restore', icon: 'restore', route: '/(stack)/restore' },
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
