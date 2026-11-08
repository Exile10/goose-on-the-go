// Help & Feedback: each common problem opens to its answer and a way to the screen that fixes it,
// and the contact rows write to support.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/services/i18n';
import HelpScreen from '@/app/(stack)/help';
import { ThemeProvider } from '@/providers/theme-provider';

const mockPush = jest.fn();
const mockWrite = jest.fn().mockResolvedValue(undefined);
const mockHelp = { supportEmail: 'support@jarida.io', mailFailed: false, actions: { write: mockWrite } };

// lucide ships ES modules Jest does not transform; the glyph is not under test.
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));
jest.mock('@/view-models/use-help', () => ({ useHelp: () => mockHelp }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function shownText(tree: ReactTestRenderer): string {
  return tree.root
    .findAll((n) => typeof n.props.children === 'string')
    .map((n) => n.props.children as string)
    .join(' ');
}

/** Presses the row a screen reader would announce with this label. */
async function press(tree: ReactTestRenderer, label: string) {
  const row = tree.root.find((n) => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(label));
  await act(async () => row.props.onPress());
}

async function render(): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(
      <ThemeProvider>
        <HelpScreen />
      </ThemeProvider>,
    );
  });
  return tree!;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHelp.mailFailed = false;
});

describe('the Help & Feedback screen', () => {
  it('opens a problem to its answer and a way to the screen that fixes it', async () => {
    const tree = await render();
    expect(shownText(tree)).not.toContain('outside access is set up');

    await press(tree, "The app can't reach your Pond");
    expect(shownText(tree)).toContain('outside access is set up in Remote access');

    await press(tree, 'Open Remote access');
    expect(mockPush).toHaveBeenCalledWith('/(stack)/remote-access');
  });

  it('writes a problem report or feedback to support', async () => {
    const tree = await render();
    expect(shownText(tree)).toContain('support@jarida.io');

    await press(tree, 'Report a problem');
    await press(tree, 'Send feedback');
    expect(mockWrite.mock.calls).toEqual([['problem'], ['feedback']]);
  });

  it('gives the address to write to when the phone has no mail app', async () => {
    mockHelp.mailFailed = true;
    const tree = await render();
    expect(shownText(tree)).toContain('This phone has no mail app to open. Write to support@jarida.io');
  });
});
