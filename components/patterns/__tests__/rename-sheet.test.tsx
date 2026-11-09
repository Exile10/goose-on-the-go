/**
 * Renaming the conversation on screen, as the dashboard's header does: a typed name, or one asked of
 * Goose, and the sheet stays open with the reason when either is refused.
 */

import React from 'react';
import { Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import i18n from '@/services/i18n';

import { RenameSheet } from '../rename-sheet';

jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));
jest.mock('@/services/haptics', () => ({ confirm: jest.fn(), reject: jest.fn() }));

function texts(tree: ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(''));
}

async function press(tree: ReactTestRenderer, label: string) {
  const target = tree.root.findAll(
    (node) => typeof node.props.onPress === 'function' && texts({ root: node } as never).includes(label),
  )[0];
  await act(async () => {
    target.props.onPress();
  });
}

function type(tree: ReactTestRenderer, value: string) {
  act(() => tree.root.findByType(TextInput).props.onChangeText(value));
}

function render(props: Partial<React.ComponentProps<typeof RenameSheet>> = {}) {
  const onClose = jest.fn();
  const onRename = jest.fn(async () => null as string | null);
  const onNameForMe = jest.fn(async () => null as string | null);
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <RenameSheet title="who acted as Iron man for" onClose={onClose} onRename={onRename} onNameForMe={onNameForMe} {...props} />,
    );
  });
  return { tree, onClose, onRename, onNameForMe };
}

describe('the rename sheet', () => {
  const save = i18n.t('chat.rename.save');
  const askGoose = i18n.t('chat.rename.askGoose');

  it('starts from the name the conversation has', () => {
    const { tree } = render();
    expect(tree.root.findByType(TextInput).props.value).toBe('who acted as Iron man for');
  });

  it('saves a typed name and closes', async () => {
    const { tree, onRename, onClose } = render();
    type(tree, 'Iron Man casting');
    await press(tree, save);
    expect(onRename).toHaveBeenCalledWith('Iron Man casting');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes without a request when the name is unchanged', async () => {
    const { tree, onRename, onClose } = render();
    await press(tree, save);
    expect(onRename).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('asks Goose for a name', async () => {
    const { tree, onNameForMe, onClose } = render();
    await press(tree, askGoose);
    expect(onNameForMe).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open and says why when refused', async () => {
    const refusal = i18n.t('chat.rename.kept');
    const { tree, onClose } = render({ onNameForMe: async () => refusal });
    await press(tree, askGoose);
    expect(onClose).not.toHaveBeenCalled();
    expect(texts(tree)).toContain(refusal);
  });
});
