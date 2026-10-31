/**
 * Reading the Pond's web search answer, and the tone each status is drawn in.
 *
 * The answer is read defensively because `request<T>` casts whatever it parsed. What matters on
 * screen is that `configured` and `status` never contradict each other: Remove hangs off the one
 * and the sentence above it off the other.
 */

import { readWebSearch, townSent, webSearchTone } from '@/models/web-search';
import type { WebSearchStatus } from '@/services/types';

describe('readWebSearch', () => {
  it.each<WebSearchStatus>(['ok', 'rejected', 'quota', 'unverified'])('keeps %s on a stored key', (status) => {
    expect(readWebSearch({ provider: 'brave', configured: true, status })).toEqual({
      provider: 'brave',
      configured: true,
      status,
    });
  });

  it('reads no key as not_configured', () => {
    expect(readWebSearch({ provider: 'brave', configured: false, status: 'not_configured' })).toEqual({
      provider: 'brave',
      configured: false,
      status: 'not_configured',
    });
  });

  /** A Pond that said "Off" beside a stored key would offer to remove what the line says is absent. */
  it('does not let a status contradict `configured`', () => {
    expect(readWebSearch({ configured: false, status: 'ok' })?.status).toBe('not_configured');
    expect(readWebSearch({ configured: false, status: 'rejected' })?.status).toBe('not_configured');
    expect(readWebSearch({ configured: true, status: 'not_configured' })?.status).toBe('unverified');
  });

  it('reads a stored key whose status is missing or unknown as stored but not yet checked', () => {
    expect(readWebSearch({ configured: true })?.status).toBe('unverified');
    expect(readWebSearch({ configured: true, status: 'expired' })?.status).toBe('unverified');
    expect(readWebSearch({ configured: true, status: 7 })?.status).toBe('unverified');
  });

  it('is not fooled by a body that is not the answer', () => {
    expect(readWebSearch(undefined)).toBeNull();
    expect(readWebSearch(null)).toBeNull();
    expect(readWebSearch('<!doctype html>')).toBeNull();
    expect(readWebSearch({})).toBeNull();
    expect(readWebSearch({ configured: 'yes', status: 'ok' })).toBeNull();
  });
});

describe('nearby places in the answer', () => {
  it('reads the switch and the town', () => {
    expect(readWebSearch({ configured: true, status: 'ok', local_results: { enabled: true, town: 'Nairobi' } })).toEqual({
      provider: 'brave',
      configured: true,
      status: 'ok',
      local_results: { enabled: true, town: 'Nairobi' },
    });
    expect(readWebSearch({ configured: false, local_results: { enabled: false, town: null } })?.local_results).toEqual({
      enabled: false,
      town: null,
    });
  });

  it('reads a blank or missing town as no town', () => {
    expect(readWebSearch({ configured: false, local_results: { enabled: true, town: '  ' } })?.local_results?.town).toBeNull();
    expect(readWebSearch({ configured: false, local_results: { enabled: true } })?.local_results?.town).toBeNull();
    expect(readWebSearch({ configured: false, local_results: { enabled: true, town: 7 } })?.local_results?.town).toBeNull();
  });

  /** An older Pond sends no `local_results`, and a malformed one is no report either. */
  it('leaves it out when the Pond does not report it', () => {
    expect(readWebSearch({ configured: true, status: 'ok' })).not.toHaveProperty('local_results');
    expect(readWebSearch({ configured: true, status: 'ok', local_results: null })).not.toHaveProperty('local_results');
    expect(readWebSearch({ configured: true, local_results: { enabled: 'yes', town: 'Nairobi' } })).not.toHaveProperty(
      'local_results',
    );
  });

  it('names a town as sent only while the switch is on and a town is set', () => {
    expect(townSent({ enabled: true, town: 'Nairobi' })).toBe('Nairobi');
    expect(townSent({ enabled: false, town: 'Nairobi' })).toBeNull();
    expect(townSent({ enabled: true, town: null })).toBeNull();
    expect(townSent(undefined)).toBeNull();
    expect(townSent(null)).toBeNull();
  });
});

describe('webSearchTone', () => {
  it('draws only a refusal as an alarm', () => {
    expect(webSearchTone('ok')).toBe('success');
    expect(webSearchTone('rejected')).toBe('danger');
    expect(webSearchTone('quota')).toBe('warning');
    expect(webSearchTone('unverified')).toBe('neutral');
    expect(webSearchTone('not_configured')).toBe('neutral');
  });
});
