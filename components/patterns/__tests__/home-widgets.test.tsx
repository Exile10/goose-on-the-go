/**
 * What Home's widgets say: music in words when it is quiet, a temperature with the place it is
 * for, a count of what waits only when something does, and no count about an unknown list.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { GPressable } from '@/components/ui/g-pressable';
import i18n from '@/services/i18n';

import {
  DevicesWidget,
  NextRoutineWidget,
  NowPlayingWidget,
  OutsideWidget,
  RememberWidget,
} from '../home-widgets';

// lucide ships ES modules Jest does not transform; the glyph is not under test.
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));
// Reanimated's worklets do not exist under Jest; the bars have their own test.
jest.mock('@/components/ui/equalizer-bars', () => ({ EqualizerBars: () => null }));
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true }) }));

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

const texts = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(Text).flatMap((t) => (typeof t.props.children === 'string' ? [t.props.children] : []));

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('NowPlayingWidget', () => {
  it('names the track and the artist while something plays', async () => {
    const tree = await render(<NowPlayingWidget playing={{ state: 'playing', track: 'Midnight City', artist: 'M83' }} />);
    expect(texts(tree)).toEqual(expect.arrayContaining(['Midnight City', 'M83']));
  });

  it('says nothing is playing, rather than disappearing, when Spotify is quiet', async () => {
    const tree = await render(<NowPlayingWidget playing={{ state: 'idle' }} />);
    expect(texts(tree)).toContain(i18n.t('home.nothingPlaying'));
  });
});

describe('OutsideWidget', () => {
  it('rounds to a whole degree and names the place', async () => {
    const tree = await render(<OutsideWidget outdoor={{ temp: 18.6, place: 'Nairobi' }} />);
    expect(texts(tree)).toEqual(expect.arrayContaining([i18n.t('home.widgets.temp', { temp: 19 }), 'Nairobi']));
  });
});

describe('RememberWidget', () => {
  const first = { id: 'r1', text: 'Call the plumber', due: null, said: 'Yesterday' };

  it('counts what waits behind the first reminder only when something does, and opens them', async () => {
    const onOpen = jest.fn();
    const tree = await render(<RememberWidget reminders={{ first, more: 2 } as never} onOpen={onOpen} />);
    expect(texts(tree)).toContain(i18n.t('home.widgets.more', { count: 2 }));
    act(() => tree.root.findByType(GPressable).props.onPress());
    expect(onOpen).toHaveBeenCalled();

    const alone = await render(<RememberWidget reminders={{ first, more: 0 } as never} onOpen={jest.fn()} />);
    expect(texts(alone)).not.toContain(i18n.t('home.widgets.more', { count: 0 }));
  });
});

describe('NextRoutineWidget', () => {
  it('gives the routine how long until it runs', async () => {
    const now = new Date('2026-10-31T18:00:00');
    const tree = await render(
      <NextRoutineWidget routine={{ label: 'Lights out', nextRun: new Date('2026-10-31T20:00:00') }} now={now} onOpen={jest.fn()} />,
    );
    expect(texts(tree)).toEqual(expect.arrayContaining(['Lights out', i18n.t('home.inHours', { count: 2 })]));
  });
});

describe('DevicesWidget', () => {
  const props = {
    devices: [],
    powerById: {},
    state: 'empty' as const,
    error: null,
    onRetry: jest.fn(),
    onToggle: jest.fn(),
    onSeeAll: jest.fn(),
    empty: null,
  };

  it('states how many are online only about a list that is known', async () => {
    const known = await render(<DevicesWidget {...props} online={{ count: 7, total: 9 }} />);
    expect(texts(known)).toContain(i18n.t('home.widgets.online', { online: 7, total: 9 }));
    const unknown = await render(<DevicesWidget {...props} online={null} />);
    expect(texts(unknown).some((t) => t.includes('online'))).toBe(false);
  });
});
