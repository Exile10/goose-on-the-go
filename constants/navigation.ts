/**
 * The You tab's menu, grouped as iPhone Settings groups. Labels are catalogue keys because a module
 * constant is evaluated before i18next has a language; `navigation.test.ts` checks every route.
 */

import type { TranslationKey } from '@/services/i18n';
import type { SummaryId } from '@/models/pond-settings';

import type { TileColor } from './colors';
import type { IconName } from './icons';

export interface NavItem {
  id: string;
  /** Key into the string catalogue — resolve with `t()` at render. */
  labelKey: TranslationKey;
  icon: IconName;
  tile: TileColor;
  /** Route path for expo-router */
  route: string;
  /** What the row shows on its right: how the thing it leads to is set. */
  summary?: SummaryId;
}

export interface NavGroup {
  /** Names the group for a screen reader; the groups themselves carry no visible heading. */
  groupKey: TranslationKey;
  items: NavItem[];
}

/** Where the card at the top of the menu leads: the household, and what Goose calls you. */
export const ACCOUNT_ROUTE = '/(stack)/settings-household';

export const PROFILE_NAV: NavGroup[] = [
  {
    groupKey: 'settings.menu.pond',
    items: [
      { id: 'myPond', labelKey: 'screens.myPond', icon: 'server', tile: 'amber', route: '/(stack)/pond' },
      // Home no longer names the Pond it is connected to, so this is where another one is chosen.
      { id: 'switchPond', labelKey: 'screens.switchPond', icon: 'updown', tile: 'amber', route: '/(stack)/switch-pond' },
    ],
  },
  {
    groupKey: 'settings.menu.connection',
    items: [
      { id: 'remoteAccess', labelKey: 'screens.remoteAccess', icon: 'lock', tile: 'blue', route: '/(stack)/remote-access', summary: 'remoteAccess' },
      { id: 'internet', labelKey: 'screens.settingsInternet', icon: 'globe', tile: 'blue', route: '/(stack)/settings-internet', summary: 'internet' },
      { id: 'webSearch', labelKey: 'screens.webSearch', icon: 'search', tile: 'blue', route: '/(stack)/web-search', summary: 'webSearch' },
      { id: 'ngrokTunnel', labelKey: 'screens.ngrokTunnel', icon: 'globe', tile: 'blue', route: '/(stack)/ngrok-tunnel' },
    ],
  },
  {
    groupKey: 'settings.menu.goose',
    items: [
      { id: 'assistant', labelKey: 'screens.settingsAssistant', icon: 'agent', tile: 'purple', route: '/(stack)/settings-assistant', summary: 'assistant' },
      { id: 'voice', labelKey: 'screens.settingsVoice', icon: 'voice', tile: 'pink', route: '/(stack)/settings-voice', summary: 'voice' },
      { id: 'thinking', labelKey: 'screens.settingsThinking', icon: 'sparkle', tile: 'indigo', route: '/(stack)/settings-thinking', summary: 'thinking' },
      { id: 'models', labelKey: 'screens.models', icon: 'models', tile: 'purple', route: '/(stack)/models', summary: 'models' },
      { id: 'memory', labelKey: 'screens.settingsMemory', icon: 'memory', tile: 'teal', route: '/(stack)/settings-memory', summary: 'memory' },
      { id: 'tools', labelKey: 'screens.settingsTools', icon: 'skills', tile: 'orange', route: '/(stack)/settings-tools', summary: 'tools' },
      { id: 'agents', labelKey: 'screens.agents', icon: 'agent', tile: 'indigo', route: '/(stack)/agents' },
      { id: 'extensions', labelKey: 'screens.extensions', icon: 'link', tile: 'orange', route: '/(stack)/extensions', summary: 'extensions' },
    ],
  },
  {
    groupKey: 'settings.menu.home',
    items: [
      { id: 'home', labelKey: 'screens.settingsHome', icon: 'home', tile: 'green', route: '/(stack)/settings-home', summary: 'home' },
      { id: 'addUsers', labelKey: 'screens.addUsers', icon: 'users', tile: 'green', route: '/(stack)/add-users', summary: 'people' },
      { id: 'cameras', labelKey: 'screens.settingsCameras', icon: 'camera', tile: 'slate', route: '/(stack)/settings-cameras', summary: 'cameras' },
      { id: 'homeManagement', labelKey: 'nav.roomsAndPonds', icon: 'bridge', tile: 'slate', route: '/(stack)/home-management' },
    ],
  },
  {
    groupKey: 'settings.menu.notices',
    items: [
      { id: 'announcements', labelKey: 'screens.settingsAnnouncements', icon: 'bell', tile: 'red', route: '/(stack)/settings-announcements', summary: 'announcements' },
      { id: 'suggestions', labelKey: 'screens.suggestions', icon: 'light', tile: 'indigo', route: '/(stack)/suggestions' },
      { id: 'privacy', labelKey: 'screens.settingsPrivacy', icon: 'shield', tile: 'blue', route: '/(stack)/settings-privacy', summary: 'privacy' },
    ],
  },
  {
    groupKey: 'settings.menu.records',
    items: [
      { id: 'memories', labelKey: 'screens.memories', icon: 'memory', tile: 'teal', route: '/(stack)/memories' },
      { id: 'sessions', labelKey: 'screens.sessions', icon: 'chat', tile: 'green', route: '/(stack)/sessions' },
      { id: 'logs', labelKey: 'screens.logs', icon: 'logs', tile: 'slate', route: '/(stack)/logs' },
      { id: 'schedule', labelKey: 'screens.schedule', icon: 'schedule', tile: 'amber', route: '/(stack)/schedule' },
      { id: 'reminders', labelKey: 'screens.reminders', icon: 'calendar', tile: 'amber', route: '/(stack)/reminders' },
      { id: 'webWatches', labelKey: 'screens.webWatches', icon: 'eye', tile: 'teal', route: '/(stack)/web-watches' },
      { id: 'saved', labelKey: 'screens.saved', icon: 'folder', tile: 'indigo', route: '/(stack)/saved' },
    ],
  },
  {
    groupKey: 'settings.menu.phone',
    items: [
      { id: 'appearance', labelKey: 'screens.settingsAppearance', icon: 'palette', tile: 'slate', route: '/(stack)/settings-appearance', summary: 'appearance' },
      { id: 'phoneNotifications', labelKey: 'screens.settingsPhoneNotifications', icon: 'bell', tile: 'red', route: '/(stack)/settings-phone-notifications' },
    ],
  },
  {
    groupKey: 'settings.menu.advanced',
    items: [
      { id: 'advanced', labelKey: 'screens.settingsAdvanced', icon: 'sliders', tile: 'slate', route: '/(stack)/settings-advanced' },
    ],
  },
  {
    groupKey: 'settings.menu.help',
    items: [
      { id: 'help', labelKey: 'screens.help', icon: 'info', tile: 'blue', route: '/(stack)/help' },
    ],
  },
  // Dev-only: the per-screen mock/real backend toggle (#21). Discoverable in a
  // dev build without a code change; absent entirely from production.
  ...(__DEV__
    ? ([
        {
          groupKey: 'nav.developer',
          items: [
            { id: 'developer', labelKey: 'nav.developerMode', icon: 'cpu', tile: 'slate', route: '/(stack)/developer' },
          ],
        },
      ] satisfies NavGroup[])
    : []),
];
