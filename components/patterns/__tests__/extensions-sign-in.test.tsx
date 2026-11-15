/**
 * An installed extension that signs in to an account, such as Music to Spotify, offers that
 * sign-in on its card, says a phone may not finish it yet, and shows the one under way as busy.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { InkButton } from '@jarida/ink/native';

import { ThemeProvider } from '@/providers/theme-provider';
import i18n from '@/services/i18n';
import type { Extension, SecretRequirement } from '@/services/types';
import { InstalledCard } from '@/app/(stack)/extensions';

// lucide ships ES modules Jest does not transform; the glyph is not under test.
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));
jest.mock('@/constants/icons', () => ({ isIconName: () => false }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const music = { name: 'music', description: 'Play music', kind: 'stdio', enabled: true } as Extension;
const spotify: SecretRequirement = { key: 'SPOTIFY_TOKEN', display_name: 'Spotify', description: '', required: true, kind: 'oauth_flow' };

async function render(props: Partial<React.ComponentProps<typeof InstalledCard>>) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ThemeProvider>
        <InstalledCard extension={music} onToggle={jest.fn()} {...props} />
      </ThemeProvider>,
    );
  });
  return tree;
}

const signInButton = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(InkButton).find((b) => b.props.icon === 'external');
const texts = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(Text).flatMap((t) => (typeof t.props.children === 'string' ? [t.props.children] : []));

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

it('offers the sign-in, says a phone may not finish it, and signs that extension in', async () => {
  const onSignIn = jest.fn();
  const tree = await render({ signIns: [spotify], onSignIn });

  const button = signInButton(tree)!;
  expect(button.props.children).toBe(i18n.t('extensions.signIn.action', { name: 'Spotify' }));
  expect(texts(tree)).toContain(i18n.t('extensions.signIn.note'));

  await act(async () => button.props.onPress());
  expect(onSignIn).toHaveBeenCalledWith('music', spotify);
});

it('shows the sign-in under way as busy', async () => {
  const tree = await render({ signIns: [spotify], onSignIn: jest.fn(), signingIn: 'SPOTIFY_TOKEN' });
  const button = signInButton(tree)!;
  expect(button.props.loading).toBe(true);
  expect(button.props.children).toBe(i18n.t('extensions.signIn.signingIn'));
});

it('offers no sign-in to an extension with no account to sign in to', async () => {
  const tree = await render({ onSignIn: jest.fn() });
  expect(signInButton(tree)).toBeUndefined();
  expect(texts(tree)).not.toContain(i18n.t('extensions.signIn.note'));
});
