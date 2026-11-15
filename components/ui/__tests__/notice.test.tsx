/**
 * A notice is a plain line: an icon and the words, never a tinted or bordered box.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { registerIcons } from '@jarida/ink';
import { InkIcon, InkProvider } from '@jarida/ink/native';

import { InkNotice } from '@/components/ui/ink';

const Glyph = () => null;
registerIcons({ alert: Glyph, done: Glyph, info: Glyph, wifi: Glyph });

function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<InkProvider scheme="light">{element}</InkProvider>);
  });
  return tree;
}

function outer(tree: ReactTestRenderer) {
  return tree.root.findAll((n) => n.type === View && n.props.accessibilityLiveRegion !== undefined)[0];
}

describe('InkNotice', () => {
  it.each(['neutral', 'info', 'success', 'warning', 'danger'] as const)('draws no box for a %s notice', (tone) => {
    const style = StyleSheet.flatten(outer(render(<InkNotice tone={tone}>Bluetooth is off.</InkNotice>)).props.style);
    expect(style.backgroundColor).toBeUndefined();
    expect(style.borderWidth).toBeUndefined();
    expect(style.padding ?? style.paddingVertical ?? style.paddingHorizontal).toBeUndefined();
  });

  it('marks its tone with an icon, or the one it is given', () => {
    const warning = render(<InkNotice tone="warning">Bluetooth is off.</InkNotice>);
    expect(warning.root.findByType(InkIcon).props).toMatchObject({ name: 'alert', tone: 'warning' });
    const given = render(<InkNotice tone="info" icon="wifi">Offline.</InkNotice>);
    expect(given.root.findByType(InkIcon).props).toMatchObject({ name: 'wifi', tone: 'info' });
    expect(render(<InkNotice icon={null}>Plain.</InkNotice>).root.findAllByType(InkIcon)).toHaveLength(0);
  });

  it('interrupts only for danger', () => {
    expect(outer(render(<InkNotice tone="danger">Could not save.</InkNotice>)).props.accessibilityRole).toBe('alert');
    const polite = outer(render(<InkNotice tone="warning">Bluetooth is off.</InkNotice>));
    expect(polite.props.accessibilityRole).toBeUndefined();
    expect(polite.props.accessibilityLiveRegion).toBe('polite');
  });

  it('keeps its words and its action', () => {
    const tree = render(<InkNotice action={<Text>Look again</Text>}>Bluetooth is off.</InkNotice>);
    const words = tree.root.findAllByType(Text).map((n) => n.props.children);
    expect(words).toEqual(expect.arrayContaining(['Bluetooth is off.', 'Look again']));
  });
});
