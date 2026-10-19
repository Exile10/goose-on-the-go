/**
 * GSheetBody is what keeps a bottom sheet's form from collapsing to nothing.
 *
 * A bottom `InkSheet` is as tall as its content, and `GKeyboardView` fills its
 * parent with `flex: 1` — a zero flex basis that grows into free space the sheet
 * does not have. The sheet then opened as its title alone. The layout itself is
 * native, so what this pins is the style that decides it: the fill taken back
 * off, and the cap a share of the window.
 */

import React from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { GSheetBody, SHEET_BODY_MAX_HEIGHT_RATIO } from '../g-sheet-body';

function bodyStyle(tree: ReactTestRenderer) {
  // The outermost View is GKeyboardView's container, the one the sheet sizes.
  return StyleSheet.flatten(tree.root.findAllByType(View)[0].props.style);
}

function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(element);
  });
  return tree;
}

describe('GSheetBody', () => {
  const windowHeight = Dimensions.get('window').height;

  it('sizes to its content rather than filling a parent that has no height', () => {
    const style = bodyStyle(render(<GSheetBody><Text>field</Text></GSheetBody>));
    expect(style.flex).toBe(0);
  });

  it('caps the body at the default share of the window', () => {
    const style = bodyStyle(render(<GSheetBody><Text>field</Text></GSheetBody>));
    expect(style.maxHeight).toBeCloseTo(windowHeight * SHEET_BODY_MAX_HEIGHT_RATIO);
  });

  it('takes a different share when the sheet asks for one', () => {
    const style = bodyStyle(render(<GSheetBody maxHeightRatio={0.75}><Text>field</Text></GSheetBody>));
    expect(style.maxHeight).toBeCloseTo(windowHeight * 0.75);
  });

  it('renders what it is given', () => {
    const tree = render(<GSheetBody><Text>field</Text></GSheetBody>);
    expect(tree.root.findByType(Text).props.children).toBe('field');
  });
});
