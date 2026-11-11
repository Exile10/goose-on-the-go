// The services the Pond connects to, in one list (docs/MY-GOOSE-HUB.md, part 5). A connector's
// setup form is drawn from the fields it names, so a connector the Pond adds later needs no app
// release; a field of a kind this phone does not know is read as plain text.

import type { IconName } from '@/constants/icons';
import type { TranslationKey } from '@/services/i18n';

import { count, list, oneOf, readAll, record, strings, text, textOrNull, webUrl } from './me-read';

export type ConnectorCategory = 'mail' | 'calendar' | 'home' | 'web' | 'travel' | 'weather' | 'music' | 'money' | 'custom';
export const CONNECTOR_CATEGORIES: readonly ConnectorCategory[] = ['mail', 'calendar', 'home', 'web', 'travel', 'weather', 'music', 'money', 'custom'];
export type ConnectorStatus = 'connected' | 'available' | 'needs_setup' | 'error';
export type ConnectorKind = 'built_in' | 'account' | 'mcp' | 'webhook';
export type FieldKind = 'text' | 'secret' | 'url' | 'toggle' | 'select';

export interface ConnectorField {
  key: string;
  label: string;
  kind: FieldKind;
  options: string[];
  required: boolean;
  help: string | null;
}

export interface Connector {
  id: string;
  name: string;
  summary: string;
  /** The Pond's name for its glyph; the screen draws the category's when the app has no such glyph. */
  icon: string;
  category: ConnectorCategory;
  status: ConnectorStatus;
  statusDetail: string | null;
  kind: ConnectorKind;
  provides: { tools: number; events: { id: string; label: string }[]; feeds: ('news' | 'todos' | 'ideas')[] };
  setup: { fields: ConnectorField[]; oauth: string | null };
  /** Shown once, on the answer that made the webhook. */
  webhookUrl: string | null;
}

const CATEGORY_ICON: Record<ConnectorCategory, IconName> = {
  mail: 'mail',
  calendar: 'calendar',
  home: 'home',
  web: 'globe',
  travel: 'car',
  weather: 'partly-sunny',
  music: 'music',
  money: 'wallet',
  custom: 'plug',
};

/** The glyph a connector falls back to when the app does not draw the one the Pond named. */
export function categoryIcon(category: ConnectorCategory): IconName {
  return CATEGORY_ICON[category];
}

function readField(raw: unknown): ConnectorField | null {
  const r = record(raw);
  const key = text(r?.key);
  if (!r || !key) return null;
  const kind = oneOf(r.kind, ['text', 'secret', 'url', 'toggle', 'select'] as const, 'text');
  const options = strings(r.options);
  return {
    key,
    label: text(r.label) || key,
    // A select with nothing to choose from is a text field.
    kind: kind === 'select' && options.length === 0 ? 'text' : kind,
    options,
    required: r.required === true,
    help: textOrNull(r.help),
  };
}

export function readConnector(raw: unknown): Connector | null {
  const r = record(raw);
  const id = text(r?.id);
  const name = text(r?.name);
  if (!r || !id || !name) return null;
  const category = oneOf(r.category, CONNECTOR_CATEGORIES, 'custom');
  const provides = record(r.provides);
  const setup = record(r.setup);
  return {
    id,
    name,
    summary: text(r.summary),
    icon: text(r.icon),
    category,
    // An unknown status is "available": offered, never claimed to be working.
    status: oneOf(r.status, ['connected', 'available', 'needs_setup', 'error'] as const, 'available'),
    statusDetail: textOrNull(r.status_detail),
    kind: oneOf(r.kind, ['built_in', 'account', 'mcp', 'webhook'] as const, 'built_in'),
    provides: {
      tools: count(provides?.tools),
      events: list(provides?.events).flatMap((e) => {
        const o = record(e);
        const eventId = text(o?.id);
        return eventId ? [{ id: eventId, label: text(o?.label) || eventId }] : [];
      }),
      feeds: list(provides?.feeds).filter((f): f is 'news' | 'todos' | 'ideas' => f === 'news' || f === 'todos' || f === 'ideas'),
    },
    setup: { fields: readAll(setup?.fields, 'fields', readField), oauth: webUrl(setup?.oauth) },
    webhookUrl: webUrl(r.webhook_url),
  };
}

export function readConnectors(raw: unknown): Connector[] {
  return readAll(raw, 'connectors', readConnector);
}

/** Connected first within each category, categories in the contract's order, empty ones left out. */
export function connectorsByCategory(connectors: readonly Connector[]): { category: ConnectorCategory; connectors: Connector[] }[] {
  const rank: Record<ConnectorStatus, number> = { error: 0, connected: 1, needs_setup: 2, available: 3 };
  return CONNECTOR_CATEGORIES.map((category) => ({
    category,
    connectors: connectors.filter((c) => c.category === category).sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name)),
  })).filter((g) => g.connectors.length > 0);
}

/** What the strip on My Goose shows: what is working or broken, never what is merely on offer. */
export function inUse(connectors: readonly Connector[]): Connector[] {
  return connectors.filter((c) => c.status === 'connected' || c.status === 'error');
}

/** The values a setup form starts from: toggles off, selects on their first option, the rest empty. */
export function blankForm(fields: readonly ConnectorField[]): Record<string, string | boolean> {
  return Object.fromEntries(fields.map((f) => [f.key, f.kind === 'toggle' ? false : f.kind === 'select' ? f.options[0] : '']));
}

/** The required fields still empty, by key, so Connect can say which. */
export function missingFields(fields: readonly ConnectorField[], values: Record<string, string | boolean>): string[] {
  return fields.filter((f) => f.required && f.kind !== 'toggle' && !String(values[f.key] ?? '').trim()).map((f) => f.key);
}

export function categoryKey(category: ConnectorCategory): TranslationKey {
  switch (category) {
    case 'mail': return 'goose.connectors.category.mail';
    case 'calendar': return 'goose.connectors.category.calendar';
    case 'home': return 'goose.connectors.category.home';
    case 'web': return 'goose.connectors.category.web';
    case 'travel': return 'goose.connectors.category.travel';
    case 'weather': return 'goose.connectors.category.weather';
    case 'music': return 'goose.connectors.category.music';
    case 'money': return 'goose.connectors.category.money';
    case 'custom': return 'goose.connectors.category.custom';
  }
}

export function statusKey(status: ConnectorStatus): TranslationKey {
  switch (status) {
    case 'connected': return 'goose.connectors.status.connected';
    case 'available': return 'goose.connectors.status.available';
    case 'needs_setup': return 'goose.connectors.status.needsSetup';
    case 'error': return 'goose.connectors.status.error';
  }
}
