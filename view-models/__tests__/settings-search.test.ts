/**
 * What the Settings search finds, read through the real catalogues and the real English copy, so
 * a renamed row or a reworded option is searched the way a reader would type it.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TFunction } from 'i18next';
import React from 'react';
import { act, create } from 'react-test-renderer';

import { SETTINGS_PAGES } from '@/constants/settings-pages';
import type { SettingsPageId } from '@/models/pond-settings';
import i18n from '@/services/i18n';
import {
  buildSettingsIndex,
  routeOfPage,
  searchSettings,
  type SettingsSearchEntry,
  useSettingsSearch,
} from '@/view-models/use-settings-search';

const t = i18n.t.bind(i18n) as TFunction;
const index = buildSettingsIndex(t);

function find(query: string): SettingsSearchEntry[] {
  const result = searchSettings(index, query);
  if (result.mode !== 'results') throw new Error(`"${query}" did not search`);
  return result.results;
}

it('finds a menu row by part of its name, and puts it first', () => {
  const [first] = find('think');
  expect(first).toMatchObject({ label: 'Thinking', parent: null, route: '/(stack)/settings-thinking' });
});

it('finds a setting inside a page, and says which page it is on', () => {
  expect(find('wake word')[0]).toMatchObject({ label: 'Wake word', parent: 'Voice', route: '/(stack)/settings-voice' });
});

it('finds a page by the name of one of its choices', () => {
  const found = find('concise');
  expect(found.map((entry) => entry.label)).toContain(t('settings.field.prompt_style.label'));
  expect(found.find((entry) => entry.label === t('settings.field.prompt_style.label'))).toMatchObject({
    parent: 'Assistant',
    route: '/(stack)/settings-assistant',
  });
});

it('reaches pages that are only linked from another page', () => {
  expect(find('speaking voice')[0]).toMatchObject({ parent: 'Voice', route: '/(stack)/settings-speaking' });
  const quality = find(t('settings.field.voice_tts_quality.label'));
  expect(quality[0]).toMatchObject({ parent: t('screens.settingsSpeaking'), route: '/(stack)/settings-speaking' });
});

it('ignores case and accents', () => {
  expect(find('THÍNKING')[0].label).toBe('Thinking');
  expect(find('  ThInKiNg ')[0].label).toBe('Thinking');
});

it('needs every word, in any order', () => {
  expect(find('word wake')[0].label).toBe('Wake word');
  expect(find('wake banana')).toEqual([]);
});

it('shows the ordinary menu for an empty or blank query', () => {
  expect(searchSettings(index, '')).toEqual({ mode: 'browse' });
  expect(searchSettings(index, '   ')).toEqual({ mode: 'browse' });
});

it('answers a query that matches nothing with an empty list, not the menu', () => {
  expect(searchSettings(index, 'zzzz')).toEqual({ mode: 'results', results: [] });
});

it('lists each entry once', () => {
  const ids = index.map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
});

/**
 * Rows reach their pages through `routeOfPage`. A page whose screen moved would fall out of the
 * index without failing anything else, so every catalogue page must be reachable, and its route
 * must be the screen that renders it.
 */
it('reaches every catalogue page through the screen that renders it', () => {
  const routes = new Set(index.map((entry) => entry.route));
  const stack = path.resolve(__dirname, '../../app');
  for (const id of Object.keys(SETTINGS_PAGES) as SettingsPageId[]) {
    const route = routeOfPage(id);
    expect(routes).toContain(route);
    const screen = fs.readFileSync(path.join(stack, `${route.replace(/^\//, '')}.tsx`), 'utf8');
    expect(screen).toContain(`page="${id}"`);
  }
});

describe('developer rows', () => {
  const developerIn = (dev: boolean): boolean => {
    const g = globalThis as { __DEV__?: boolean };
    const before = g.__DEV__;
    g.__DEV__ = dev;
    try {
      let found = false;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const search = require('@/view-models/use-settings-search') as typeof import('@/view-models/use-settings-search');
        found = search.buildSettingsIndex(t).some((entry) => entry.route === '/(stack)/developer');
      });
      return found;
    } finally {
      g.__DEV__ = before;
    }
  };

  it('are hidden from a production build', () => {
    expect(developerIn(false)).toBe(false);
  });

  it('are found in a development build, as the menu shows them', () => {
    expect(developerIn(true)).toBe(true);
  });
});

describe('the screen hook', () => {
  // The Settings tab clears the search when it loses focus; this is the action it calls.
  it('goes back to the menu when the search is cleared', () => {
    let latest: ReturnType<typeof useSettingsSearch> | null = null;
    function Probe() {
      latest = useSettingsSearch();
      return null;
    }
    act(() => {
      create(React.createElement(Probe));
    });
    act(() => latest!.setQuery('think'));
    expect(latest!.result.mode).toBe('results');
    act(() => latest!.clear());
    expect(latest!.query).toBe('');
    expect(latest!.result).toEqual({ mode: 'browse' });
  });
});
