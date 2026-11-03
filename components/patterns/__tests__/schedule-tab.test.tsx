// The Schedule tab says what a schedule is and which tools it can use, even when the list is full,
// so it is not mistaken for an agent (a recipe), which is the one that can be limited to a few tools.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/services/i18n';
import { ScheduleTab } from '@/components/patterns/schedule-tab';
import type { Schedule } from '@/services/types';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/services/haptics', () => ({ selectionTick: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ isScreenReal: () => true }) }));
jest.mock('@/components/patterns/schedule-form-sheet', () => ({ ScheduleFormSheet: () => null }));
jest.mock('@/components/patterns/schedule-card', () => ({ ScheduleCard: () => null }));

const schedules = { list: [] as Schedule[] };
jest.mock('@/view-models/use-schedules', () => ({
  useSchedules: () => ({
    data: { schedules: schedules.list, live: 'stream' },
    loading: false,
    error: null,
    failed: false,
    actions: {},
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function shownText(tree: ReactTestRenderer): string {
  return tree.root
    .findAll((n) => typeof n.props.children === 'string')
    .map((n) => n.props.children as string)
    .join(' ');
}

function render(): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(<ScheduleTab />);
  });
  return tree!;
}

it.each([
  ['empty', []],
  ['full', [{ id: 's1', name: 'Morning briefing', cron: '0 0 7 * * *', prompt: 'Brief me', enabled: true }]],
])('says what a schedule is and which tools it can use when the list is %s', (_, list) => {
  // The cards are stubbed, so a schedule only needs to exist, not be complete.
  schedules.list = list as unknown as Schedule[];
  const text = shownText(render());
  expect(text).toContain('A schedule decides when Goose acts.');
  expect(text).toContain('any tool that is switched on');
});
