/**
 * The confirm dialog, asked for by promise: every way out of it settles the promise, and only the
 * confirm button settles it as yes.
 *
 * The answers are driven through what the dialog actually renders -- the Ink buttons by their
 * label, the backdrop, and the Modal's `onRequestClose`, which is what Android's back button
 * calls -- so a dialog whose Cancel button or back press stopped reaching the provider fails here.
 */

import '@/services/i18n';
import React from 'react';
import { Modal } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { InkButton } from '@jarida/ink/native';

import { caution } from '@/services/haptics';
import { ConfirmProvider, useChoice, useConfirm, type ChooseFn, type ConfirmFn } from '../confirm-provider';

jest.mock('@/services/haptics', () => ({ caution: jest.fn(async () => undefined) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Mounted {
  tree: ReactTestRenderer;
  confirm: ConfirmFn;
  choose: ChooseFn;
}

async function mount(): Promise<Mounted> {
  const hooks: { confirm?: ConfirmFn; choose?: ChooseFn } = {};
  const Probe = () => {
    hooks.confirm = useConfirm();
    hooks.choose = useChoice();
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ConfirmProvider>
        <Probe />
      </ConfirmProvider>,
    );
  });
  return { tree, confirm: hooks.confirm!, choose: hooks.choose! };
}

const REMOVE = { title: 'Forget this memory?', message: 'Goose will no longer know it.', confirmLabel: 'Forget', destructive: true };

function button(tree: ReactTestRenderer, label: string): ReactTestInstance {
  return tree.root.find((node) => node.type === InkButton && node.props.children === label);
}

function modal(tree: ReactTestRenderer): ReactTestInstance {
  return tree.root.findByType(Modal);
}

/** Ask, let the dialog render, then run `answer` against it and return what the promise settled to. */
async function answered<T>(tree: ReactTestRenderer, ask: () => Promise<T>, answer: () => void): Promise<T> {
  let pending!: Promise<T>;
  await act(async () => {
    pending = ask();
  });
  await act(async () => answer());
  return pending;
}

// The first render pulls Ink and the Modal through Babel, which on a cold cache takes longer than
// a test's default five seconds. Paying it here keeps that cost out of the first real test.
beforeAll(async () => {
  const { tree } = await mount();
  await act(async () => tree.unmount());
}, 60_000);

beforeEach(() => jest.mocked(caution).mockClear());

it('resolves true when the confirm button is pressed, and closes', async () => {
  const { tree, confirm } = await mount();
  const result = await answered(tree, () => confirm(REMOVE), () => button(tree, 'Forget').props.onPress());
  expect(result).toBe(true);
  expect(modal(tree).props.visible).toBe(false);
});

it('resolves false on Cancel', async () => {
  const { tree, confirm } = await mount();
  expect(await answered(tree, () => confirm(REMOVE), () => button(tree, 'Cancel').props.onPress())).toBe(false);
  expect(modal(tree).props.visible).toBe(false);
});

it("resolves false on Android's back button", async () => {
  const { tree, confirm } = await mount();
  expect(await answered(tree, () => confirm(REMOVE), () => modal(tree).props.onRequestClose())).toBe(false);
});

it('resolves false on a tap on the backdrop', async () => {
  const { tree, confirm } = await mount();
  const backdrop = () => tree.root.find((node) => node.props.testID === 'confirm-dialog-backdrop' && typeof node.props.onPress === 'function');
  expect(await answered(tree, () => confirm(REMOVE), () => backdrop().props.onPress())).toBe(false);
});

it('shows the question it was asked, with the confirm painted by how much it costs', async () => {
  const { tree, confirm } = await mount();
  await act(async () => {
    void confirm(REMOVE);
  });
  expect(modal(tree).props.visible).toBe(true);
  expect(tree.root.findAll((n) => n.props.children === REMOVE.title).length).toBeGreaterThan(0);
  expect(tree.root.findAll((n) => n.props.children === REMOVE.message).length).toBeGreaterThan(0);
  expect(button(tree, 'Forget').props.variant).toBe('danger');
  expect(button(tree, 'Cancel').props.variant).toBe('quiet');

  await act(async () => button(tree, 'Cancel').props.onPress());
  await act(async () => {
    void confirm({ title: 'Install Filesystem?', message: 'It runs on the Pond.', confirmLabel: 'Install' });
  });
  expect(button(tree, 'Install').props.variant).toBe('primary');
});

it('warns by touch for a destructive question only', async () => {
  const { tree, confirm } = await mount();
  await answered(tree, () => confirm(REMOVE), () => button(tree, 'Cancel').props.onPress());
  expect(caution).toHaveBeenCalledTimes(1);
  await answered(
    tree,
    () => confirm({ title: 'Install?', message: 'Sure?', confirmLabel: 'Install' }),
    () => button(tree, 'Cancel').props.onPress(),
  );
  expect(caution).toHaveBeenCalledTimes(1);
});

it('answers an open question as Cancel when a second one is asked', async () => {
  const { tree, confirm } = await mount();
  let first!: Promise<boolean>;
  await act(async () => {
    first = confirm(REMOVE);
  });
  const second = await answered(
    tree,
    () => confirm({ title: 'Remove the key?', message: 'Search stops.', confirmLabel: 'Remove', destructive: true }),
    () => button(tree, 'Remove').props.onPress(),
  );
  expect(await first).toBe(false);
  expect(second).toBe(true);
});

it('answers an open question as Cancel when the provider goes away', async () => {
  const { tree, confirm } = await mount();
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = confirm(REMOVE);
  });
  await act(async () => tree.unmount());
  expect(await pending).toBe(false);
});

describe('choose', () => {
  const DOWNLOAD = {
    title: 'Download Gemma?',
    message: 'This uses 2 GB.',
    options: [
      { label: 'With pictures', value: true },
      { label: 'Text only', value: false },
    ],
  };

  it('resolves with the value of the option pressed', async () => {
    const { tree, choose } = await mount();
    expect(await answered(tree, () => choose(DOWNLOAD), () => button(tree, 'Text only').props.onPress())).toBe(false);
    expect(await answered(tree, () => choose(DOWNLOAD), () => button(tree, 'With pictures').props.onPress())).toBe(true);
  });

  it('resolves null on Cancel and on back', async () => {
    const { tree, choose } = await mount();
    expect(await answered(tree, () => choose(DOWNLOAD), () => button(tree, 'Cancel').props.onPress())).toBeNull();
    expect(await answered(tree, () => choose(DOWNLOAD), () => modal(tree).props.onRequestClose())).toBeNull();
  });

  it('raises only the first option', async () => {
    const { tree, choose } = await mount();
    await act(async () => {
      void choose(DOWNLOAD);
    });
    expect(button(tree, 'With pictures').props.variant).toBe('primary');
    expect(button(tree, 'Text only').props.variant).toBe('quiet');
  });

  // Unpairing from an unreachable Pond offers "Remove from this phone" beside "Try again": the
  // answer that cannot be undone has to look like it, wherever it sits, and warn like a confirm.
  it('paints a destructive option red and warns by touch', async () => {
    const { tree, choose } = await mount();
    await answered(
      tree,
      () => choose({ title: 'Remove?', message: 'Gone.', options: [{ label: 'Remove', value: 'forget', destructive: true }, { label: 'Try again', value: 'retry' }] }),
      () => {
        expect(button(tree, 'Remove').props.variant).toBe('danger');
        expect(button(tree, 'Try again').props.variant).toBe('quiet');
        button(tree, 'Cancel').props.onPress();
      },
    );
    expect(caution).toHaveBeenCalledTimes(1);

    await answered(tree, () => choose(DOWNLOAD), () => button(tree, 'Cancel').props.onPress());
    expect(caution).toHaveBeenCalledTimes(1);
  });
});

it('refuses to be used outside its provider', () => {
  const Lost = () => {
    useConfirm();
    return null;
  };
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(() => act(() => void create(<Lost />))).toThrow('useConfirm must be used inside <ConfirmProvider>');
  spy.mockRestore();
});
