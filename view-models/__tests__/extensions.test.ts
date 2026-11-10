/**
 * Which of an extension's requirements the credentials form asks for.
 *
 * The form used to render every non-OAuth requirement as a masked secret, so a
 * choice was typed blind and the Pond's own keys and developer overrides were
 * offered as ordinary setup.
 */

import type { MarketplaceExtension, SecretRequirement } from '@/services/types';
import { credentialFields, signInFields } from '@/view-models/use-extensions';

function requirement(over: Partial<SecretRequirement>): SecretRequirement {
  return { key: 'K', display_name: 'K', description: '', required: false, kind: 'generic', ...over };
}

function extension(required_secrets: SecretRequirement[]): MarketplaceExtension {
  return {
    id: 'music', name: 'Music', description: '', kind: 'stdio', category: 'entertainment',
    author: 'GIAP', tools: [], featured: false, required_secrets,
  };
}

it('keeps keys and choices, and leaves out sign-ins, host-only and advanced keys', () => {
  const fields = credentialFields(extension([
    requirement({ key: 'TOKEN', kind: 'api_key', required: true }),
    requirement({ key: 'SERVICE', kind: 'choice', options: [{ value: 'apple', label: 'Apple Music' }] }),
    requirement({ key: 'SIGN_IN', kind: 'oauth_flow' }),
    requirement({ key: 'CLIENT_ID', host_only: true }),
    requirement({ key: 'OVERRIDE', advanced: true }),
  ]));

  expect(fields.map((f) => f.key)).toEqual(['TOKEN', 'SERVICE']);
});

it('offers a sign-in for each account the extension signs in to, never a host-only one', () => {
  const fields = signInFields(extension([
    requirement({ key: 'TOKEN', kind: 'api_key' }),
    requirement({ key: 'SPOTIFY', kind: 'oauth_flow', display_name: 'Spotify' }),
    requirement({ key: 'POND_ONLY', kind: 'oauth_flow', host_only: true }),
  ]));

  expect(fields.map((f) => f.key)).toEqual(['SPOTIFY']);
});
