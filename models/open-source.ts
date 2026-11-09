/**
 * The open-source components this app ships, from `assets/legal/open-source.json`, which
 * `scripts/open-source-notices.cjs` writes from a release build (see docs/LICENSES.md).
 */

import notices from '@/assets/legal/open-source.json';

export interface Component {
  name: string;
  version: string;
  license: string;
  /** The licence's full text, when the component ships it or it is a licence shipped once here. */
  text: string | null;
  /** Where the licence can be read, when the text is not included. */
  url: string | null;
}

export type ComponentKind = 'javascript' | 'android' | 'embedded';

export interface ComponentGroup {
  kind: ComponentKind;
  components: Component[];
}

interface Listed {
  name: string;
  version: string;
  license: string;
  text: string | null;
  url: string | null;
}

interface Notices {
  javascript: Listed[];
  android: Listed[];
  embedded: { title: string; text: string }[];
  texts: Record<string, string>;
}

/** The groups as the screen lists them, each component with its licence text resolved. */
export function componentGroups(source: Notices = notices as Notices): ComponentGroup[] {
  const resolve = (c: Listed): Component => ({ ...c, text: c.text ? source.texts[c.text] ?? null : null });
  return [
    { kind: 'javascript', components: source.javascript.map(resolve) },
    { kind: 'android', components: source.android.map(resolve) },
    {
      kind: 'embedded',
      components: source.embedded.map((e) => ({ name: e.title, version: '', license: '', text: e.text, url: null })),
    },
  ];
}

/** How many components the app is built from. */
export function componentCount(groups: ComponentGroup[] = componentGroups()): number {
  return groups.reduce((n, g) => n + g.components.length, 0);
}
