/**
 * Switch Pond opens on this phone's Pond, with the connection's state on its card and no strip
 * stacked over the title bar, and lists the other Ponds on the network below it.
 */

import '@/services/i18n';
import React from 'react';
import { registerIcons } from '@jarida/ink';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import SwitchPond from '@/app/(stack)/switch-pond';
import type { ConnectionOutage, ConnectionState } from '@/models/connection';
import { ThemeProvider } from '@/providers/theme-provider';
import type { DiscoveredPond } from '@/services/discovery';
import { ConnectionStatus } from '../connection-status';

const MINE = `sha256/${'M'.repeat(43)}=`;
const THEIRS = `sha256/${'T'.repeat(43)}=`;
const pond = (address: string, pin: string, name: string): DiscoveredPond => ({
  id: `${address}:4443`, name, address, port: 4443, url: `https://${address}:4443`, pin, unclaimed: false,
});

const mockServer: {
  hydrated: boolean;
  connectionState: ConnectionState;
  connectionOutage: ConnectionOutage | null;
  pairedPin: string;
  pondUrls: string[];
  retryNow: jest.Mock;
  tryAddress: jest.Mock;
} = {
  hydrated: true,
  connectionState: 'disconnected',
  connectionOutage: null,
  pairedPin: MINE,
  pondUrls: ['https://192.168.1.10:4443'],
  retryNow: jest.fn(),
  tryAddress: jest.fn(),
};
let mockPonds: DiscoveredPond[] = [];
const mockShow = jest.fn();

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));
jest.mock('@/providers/server-provider', () => ({ useServer: () => mockServer }));
jest.mock('@/providers/snackbar-provider', () => ({ useSnackbar: () => ({ show: mockShow }) }));
jest.mock('@/services/haptics', () => ({ selectionTick: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/view-models/use-discovery', () => ({
  useDiscovery: () => ({ data: { ponds: mockPonds, phase: 'found' }, loading: false, error: null, actions: { retry: jest.fn() } }),
}));
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: jest.fn() }),
  useSegments: () => ['(stack)', 'switch-pond'],
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

// The app registers lucide's glyphs, which jest cannot load. The glyphs are not what is under test.
const Glyph = () => null;
registerIcons({ refresh: Glyph, server: Glyph, plus: Glyph });

/** Every tree drawn, unmounted after each test so a countdown does not tick on past it. */
const drawn: ReactTestRenderer[] = [];
afterEach(() => act(() => drawn.splice(0).forEach((tree) => tree.unmount())));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The screen as the stack draws it: the inline strip's slot, then the screen. */
async function draw(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ThemeProvider>
        <ConnectionStatus placement="inline" screen="switch-pond" />
        <SwitchPond />
      </ThemeProvider>,
    );
  });
  // The theme's saved choice is read back once, after the first frame.
  await act(async () => undefined);
  drawn.push(tree);
  return tree;
}

function words(tree: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: ReactTestInstance | string) => {
    if (typeof n === 'string') out.push(n);
    else n.children.forEach(walk);
  };
  walk(tree.root);
  return out.join(' | ');
}

function button(tree: ReactTestRenderer, label: string): ReactTestInstance {
  const found = tree.root.findAll((n) => typeof n.props.onPress === 'function' && words({ root: n } as ReactTestRenderer).includes(label));
  return found[found.length - 1];
}

beforeEach(() => {
  mockServer.connectionState = 'disconnected';
  mockServer.connectionOutage = { failures: 3, reason: 'local', nextCheckAt: Date.now() + 30_000, lastConnectedAt: Date.now() - 300_000 };
  mockServer.retryNow = jest.fn().mockResolvedValue(null);
  mockServer.tryAddress = jest.fn().mockResolvedValue(null);
  mockShow.mockClear();
});

describe('Switch Pond', () => {
  it('tells the state once, on the Pond card, with no strip over the title bar', async () => {
    // 2026-11-03: the household's Pond restarting, another household's Pond on the network.
    mockPonds = [pond('192.168.1.11', THEIRS, 'Pond Hub @ nano')];
    const text = words(await draw());
    expect(text.match(/Cannot reach your Pond/g)).toHaveLength(1);
    expect(text).toContain('Your Pond');
    expect(text).toContain('192.168.1.10:4443');
    expect(text).toContain('Not answering on this Wi-Fi');
    expect(text).toMatch(/Last connected/);
    expect(text).toContain('Trying again in 30 s');
    expect(text).toContain('Try now');
    expect(text).not.toContain('The one you are using is marked');
  });

  it('lists another Pond only under the others, never as this one', async () => {
    mockPonds = [pond('192.168.1.11', THEIRS, 'Pond Hub @ nano')];
    const text = words(await draw());
    expect(text).toContain('Other Ponds on this network');
    expect(text).toContain('Pond Hub @ nano');
    expect(text).not.toContain('Your Pond is now at');
  });

  it('names this Pond from its announcement when it is heard, and lists no others', async () => {
    mockServer.connectionState = 'local';
    mockServer.connectionOutage = null;
    mockPonds = [pond('192.168.1.10', MINE, 'Kitchen Pond')];
    const text = words(await draw());
    expect(text).toContain('Kitchen Pond');
    expect(text).toContain('Connected on this Wi-Fi');
    expect(text).toContain('No other Ponds are announcing themselves on this network.');
    expect(text).not.toContain('Try now');
  });

  it('offers a new address heard under this Pond\'s pin, and checks it before keeping it', async () => {
    mockPonds = [pond('192.168.1.23', MINE, 'Kitchen Pond')];
    mockServer.tryAddress = jest.fn().mockResolvedValue('https://192.168.1.23:4443');
    const tree = await draw();
    expect(words(tree)).toContain('Your Pond is now at 192.168.1.23:4443');
    await act(async () => button(tree, 'Use this address').props.onPress());
    expect(mockServer.tryAddress).toHaveBeenCalledWith('https://192.168.1.23:4443');
    expect(mockShow).toHaveBeenCalledWith({ message: 'Your Pond answered at 192.168.1.23:4443' });
  });

  it('says so when the new address does not answer as this Pond', async () => {
    mockPonds = [pond('192.168.1.23', MINE, 'Kitchen Pond')];
    const tree = await draw();
    await act(async () => button(tree, 'Use this address').props.onPress());
    expect(mockShow).toHaveBeenCalledWith({ message: 'Nothing at that address answered as your Pond', tone: 'danger' });
  });
});
