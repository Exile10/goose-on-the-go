/**
 * The Devices header's two actions are one size: a filled primary and a quiet
 * secondary, both round at Ink's touch floor.
 *
 * "Add a device" used to be a full-width labelled bar beside a small round
 * Refresh. What this pins is that the two tones differ only in colour, never in
 * footprint, in light and in dark, and that an icon-only button still says what
 * it does to a screen reader.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { InkProvider } from '@jarida/ink/native';
import { createTheme } from '@jarida/ink/tokens';

import { GRoundButton } from '../g-round-button';
import { GIcon } from '../g-icon';
import { GPressable } from '../g-pressable';

// lucide ships ES modules Jest does not transform; the glyph's own drawing is not what is under
// test, only the props the button hands it.
jest.mock('../g-icon', () => ({ GIcon: function GIcon() { return null; } }));

function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(element);
  });
  return tree;
}

function face(tree: ReactTestRenderer) {
  // GPressable's own props: the press response it layers on top is its business, not this one's.
  const pressable = tree.root.findByType(GPressable);
  return {
    pressable,
    style: StyleSheet.flatten(pressable.props.style),
    glyph: tree.root.findByType(GIcon).props,
  };
}

describe.each(['light', 'dark'] as const)('GRoundButton in %s', (scheme) => {
  const theme = createTheme({ scheme, accent: 'Purple' });
  const inScheme = (tone: 'primary' | 'secondary') =>
    face(render(
      <InkProvider scheme={scheme} accent="Purple">
        <GRoundButton icon={tone === 'primary' ? 'plus' : 'refresh'} tone={tone} label={tone} onPress={() => undefined} />
      </InkProvider>,
    ));

  it('draws both tones as the same circle at the touch floor', () => {
    const primary = inScheme('primary').style;
    const secondary = inScheme('secondary').style;
    for (const style of [primary, secondary]) {
      expect(style.width).toBe(theme.touch.tapMin);
      expect(style.height).toBe(theme.touch.tapMin);
      expect(style.borderRadius).toBe(theme.touch.tapMin / 2);
      expect(style.borderWidth).toBe(theme.edge.hairlineWidth);
    }
  });

  it('fills the primary with the accent and keeps the secondary on the surface', () => {
    const primary = inScheme('primary');
    const secondary = inScheme('secondary');
    expect(primary.style.backgroundColor).toBe(theme.color.accent);
    expect(primary.glyph.color).toBe(theme.color.textOnAccent);
    expect(secondary.style.backgroundColor).toBe(theme.color.surface);
    expect(secondary.style.borderColor).toBe(theme.color.lineStrong);
    expect(secondary.glyph.color).toBe(theme.color.text);
    expect(primary.glyph.size).toBe(secondary.glyph.size);
  });
});

describe('GRoundButton', () => {
  it('names itself to a screen reader and reports a running read', () => {
    const onPress = jest.fn();
    const { pressable } = face(render(<GRoundButton icon="refresh" label="Refresh devices" onPress={onPress} busy />));
    expect(pressable.props.accessibilityRole).toBe('button');
    expect(pressable.props.accessibilityLabel).toBe('Refresh devices');
    expect(pressable.props.accessibilityState).toEqual({ busy: true });
    act(() => pressable.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is secondary unless asked otherwise', () => {
    const theme = createTheme({});
    const { style } = face(render(<GRoundButton icon="refresh" label="Refresh devices" onPress={() => undefined} />));
    expect(style.backgroundColor).toBe(theme.color.surface);
  });
});
