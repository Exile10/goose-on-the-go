// The Pond takes private reminders by voice only, so the schedule form says how to set one, and an
// edit of one says its words stay private instead of calling it a webhook.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/services/i18n';
import { ScheduleFormSheet } from '@/components/patterns/schedule-form-sheet';
import { ThemeProvider } from '@/providers/theme-provider';
import type { Schedule } from '@/services/types';

jest.mock('@/services/haptics', () => ({
  confirm: jest.fn().mockResolvedValue(undefined),
  reject: jest.fn().mockResolvedValue(undefined),
  toggle: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/components/patterns/routine-devices', () => ({ RoutineDevices: () => null }));

const MEDICINE: Schedule = {
  id: 'medicine',
  label: 'Medicine',
  cron: '0 0 20 * * *',
  fire_at: null,
  timezone: 'Africa/Nairobi',
  kind: { type: 'member_reminder', profile_id: 'grace', prompt: '' },
  paused: false,
  currently_running: false,
  last_run: null,
  next_run: null,
  created_at: '2026-10-01T00:00:00Z',
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Async, so ThemeProvider's stored preference lands inside the test rather than after its teardown.
async function shownText(element: React.ReactElement): Promise<string> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree!.root
    .findAll((n) => typeof n.props.children === 'string')
    .map((n) => n.props.children as string)
    .join(' ');
}

it('tells someone making a schedule how to set a private reminder instead', async () => {
  const text = await shownText(<ScheduleFormSheet open onClose={jest.fn()} onCreate={jest.fn()} asksIfMissed={false} />);
  expect(text).toContain('ask Goose out loud for a private reminder');
});

it('says an edited private reminder keeps its words private, and never calls it a webhook', async () => {
  const text = await shownText(<ScheduleFormSheet open onClose={jest.fn()} schedule={MEDICINE} onUpdate={jest.fn()} />);
  expect(text).toContain('What this reminder says stays private.');
  expect(text).not.toContain('webhook');
  expect(text).not.toContain('ask Goose out loud');
});
