// The overlay sets Goose's answer as the conversation does: Markdown, never its raw asterisks.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { InkProvider } from '@jarida/ink/native';

import '@/services/i18n';
import { AssistOverlay } from '@/components/assist/assist-overlay';

jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-blur', () => ({ BlurView: () => null }));
jest.mock('@/components/patterns/voice-dock', () => ({ VoiceDock: () => null }));
jest.mock('@/services/phone-assistant', () => ({ overlayBlursBehind: () => false }));
jest.mock('@/view-models/use-assist', () => ({
  useAssist: () => ({
    data: {
      link: 'ready',
      exchange: { asked: 'give me more details?', answer: 'Some matches:\n\n* **The Book of the Book** by Idries Shah' },
    },
    actions: { close: jest.fn(), openApp: jest.fn(), send: jest.fn(), stop: jest.fn(), voiceChanged: jest.fn() },
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('shows the answer without the Markdown it is written in', async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <InkProvider scheme="light" accent="Purple">
        <AssistOverlay />
      </InkProvider>,
    );
  });
  // Every string the renderer draws, however deeply a run of bold or a list item nests it.
  const leaves = (node: unknown): string[] =>
    typeof node === 'string'
      ? [node]
      : Array.isArray(node)
        ? node.flatMap(leaves)
        : node && typeof node === 'object' && 'children' in node
          ? leaves((node as { children: unknown }).children)
          : [];
  const text = leaves(tree.toJSON()).join('');
  expect(text).toContain('The Book of the Book');
  expect(text).not.toContain('**');
});
