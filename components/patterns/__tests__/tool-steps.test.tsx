/**
 * The steps under an answer: what Goose wrote while it worked, folded to one
 * line beside the tool chips until someone opens it, so the answer above reads
 * as the answer.
 */

import '@/services/i18n';
import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { InkProvider } from '@jarida/ink/native';

import type { ToolCall } from '@/models/chat';
import { ToolTrail } from '../tool-card';

jest.mock('@/services/haptics', () => ({ selectionTick: jest.fn(async () => {}) }));
jest.mock('@/components/ui/g-icon', () => ({ GIcon: 'GIcon' }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tools: ToolCall[] = [{ id: 'c1', name: 'giap-weather__get_weather', args: '{}', status: 'ok', result: '23C' }];
const steps = ['Let me check the weather.'];

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <InkProvider scheme="light" accent="Purple">
        <ToolTrail tools={tools} steps={steps} done />
      </InkProvider>,
    );
  });
  return tree;
}

const texts = (tree: ReactTestRenderer) => tree.root.findAllByType(Text).map((node) => String(node.props.children));

const toggle = (tree: ReactTestRenderer) =>
  tree.root.find((node) => typeof node.type !== 'string' && node.props.accessibilityLabel === 'Steps' && Boolean(node.props.onPress));

describe('steps', () => {
  it('is one collapsed line until pressed, then shows the notes', () => {
    const tree = render();
    expect(texts(tree)).toContain('Steps');
    expect(texts(tree)).not.toContain(steps[0]);
    expect(toggle(tree).props.accessibilityRole).toBe('button');
    expect(toggle(tree).props.accessibilityState).toEqual({ expanded: false });

    act(() => toggle(tree).props.onPress());
    expect(texts(tree)).toContain(steps[0]);
    expect(toggle(tree).props.accessibilityState).toEqual({ expanded: true });

    act(() => toggle(tree).props.onPress());
    expect(texts(tree)).not.toContain(steps[0]);
  });

  it('draws nothing for a reply without steps', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <InkProvider scheme="light" accent="Purple">
          <ToolTrail tools={tools} done />
        </InkProvider>,
      );
    });
    expect(texts(tree)).not.toContain('Steps');
  });
});
