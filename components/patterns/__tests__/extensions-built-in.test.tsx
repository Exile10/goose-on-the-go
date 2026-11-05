/**
 * A marketplace entry the Pond already covers (Brave Search, while built-in web search exists) is
 * never offered for install: it would only duplicate tools in every prompt.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { InkButton } from '@jarida/ink/native';

import { ThemeProvider } from '@/providers/theme-provider';
import type { MarketplaceExtension } from '@/services/types';
import { MarketplaceCard } from '@/app/(stack)/extensions';

// lucide ships ES modules Jest does not transform; the glyph is not under test.
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));
jest.mock('@/constants/icons', () => ({ isIconName: () => false }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const brave = (over: Partial<MarketplaceExtension> = {}): MarketplaceExtension => ({
  id: 'brave-search',
  name: 'Brave Search',
  description: 'Search the web using Brave Search API for current information',
  kind: 'stdio',
  category: 'productivity',
  author: 'Anthropic',
  tools: [],
  featured: false,
  required_secrets: [],
  ...over,
});

async function render(item: MarketplaceExtension, onOpenWebSearch = jest.fn(), onInstall = jest.fn()) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ThemeProvider>
        <MarketplaceCard item={item} installing={false} onInstall={onInstall} onOpenWebSearch={onOpenWebSearch} />
      </ThemeProvider>,
    );
  });
  return tree;
}

const texts = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(Text).flatMap((t) => (typeof t.props.children === 'string' ? [t.props.children] : []));
const buttons = (tree: ReactTestRenderer) => tree.root.findAllByType(InkButton).map((b) => b.props.children);

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('a marketplace entry the Pond already covers', () => {
  it('says it is built in, with no Install, while web search is on', async () => {
    const tree = await render(brave({ built_in: 'web_search', built_in_state: 'on' }));
    expect(texts(tree)).toEqual(
      expect.arrayContaining(['Built in', 'Web search is built in and already uses your Brave key.']),
    );
    expect(buttons(tree)).not.toContain('Install');
  });

  it('points at web search when the key is missing', async () => {
    const open = jest.fn();
    const tree = await render(brave({ built_in: 'web_search', built_in_state: 'needs_key' }), open);
    const button = tree.root.findAllByType(InkButton).find((b) => b.props.children === 'Open web search');
    expect(button).toBeDefined();
    await act(async () => button!.props.onPress());
    expect(open).toHaveBeenCalled();
  });

  it('still offers Install for an entry the Pond does not cover', async () => {
    const tree = await render(brave({ id: 'github', name: 'GitHub' }));
    expect(buttons(tree)).toContain('Install');
    expect(texts(tree)).not.toContain('Built in');
  });
});
