/**
 * The connection strip: one quiet sentence, and a button only where pairing is the answer.
 *
 * Trying again is the screen's pull to refresh now, so the strip must not grow a Try again back.
 * A screen reader, which cannot easily pull, gets it as an accessibility action on the sentence.
 */

import '@/services/i18n';
import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { ConnectionState } from '@/models/connection';
import { ConnectionStatus } from '../connection-status';

const mockServer: { hydrated: boolean; connectionState: ConnectionState; recover: jest.Mock } = {
  hydrated: true,
  connectionState: 'disconnected',
  recover: jest.fn(),
};
const mockPush = jest.fn();

jest.mock('@/providers/server-provider', () => ({ useServer: () => mockServer }));
jest.mock('@/providers/theme-provider', () => ({
  useTheme: () => ({ colors: jest.requireActual('@/constants/colors').LightColors }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useSegments: () => ['(tabs)'],
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
// The app registers lucide's glyphs, which jest cannot load. The glyph is not what is under test.
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(state: ConnectionState) {
  mockServer.connectionState = state;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<ConnectionStatus />);
  });
  return tree;
}

function words(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(Text)
    .map((node) => node.props.children)
    .filter((child): child is string => typeof child === 'string');
}

/** Whatever a finger can press: anything with an `onPress`, however Pressable is drawn in tests. */
function pressables(tree: ReactTestRenderer) {
  return tree.root.findAll((n) => typeof n.type !== 'string' && typeof n.props.onPress === 'function', { deep: false });
}

function statement(tree: ReactTestRenderer) {
  return tree.root.findAll((n) => n.props.accessible === true && 'accessibilityLabel' in n.props)[0];
}

beforeEach(() => {
  mockServer.hydrated = true;
  mockServer.recover = jest.fn().mockResolvedValue(null);
  mockPush.mockClear();
});

describe('ConnectionStatus', () => {
  it.each<ConnectionState>(['disconnected', 'trust'])('says %s in one sentence with nothing to press', (state) => {
    const tree = render(state);
    expect(words(tree)).toHaveLength(1);
    expect(words(tree).join(' ')).not.toMatch(/try again|checking/i);
    expect(pressables(tree)).toHaveLength(0);
  });

  it.each<ConnectionState>(['unpaired', 'upgrade', 'revoked'])('keeps Pair for a phone that must pair again (%s)', (state) => {
    const tree = render(state);
    const [pair] = pressables(tree);
    expect(words(tree)).toContain('Pair');
    act(() => pair.props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/(stack)/pond-pairing');
    // Pairing is the answer there; a probe would change nothing.
    expect(statement(tree).props.accessibilityActions).toBeUndefined();
  });

  it('lets a screen reader try again from the sentence, since it cannot easily pull', () => {
    const tree = render('disconnected');
    const node = statement(tree);
    expect(node.props).toMatchObject({
      accessibilityLabel: 'Cannot reach your Pond',
      accessibilityHint: 'Pull down to try again',
      accessibilityActions: [{ name: 'activate', label: 'Try again' }],
    });
    act(() => node.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } }));
    expect(mockServer.recover).toHaveBeenCalledTimes(1);
  });

  it('says nothing while the connection works', () => {
    expect(render('local').toJSON()).toBeNull();
    expect(render('remote').toJSON()).toBeNull();
  });
});
