/**
 * The snackbar: one message at a time, gone by itself on a clock that depends on whether it offers
 * an action and whether a screen reader is on, announced when it appears, and clear of the bar
 * and the safe area at the foot of the screen.
 *
 * Driven through what the host renders -- the message's text, its Pressables -- so a host that
 * stopped drawing the newer message, or whose action stopped reaching its caller, fails here.
 */

import '@/services/i18n';
import React from 'react';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ACCENT_NAMES, contrast, type InkScheme } from '@jarida/ink';
import { InkProvider } from '@jarida/ink/native';

import { SNACKBAR_ACTION_MS, SNACKBAR_MS, currentSnackbar, resetSnackbar, showSnackbar } from '@/services/snackbar';
import {
  SNACKBAR_ICON,
  SnackbarProvider,
  snackbarDuration,
  snackbarPalette,
  useSnackbar,
  useSnackbarClearance,
  type SnackbarApi,
} from '../snackbar-provider';

// lucide ships ES modules Jest does not transform; the glyph's name and colour are what is checked.
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 20 }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let screenReader = false;
let announce: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  screenReader = false;
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockImplementation(async () => screenReader);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(() => ({ remove: () => {} }) as never);
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  resetSnackbar();
});

// The message is one store for the whole process, so a host left mounted by an earlier test would
// time out a later test's message on its own clock.
const mounted: ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => mounted.splice(0).forEach((t) => t.unmount()));
  jest.useRealTimers();
  jest.restoreAllMocks();
});

interface Mounted {
  tree: ReactTestRenderer;
  api: SnackbarApi;
}

/** `animate: false` is Reduce Motion: the message comes and goes without a slide to wait out. */
async function mount({
  animate = false,
  clearance = 0,
  scheme = 'light',
}: { animate?: boolean; clearance?: number; scheme?: InkScheme } = {}): Promise<Mounted> {
  const hooks: { api?: SnackbarApi } = {};
  const Probe = () => {
    hooks.api = useSnackbar();
    useSnackbarClearance(clearance);
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <InkProvider animate={animate} scheme={scheme} accent="Purple">
        <SnackbarProvider>
          <Probe />
        </SnackbarProvider>
      </InkProvider>,
    );
  });
  mounted.push(tree);
  return { tree, api: hooks.api! };
}

function messages(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAll((n) => n.type === Text && typeof n.props.children === 'string')
    .map((n) => n.props.children as string);
}

/** The outermost element that answers a press and holds `text`. */
function pressable(tree: ReactTestRenderer, text: string) {
  const [outer] = tree.root.findAll(
    (n) => typeof n.props.onPress === 'function' && n.findAll((c) => c.type === Text && c.props.children === text).length > 0,
  );
  if (!outer) throw new Error(`nothing pressable says ${text}`);
  return outer;
}

/** The glyph at the start of the message, and the colour it is drawn in. */
function iconOf(tree: ReactTestRenderer): { name: string; color: string } {
  const [glyph] = tree.root.findByProps({ testID: 'snackbar-icon' }).findAll((n) => typeof n.props.name === 'string');
  return { name: glyph.props.name, color: glyph.props.color };
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

it('shows the message and announces it once', async () => {
  const { tree, api } = await mount();
  await act(async () => {
    api.show({ message: 'Saved on your Pond.' });
  });
  expect(messages(tree)).toEqual(['Saved on your Pond.']);
  expect(announce).toHaveBeenCalledTimes(1);
  expect(announce).toHaveBeenCalledWith('Saved on your Pond.');
});

it('replaces the message on screen rather than stacking a second one', async () => {
  const { tree, api } = await mount();
  await act(async () => {
    api.show({ message: 'Saved on your Pond.' });
  });
  await act(async () => {
    api.show({ message: 'Could not start the run.', tone: 'danger' });
  });
  expect(messages(tree)).toEqual(['Could not start the run.']);
  expect(announce).toHaveBeenLastCalledWith('Could not start the run.');
});

it('goes by itself after about four seconds', async () => {
  const { tree, api } = await mount();
  await act(async () => {
    api.show({ message: 'Saved on your Pond.' });
  });
  await advance(SNACKBAR_MS - 1);
  expect(messages(tree)).toEqual(['Saved on your Pond.']);
  await advance(1);
  expect(messages(tree)).toEqual([]);
});

it('does not let an older message’s timer take a newer one with it', async () => {
  const { tree, api } = await mount();
  await act(async () => {
    api.show({ message: 'Saved on your Pond.' });
  });
  await advance(SNACKBAR_MS - 1_000);
  await act(async () => {
    api.show({ message: 'Run started.' });
  });
  await advance(1_000);
  expect(messages(tree)).toEqual(['Run started.']);
  await advance(SNACKBAR_MS);
  expect(messages(tree)).toEqual([]);
});

it('stays longer when it offers an action, and the action runs and puts it away', async () => {
  const retry = jest.fn();
  const { tree, api } = await mount();
  await act(async () => {
    api.show({ message: 'Could not save.', tone: 'danger', action: { label: 'Try again', onPress: retry } });
  });
  await advance(SNACKBAR_MS);
  expect(messages(tree)).toEqual(['Could not save.', 'Try again']);
  await act(async () => pressable(tree, 'Try again').props.onPress());
  expect(retry).toHaveBeenCalledTimes(1);
  expect(messages(tree)).toEqual([]);
  expect(currentSnackbar()).toBeNull();
});

it('goes after about eight seconds when its action is not taken', async () => {
  const { tree, api } = await mount();
  await act(async () => {
    api.show({ message: 'Could not save.', tone: 'danger', action: { label: 'Try again', onPress: () => {} } });
  });
  await advance(SNACKBAR_ACTION_MS);
  expect(messages(tree)).toEqual([]);
});

it('keeps one that offers an action until it is put away while a screen reader is on', async () => {
  screenReader = true;
  const { tree, api } = await mount();
  await act(async () => {
    api.show({ message: 'Could not save.', tone: 'danger', action: { label: 'Try again', onPress: () => {} } });
  });
  await advance(SNACKBAR_ACTION_MS * 3);
  expect(messages(tree)).toEqual(['Could not save.', 'Try again']);
  await act(async () => pressable(tree, 'Could not save.').props.onAccessibilityEscape());
  expect(messages(tree)).toEqual([]);
});

it('is put away by a tap on the message', async () => {
  const { tree, api } = await mount();
  await act(async () => {
    api.show({ message: 'Saved on your Pond.' });
  });
  await act(async () => pressable(tree, 'Saved on your Pond.').props.onPress());
  expect(messages(tree)).toEqual([]);
});

it('stays for as long as a long sentence takes to read', () => {
  const long = { id: 1, tone: 'danger' as const, message: Array.from({ length: 40 }, () => 'word').join(' ') };
  expect(snackbarDuration(long, false)).toBeGreaterThan(SNACKBAR_MS);
  expect(snackbarDuration({ id: 2, tone: 'neutral', message: 'Saved.' }, false)).toBe(SNACKBAR_MS);
  expect(snackbarDuration({ ...long, action: { label: 'Try again', onPress: () => {} } }, true)).toBeNull();
});

it('sits above a bar that reports its height, and above the safe area otherwise', async () => {
  const bottomOf = (tree: ReactTestRenderer) =>
    StyleSheet.flatten(tree.root.findByProps({ testID: 'snackbar' }).props.style).marginBottom as number;

  const plain = await mount();
  await act(async () => {
    plain.api.show({ message: 'Saved on your Pond.' });
  });
  const overSafeArea = bottomOf(plain.tree);

  const tabs = await mount({ clearance: 96 });
  await act(async () => {
    tabs.api.show({ message: 'Saved on your Pond.' });
  });
  const overBar = bottomOf(tabs.tree);

  expect(overSafeArea).toBeGreaterThan(20);
  expect(overBar - overSafeArea).toBe(96 - 20);
});

it('can be asked for from outside React, as a store does', async () => {
  const { tree } = await mount();
  await act(async () => {
    showSnackbar({ message: 'Download started.' });
  });
  expect(messages(tree)).toEqual(['Download started.']);
});

it('slides away with its words on it when motion is allowed', async () => {
  const { tree, api } = await mount({ animate: true });
  await act(async () => {
    api.show({ message: 'Saved on your Pond.' });
  });
  await act(async () => api.dismiss());
  expect(messages(tree)).toEqual(['Saved on your Pond.']);
  await advance(1_000);
  expect(messages(tree)).toEqual([]);
});

it.each([
  ['success', 'Saved on your Pond.', 'done'],
  ['danger', 'Could not save.', 'alert'],
  ['neutral', 'That reminder was already gone.', 'info'],
] as const)('opens a %s message with its own icon, in its own colour', async (tone, message, icon) => {
  const { tree, api } = await mount();
  await act(async () => {
    api.show({ message, tone });
  });
  expect(SNACKBAR_ICON[tone]).toBe(icon);
  expect(iconOf(tree)).toEqual({ name: icon, color: snackbarPalette({ scheme: 'light', accent: 'Purple' }).icon[tone] });
  // The icon says nothing of its own: the sentence is what is read.
  expect(tree.root.findByProps({ testID: 'snackbar-icon' }).props.importantForAccessibility).toBe('no-hide-descendants');
  expect(messages(tree)).toEqual([message]);
});

it('keeps a confirmation as a success, and a message given no tone as neutral', async () => {
  const { tree, api } = await mount();
  await act(async () => {
    api.show({ message: 'Run started.', tone: 'success' });
  });
  expect(currentSnackbar()?.tone).toBe('success');
  await act(async () => {
    api.show({ message: 'That reminder was already gone.' });
  });
  expect(currentSnackbar()?.tone).toBe('neutral');
  expect(iconOf(tree).name).toBe('info');
});

it('draws in the other scheme: dark over a light app, light over a dark one', async () => {
  const groundOf = (tree: ReactTestRenderer) =>
    StyleSheet.flatten(tree.root.findByProps({ testID: 'snackbar' }).props.style).backgroundColor as string;

  const light = await mount({ scheme: 'light' });
  await act(async () => {
    light.api.show({ message: 'Saved on your Pond.', tone: 'success' });
  });
  const dark = await mount({ scheme: 'dark' });
  await act(async () => {
    dark.api.show({ message: 'Saved on your Pond.', tone: 'success' });
  });

  expect(groundOf(light.tree)).toBe(snackbarPalette({ scheme: 'light', accent: 'Purple' }).ground);
  expect(groundOf(dark.tree)).toBe(snackbarPalette({ scheme: 'dark', accent: 'Purple' }).ground);
  expect(groundOf(light.tree)).not.toBe(groundOf(dark.tree));
});

it('keeps the message, the action and every icon readable on its surface, in both schemes and every accent', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const accent of ACCENT_NAMES) {
      const p = snackbarPalette({ scheme, accent });
      const where = `${scheme} ${accent}`;
      expect([where, contrast(p.words, p.ground) >= 4.5]).toEqual([where, true]);
      expect([where, contrast(p.action, p.ground) >= 4.5]).toEqual([where, true]);
      for (const tone of ['success', 'danger', 'neutral'] as const) {
        expect([where, tone, contrast(p.icon[tone], p.ground) >= 4.5]).toEqual([where, tone, true]);
      }
    }
  }
});

it('offers its action as a button a finger can hit, in the accent, and the action still runs', async () => {
  const retry = jest.fn();
  const { tree, api } = await mount();
  await act(async () => {
    api.show({ message: 'Could not start the run.', tone: 'danger', action: { label: 'Try again', onPress: retry } });
  });
  const button = pressable(tree, 'Try again');
  expect(button.props.accessibilityRole).toBe('button');
  const style = StyleSheet.flatten(button.props.style({ pressed: false }));
  expect(style.minHeight).toBeGreaterThanOrEqual(44);
  expect(style.minWidth).toBeGreaterThanOrEqual(44);
  const label = tree.root.findAll((n) => n.type === Text && n.props.children === 'Try again')[0];
  expect(StyleSheet.flatten(label.props.style).color).toBe(snackbarPalette({ scheme: 'light', accent: 'Purple' }).action);
  await act(async () => button.props.onPress());
  expect(retry).toHaveBeenCalledTimes(1);
  expect(currentSnackbar()).toBeNull();
});

it('shows at most two lines, and still announces the whole sentence', async () => {
  const long = Array.from({ length: 30 }, () => 'word').join(' ');
  const { tree, api } = await mount();
  await act(async () => {
    api.show({ message: long, tone: 'danger' });
  });
  const text = tree.root.findAll((n) => n.type === Text && n.props.children === long)[0];
  expect(text.props.numberOfLines).toBe(2);
  expect(pressable(tree, long).props.accessibilityLabel).toBe(long);
  expect(announce).toHaveBeenCalledWith(long);
});
