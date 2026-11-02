/**
 * Search for the Settings screen: find a setting by name, whether it is a row on the menu or a
 * control inside one of the pages the menu leads to.
 *
 * The index is built from the same two catalogues the screens draw from, `PROFILE_NAV` for the
 * menu and `SETTINGS_PAGES` for the pages, so a setting that is added to either is searchable
 * without a second list to keep in step. Pages outside the catalogue (Models, Logs, and the
 * other bespoke screens) are found by their menu row's name only.
 *
 * A row reaches its page through the page's screen: `/(stack)/settings-<page id>`, the id in
 * kebab case, is the route every catalogue page is served at. The test for this module checks
 * that each page is reachable that way, so a renamed screen fails a test rather than quietly
 * dropping its settings out of search.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { TileColor } from '@/constants/colors';
import type { IconName } from '@/constants/icons';
import { ACCOUNT_ROUTE, PROFILE_NAV, type NavGroup } from '@/constants/navigation';
import { SETTINGS_PAGES } from '@/constants/settings-pages';
import type { SettingsPage, SettingsPageId } from '@/models/pond-settings';
import { isBlankQuery, matchesQuery } from '@/utils/search';

/** One thing the search can find, already in the reader's language. */
export interface SettingsSearchEntry {
  /** Unique within the index, for list keys. */
  id: string;
  /** What the result says. */
  label: string;
  /** The page the setting sits on, or null for a row of the menu itself. */
  parent: string | null;
  /** Words that find the entry without being shown: its hint and its choices' names. */
  keywords: string[];
  /** Where tapping the result goes. */
  route: string;
  icon: IconName;
  tile: TileColor;
}

/** Either the ordinary menu (nothing typed) or what a query found, which may be nothing. */
export type SettingsSearchResult = { mode: 'browse' } | { mode: 'results'; results: SettingsSearchEntry[] };

/** The route a catalogue page's screen is served at. */
export function routeOfPage(id: SettingsPageId): string {
  return `/(stack)/settings-${id.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

const PAGE_BY_ROUTE = new Map<string, SettingsPage>(
  Object.values(SETTINGS_PAGES).map((page) => [routeOfPage(page.id), page]),
);

/**
 * Every searchable entry, in menu order: each row, then what its page holds, depth first. A page
 * linked from another (Speaking from Voice) is indexed under the page that links to it, and a
 * link to something that already has a menu row is left to that row, so nothing appears twice.
 */
export function buildSettingsIndex(t: TFunction, groups: NavGroup[] = PROFILE_NAV): SettingsSearchEntry[] {
  const rowRoutes = new Set(groups.flatMap((group) => group.items.map((item) => item.route)));
  const visited = new Set<SettingsPageId>();
  const entries: SettingsSearchEntry[] = [];

  const indexPage = (page: SettingsPage, route: string) => {
    if (visited.has(page.id)) return;
    visited.add(page.id);
    const parent = t(page.titleKey);
    for (const section of page.sections) {
      for (const item of section.items) {
        if (item.kind === 'special') continue;
        if (item.kind === 'link') {
          if (rowRoutes.has(item.route)) continue;
          const id = `${item.route}#${item.labelKey}`;
          // A screen linked from two pages is one place to go: it is listed under the first.
          if (entries.some((entry) => entry.id === id)) continue;
          entries.push({
            id,
            label: t(item.labelKey),
            parent,
            keywords: item.hintKey ? [t(item.hintKey)] : [],
            route: item.route,
            icon: item.icon ?? page.icon,
            tile: item.tile ?? page.tile,
          });
          const linked = PAGE_BY_ROUTE.get(item.route);
          if (linked) indexPage(linked, item.route);
          continue;
        }
        entries.push({
          id: `${route}#${item.labelKey}`,
          label: t(item.labelKey),
          parent,
          keywords: [
            ...(item.hintKey ? [t(item.hintKey)] : []),
            ...(item.kind === 'choice' ? item.options.map((option) => t(option.labelKey)) : []),
          ],
          route,
          icon: page.icon,
          tile: page.tile,
        });
      }
    }
  };

  for (const group of groups) {
    for (const row of group.items) {
      entries.push({
        id: `${row.route}#${row.labelKey}`,
        label: t(row.labelKey),
        parent: null,
        keywords: [],
        route: row.route,
        icon: row.icon,
        tile: row.tile,
      });
      const page = PAGE_BY_ROUTE.get(row.route);
      if (page) indexPage(page, row.route);
    }
  }

  // The account card leads to the household page; its name is the member's, so the entry
  // takes the page's own title.
  const household = PAGE_BY_ROUTE.get(ACCOUNT_ROUTE);
  if (household && !visited.has(household.id)) {
    entries.push({
      id: `${ACCOUNT_ROUTE}#${household.titleKey}`,
      label: t(household.titleKey),
      parent: null,
      keywords: [t(household.descriptionKey)],
      route: ACCOUNT_ROUTE,
      icon: household.icon,
      tile: household.tile,
    });
    indexPage(household, ACCOUNT_ROUTE);
  }

  return entries;
}

/**
 * What a query finds, most direct first: menu rows by name, then settings inside pages by name,
 * then anything found only by a hint or a choice. Typing "think" should offer Thinking before a
 * Voice setting whose name happens to contain the word.
 */
export function searchSettings(index: SettingsSearchEntry[], query: string): SettingsSearchResult {
  if (isBlankQuery(query)) return { mode: 'browse' };
  const tiers: SettingsSearchEntry[][] = [[], [], []];
  for (const entry of index) {
    if (matchesQuery([entry.label], query)) tiers[entry.parent === null ? 0 : 1].push(entry);
    else if (matchesQuery(entry.keywords, query)) tiers[2].push(entry);
  }
  return { mode: 'results', results: tiers.flat() };
}

/** The Settings screen's search: the typed query and what it finds. */
export function useSettingsSearch() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  // react-i18next hands out a new `t` when the language changes, so the index is rebuilt then
  // and results read in the language the menu does.
  const index = useMemo(() => buildSettingsIndex(t), [t]);
  const result = useMemo(() => searchSettings(index, query), [index, query]);
  const clear = useCallback(() => setQuery(''), []);
  return { query, setQuery, clear, result };
}
