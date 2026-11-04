// A private reminder comes from the Pond with what it says left out. Its card and its screen say it
// is private and whose it is, instead of passing it off as a prompt or a webhook.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/services/i18n';
import ScheduleDetailScreen from '@/app/(stack)/schedule-detail';
import { ScheduleCard } from '@/components/patterns/schedule-card';
import { ThemeProvider } from '@/providers/theme-provider';
import { api } from '@/services/api-client';
import type { Profile, Schedule } from '@/services/types';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'medicine' }),
}));
jest.mock('@/services/haptics', () => ({ toggle: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ isScreenReal: () => true }) }));
jest.mock('@/providers/confirm-provider', () => ({ useConfirm: () => jest.fn() }));
jest.mock('@/components/patterns/schedule-form-sheet', () => ({ ScheduleFormSheet: () => null }));
// Runs render markdown, which loads the icon set; this screen has no runs to show.
jest.mock('@/components/patterns/schedule-run-row', () => ({ RunRow: () => null }));
jest.mock('@/services/api-client', () => ({ api: { listProfiles: jest.fn() } }));

const mockMedicine: Schedule = {
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

const mockRuns = { data: { runs: [] }, loading: false, error: null, failed: false, actions: { refresh: jest.fn() } };
jest.mock('@/view-models/use-schedule-detail', () => ({
  useScheduleDetail: () => ({
    schedule: mockMedicine,
    loading: false,
    missing: false,
    error: null,
    failed: false,
    notice: null,
    runs: mockRuns,
    actions: { refresh: jest.fn(), refreshRuns: jest.fn() },
  }),
}));

const listProfiles = jest.mocked(api.listProfiles);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function shownText(tree: ReactTestRenderer): string {
  return tree.root
    .findAll((n) => typeof n.props.children === 'string')
    .map((n) => n.props.children as string)
    .join(' ');
}

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree!;
}

it('badges the card Private, not Prompt', async () => {
  const text = shownText(
    await render(<ScheduleCard schedule={mockMedicine} canRun phoneZone="Africa/Nairobi" onOpen={jest.fn()} onSetPaused={jest.fn()} onRunNow={jest.fn()} />),
  );
  expect(text).toContain('Private');
  expect(text).not.toContain('Prompt');
});

it("names whose reminder it is on its screen, and says nothing about a webhook", async () => {
  listProfiles.mockResolvedValue([{ id: 'grace', display_name: 'Grace', avatar_emoji: '' } as Profile]);
  const text = shownText(await render(<ScheduleDetailScreen />));
  expect(text).toContain('Private reminder');
  expect(text).toContain('Only Grace sees what it says.');
  expect(text).not.toContain('webhook');
});

it('still says it is private when the names cannot be read', async () => {
  listProfiles.mockRejectedValue(new Error('offline'));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const text = shownText(await render(<ScheduleDetailScreen />));
  expect(text).toContain('Only the person who set it sees what it says.');
});
