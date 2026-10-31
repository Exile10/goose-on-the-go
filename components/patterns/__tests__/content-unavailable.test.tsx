/**
 * The view a screen shows in place of content that did not arrive, rendered in both schemes.
 *
 * What it must never do is the thing it replaced: say the Pond is unreachable a second time under
 * the connection indicator, offer a button for what the screen's pull to refresh does, or put a
 * status code or an exception's text in front of a reader. A screen reader, which cannot easily
 * pull, gets the same retry as an accessibility action on the hint. And it must be the same calm view in light and dark,
 * with the icon in the theme's secondary text colour rather than a red that shouts.
 */

import '@/services/i18n';
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { registerIcons } from '@jarida/ink';
import { InkButton, InkIcon, InkProvider } from '@jarida/ink/native';

import { ContentUnavailable, type ContentUnavailableProps } from '../content-unavailable';

// The app registers lucide's glyphs, which jest cannot load. The names are what is under test.
const Glyph = () => null;
registerIcons({ 'cloud-off': Glyph, 'cloud-alert': Glyph });

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Scheme = 'light' | 'dark';

function view(props: ContentUnavailableProps, scheme: Scheme) {
  return (
    <InkProvider scheme={scheme} accent="Purple">
      <ContentUnavailable {...props} />
    </InkProvider>
  );
}

function render(props: ContentUnavailableProps, scheme: Scheme = 'light') {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(view(props, scheme));
  });
  return tree;
}

/** Every string drawn, in order. */
function words(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(Text)
    .map((node) => node.props.children)
    .filter((child): child is string => typeof child === 'string');
}

function buttons(tree: ReactTestRenderer) {
  return tree.root.findAllByType(InkButton);
}

/** The pull hint, which is also the screen reader's way to try again. */
function hints(tree: ReactTestRenderer) {
  return tree.root.findAll((n) => typeof n.type !== 'string' && Array.isArray(n.props.accessibilityActions));
}

/** The state's icon. */
function iconOf(tree: ReactTestRenderer) {
  return tree.root.findAllByType(InkIcon)[0].props;
}

/** The colour a string is drawn in, once Ink's theme has resolved it. */
function colourOf(tree: ReactTestRenderer, text: string): string {
  const node = tree.root.findAll((n) => n.type === Text && n.props.children === text)[0];
  return StyleSheet.flatten(node.props.style).color as string;
}

describe.each<Scheme>(['light', 'dark'])('ContentUnavailable in %s', (scheme) => {
  it('says the content is waiting while the connection is down, with no cause and no button', () => {
    const tree = render({ state: 'unreachable', onRetry: jest.fn() }, scheme);
    expect(words(tree)).toEqual(['Waiting for your Pond', 'This fills in as soon as your Pond is back.']);
    // The connection indicator owns the cause and the action for it.
    expect(words(tree).join(' ')).not.toMatch(/unreachable|unavailable|offline/i);
    expect(buttons(tree)).toHaveLength(0);
    expect(hints(tree)).toHaveLength(0);
    expect(iconOf(tree)).toMatchObject({ name: 'cloud-off', tone: 'neutral' });
  });

  it('gives a failed read a title, one sentence and the pull hint, with no button', () => {
    const tree = render({ state: 'failed', onRetry: jest.fn() }, scheme);
    expect(words(tree)).toEqual(['This did not load', 'Your Pond had trouble answering.', 'Pull down to try again']);
    expect(buttons(tree)).toHaveLength(0);
    expect(iconOf(tree)).toMatchObject({ name: 'cloud-alert', tone: 'neutral' });
  });

  it('lets a screen reader try again from the hint, since it cannot easily pull', () => {
    const onRetry = jest.fn();
    const tree = render({ state: 'failed', onRetry }, scheme);
    const [hint] = hints(tree);
    expect(hint.props).toMatchObject({
      accessible: true,
      accessibilityRole: 'button',
      accessibilityLabel: 'Pull down to try again',
      accessibilityActions: [{ name: 'activate', label: 'Try again' }],
    });
    act(() => hint.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("uses the view-model's own sentence when it has one", () => {
    const tree = render({ state: 'failed', reason: 'Your Pond is busy right now.', onRetry: jest.fn() }, scheme);
    expect(words(tree)[1]).toBe('Your Pond is busy right now.');
  });

  it('ignores a reason while the connection is down, since the indicator already gave it', () => {
    const tree = render({ state: 'unreachable', reason: 'Your Pond is busy right now.', onRetry: jest.fn() }, scheme);
    expect(words(tree)).not.toContain('Your Pond is busy right now.');
  });
});

describe('ContentUnavailable follows the scheme', () => {
  it('draws its words in the theme rather than a fixed colour', () => {
    const light = render({ state: 'failed', onRetry: jest.fn() }, 'light');
    const dark = render({ state: 'failed', onRetry: jest.fn() }, 'dark');
    for (const text of ['This did not load', 'Your Pond had trouble answering.']) {
      expect(colourOf(light, text)).toBeTruthy();
      expect(colourOf(light, text)).not.toBe(colourOf(dark, text));
    }
  });
});

describe('ContentUnavailable when the connection comes back', () => {
  it('reads again by itself, and keeps saying it is waiting until that read settles', async () => {
    let settle!: () => void;
    const onRetry = jest.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    const tree = render({ state: 'unreachable', onRetry });

    // The connection is back; the failure on record is the outage's, so it is not shown.
    act(() => tree.update(view({ state: 'failed', onRetry }, 'light')));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(words(tree)[0]).toBe('Waiting for your Pond');
    expect(hints(tree)).toHaveLength(0);

    // The read failed too: now it is this screen's news.
    await act(async () => settle());
    expect(words(tree)[0]).toBe('This did not load');
    expect(hints(tree)).toHaveLength(1);
  });

  it('does not read again on its own for a failure that was never an outage', () => {
    const onRetry = jest.fn();
    const tree = render({ state: 'failed', onRetry });
    act(() => tree.update(view({ state: 'failed', reason: 'again', onRetry }, 'light')));
    expect(onRetry).not.toHaveBeenCalled();
  });
});
