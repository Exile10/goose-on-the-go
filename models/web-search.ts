/**
 * Web search, as the Web search screen reads it.
 *
 * The wire types are the Pond's and live in `services/types.ts`. What is here is what the screen
 * needs on top: reading the Pond's answer defensively, and the tone each status is drawn in.
 *
 * The Pond never returns the key, and nothing in this app models one. A key exists only as what
 * somebody has typed into the field, until the Pond has it.
 */

import type { InkNoticeProps } from '@jarida/ink/native';

import type { WebSearchState, WebSearchStatus } from '@/services/types';

/** Brave's dashboard, where a household gets a key. The one place the screen sends a person to. */
export const BRAVE_DASHBOARD_URL = 'https://api-dashboard.search.brave.com';

/** The same address as the help line writes it, without the scheme. */
export const BRAVE_DASHBOARD_HOST = 'api-dashboard.search.brave.com';

/** The tones the status line is drawn in: Ink's own, so a dark scheme needs nothing here. */
export type WebSearchTone = NonNullable<InkNoticeProps['tone']>;

const STATUSES: readonly WebSearchStatus[] = ['ok', 'not_configured', 'rejected', 'quota', 'unverified'];

function isStatus(value: unknown): value is WebSearchStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

/**
 * The Pond's `{configured, status}`, or null when the body is not that at all.
 *
 * `request<T>` casts whatever it parsed, so an empty body or a page from something in front of the
 * Pond arrives typed as the answer it should have been. Null is that case, and the caller decides
 * what it means.
 *
 * `configured` is the authority and `status` is reconciled to it, because the two drive different
 * things on screen: `configured` decides whether Remove is offered, and the status is the sentence
 * above it. A Pond that said "Off" beside a stored key would offer to remove something the line
 * above says is not there. So no key reads as `not_configured` whatever else was sent, and a key
 * with a missing, unknown or contradictory status reads as `unverified` -- stored, not yet
 * checked -- which is the one claim that is true of any key the Pond will not vouch for.
 */
export function readWebSearch(raw: unknown): WebSearchState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { configured, status } = raw as Record<string, unknown>;
  if (typeof configured !== 'boolean') return null;
  if (!configured) return { provider: 'brave', configured, status: 'not_configured' };
  return {
    provider: 'brave',
    configured,
    status: isStatus(status) && status !== 'not_configured' ? status : 'unverified',
  };
}

/**
 * The tone a status is drawn in.
 *
 * Only a refusal is `danger`. A spent monthly allowance is `warning`: the key is fine, and the
 * household can wait for the month to turn or add credit. `unverified` and `not_configured` are
 * not problems, so they stay neutral rather than borrowing an alarm they have not earned.
 */
export function webSearchTone(status: WebSearchStatus): WebSearchTone {
  switch (status) {
    case 'ok':
      return 'success';
    case 'rejected':
      return 'danger';
    case 'quota':
      return 'warning';
    case 'unverified':
    case 'not_configured':
      return 'neutral';
  }
}
