// What a Pond serves of My Goose, from `GET /me/hub`. A part the Pond leaves out, or sends as
// anything but `true`, is a part it does not serve, so the phone never offers what it cannot do.

import { count, record } from './me-read';

export interface MeHub {
  version: number;
  interests: boolean;
  news: boolean;
  todos: boolean;
  cart: boolean;
  connectors: boolean;
  ideas: boolean;
  catalog: boolean;
}

export type HubPart = Exclude<keyof MeHub, 'version'>;

export const HUB_PARTS: readonly HubPart[] = ['interests', 'news', 'todos', 'cart', 'connectors', 'ideas', 'catalog'];

/** Null for an answer that is not the hub at all, which the phone treats as no hub. */
export function readHub(raw: unknown): MeHub | null {
  const r = record(raw);
  if (!r) return null;
  const version = count(r.version);
  if (version < 1) return null;
  const hub = { version } as MeHub;
  for (const part of HUB_PARTS) hub[part] = r[part] === true;
  return hub;
}
