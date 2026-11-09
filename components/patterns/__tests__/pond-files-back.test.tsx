// Files: back, from the header arrow or the phone, steps up one folder while one is open, and
// leaves Files only from the data directory itself.

import React from 'react';
import { BackHandler } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/services/i18n';
import PondFilesScreen from '@/app/(stack)/pond-files';
import { ThemeProvider } from '@/providers/theme-provider';

const mockBack = jest.fn();
const mockUp = jest.fn();
const mockFiles = {
  gate: { phase: 'unlocked' },
  path: 'logs',
  crumbs: [{ path: '', name: null }, { path: 'logs', name: 'logs' }],
  entries: [],
  total: 0,
  loading: false,
  failed: false,
  error: null,
  notice: null,
  removing: null,
  actions: { refresh: jest.fn(), open: jest.fn(), goTo: jest.fn(), up: mockUp, remove: jest.fn() },
};
const mockHeader: { headerLeft?: () => React.ReactElement } = {};

// lucide ships ES modules Jest does not transform; the glyph is not under test.
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/services/haptics', () => ({ selectionTick: jest.fn(), confirm: jest.fn() }));
jest.mock('@/components/pond/admin-lock', () => ({ AdminLockView: () => null }));
jest.mock('@/view-models/use-pond-files', () => ({ usePondFiles: () => mockFiles }));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ back: mockBack }),
    // The screen is always focused here.
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
    Stack: {
      Screen: ({ options }: { options: { headerLeft?: () => React.ReactElement } }) => {
        mockHeader.headerLeft = options.headerLeft;
        return null;
      },
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(
      <ThemeProvider>
        <PondFilesScreen />
      </ThemeProvider>,
    );
  });
  return tree!;
}

/** Presses the header's back arrow, as rendered from the options the screen set. */
async function pressHeaderBack() {
  let arrow: ReactTestRenderer | undefined;
  await act(async () => {
    arrow = create(<ThemeProvider>{mockHeader.headerLeft!()}</ThemeProvider>);
  });
  const button = arrow!.root.find((n) => typeof n.props.onPress === 'function' && n.props.accessibilityRole === 'button');
  await act(async () => button.props.onPress());
}

type BackListener = Parameters<typeof BackHandler.addEventListener>[1];

/** What the phone's back does: the most recent listener answers first, as in React Native. */
function phoneBack(listeners: BackListener[]): boolean {
  const press = {} as Parameters<BackListener>[0];
  return [...listeners].reverse().some((listener) => listener(press) === true);
}

let listeners: BackListener[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  listeners = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    listeners.push(handler);
    return { remove: () => (listeners = listeners.filter((h) => h !== handler)) };
  });
  mockFiles.path = 'logs';
  mockFiles.gate = { phase: 'unlocked' };
});

describe('back in Files', () => {
  it('steps up one folder from the phone and the header while a folder is open', async () => {
    await render();
    expect(phoneBack(listeners)).toBe(true);
    expect(mockUp).toHaveBeenCalledTimes(1);

    await pressHeaderBack();
    expect(mockUp).toHaveBeenCalledTimes(2);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('leaves Files from the data directory', async () => {
    mockFiles.path = '';
    await render();
    expect(phoneBack(listeners)).toBe(false);

    await pressHeaderBack();
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockUp).not.toHaveBeenCalled();
  });

  it('steps up while the gate is still checking, as the listing already shows', async () => {
    mockFiles.gate = { phase: 'checking' };
    await render();
    expect(phoneBack(listeners)).toBe(true);
    expect(mockUp).toHaveBeenCalledTimes(1);
  });

  it('leaves Files while My Pond is locked, wherever it was', async () => {
    mockFiles.gate = { phase: 'locked' };
    await render();
    expect(phoneBack(listeners)).toBe(false);
    expect(mockUp).not.toHaveBeenCalled();
  });
});
