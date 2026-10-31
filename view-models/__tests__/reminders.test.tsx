/**
 * The Reminders view-model: what a reminder becomes on screen, what an empty or failed read
 * leaves, and what a dismissal calls, re-reads and reports.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import { currentSnackbar, resetSnackbar } from '@/services/snackbar';
import type { Reminder } from '@/services/types';
import { toReminderRow, useReminders, type UseReminders } from '@/view-models/use-reminders';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { listReminders: jest.fn(), dismissReminder: jest.fn() } };
});
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true }) }));

// The poll is `use-live.test.ts`'s business; here it is one read on mount.
jest.mock('../use-live', () => ({
  useLive: (read: () => Promise<unknown>, _delay: unknown, enabled = true) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => {
      if (enabled) void read();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);
  },
}));

const pond = jest.mocked(api);

function reminder(over: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r1',
    about: 'Dentist appointment',
    when_said: 'next Tuesday',
    subject: 'Amina',
    profile_id: 'p1',
    said_at: '2026-10-18T09:00:00+00:00',
    captured_at: '2026-10-18T10:00:00+00:00',
    disposition: 'pending',
    session_id: 's1',
    window_id: 'w1',
    ...over,
  };
}

interface Mounted {
  readonly vm: UseReminders;
  unmount: () => Promise<void>;
}

async function mount(): Promise<Mounted> {
  let latest!: UseReminders;
  const Probe = () => {
    latest = useReminders();
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  return {
    get vm() {
      return latest;
    },
    unmount: async () => {
      await act(async () => tree.unmount());
    },
  };
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  resetSnackbar();
  jest.resetAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  pond.listReminders.mockResolvedValue([]);
  pond.dismissReminder.mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('toReminderRow', () => {
  it('shows the words said about when, never a date parsed out of them', () => {
    const row = toReminderRow(reminder({ about: '  Dentist  ', when_said: ' next Tuesday ' }), new Date('2026-10-19T12:00:00Z'));

    expect(row).toEqual({ id: 'r1', text: 'Dentist', due: 'next Tuesday', said: expect.any(String) });
    expect(row.said).not.toBe('');
  });

  it('says there was no time when the conversation gave none', () => {
    expect(toReminderRow(reminder({ when_said: '   ' }), new Date()).due).toBeNull();
  });
});

describe('the list', () => {
  it('maps what the Pond sends, in the order it sends it', async () => {
    pond.listReminders.mockResolvedValue([reminder(), reminder({ id: 'r2', about: 'Pay rent', when_said: 'on the first' })]);
    const m = await mount();

    expect(m.vm.loading).toBe(false);
    expect(m.vm.data.rows.map((r) => [r.id, r.text, r.due])).toEqual([
      ['r1', 'Dentist appointment', 'next Tuesday'],
      ['r2', 'Pay rent', 'on the first'],
    ]);
    await m.unmount();
  });

  it('is empty, not failed, when the Pond has nothing waiting', async () => {
    const m = await mount();

    expect(m.vm.data.rows).toEqual([]);
    expect(m.vm.failed).toBe(false);
    expect(m.vm.error).toBeNull();
    await m.unmount();
  });

  it('marks a first read that failed, so an empty list is not shown as a quiet one', async () => {
    pond.listReminders.mockRejectedValue(new ApiError('GET /api/v1/reminders → 500', 500, null));
    const m = await mount();

    expect(m.vm.failed).toBe(true);
    expect(m.vm.error).not.toBeNull();
    expect(m.vm.data.rows).toEqual([]);
    await m.unmount();
  });
});

describe('dismissing', () => {
  it('dismisses by id and reads the list again', async () => {
    pond.listReminders.mockResolvedValueOnce([reminder()]).mockResolvedValueOnce([]);
    const m = await mount();

    await act(async () => m.vm.actions.dismiss('r1'));

    expect(pond.dismissReminder).toHaveBeenCalledWith('r1');
    expect(pond.listReminders).toHaveBeenCalledTimes(2);
    expect(m.vm.data.rows).toEqual([]);
    expect(currentSnackbar()).toBeNull();
    expect(m.vm.dismissing).toBeNull();
    await m.unmount();
  });

  it('says a reminder was already gone when the Pond answers 404, and still refreshes', async () => {
    pond.listReminders.mockResolvedValueOnce([reminder()]).mockResolvedValueOnce([]);
    pond.dismissReminder.mockRejectedValue(new ApiError('POST → 404', 404, null));
    const m = await mount();

    await act(async () => m.vm.actions.dismiss('r1'));

    expect(currentSnackbar()).toMatchObject({ tone: 'neutral', message: 'That reminder was already gone, so the list has been refreshed.' });
    expect(currentSnackbar()?.action).toBeUndefined();
    expect(pond.listReminders).toHaveBeenCalledTimes(2);
    expect(m.vm.data.rows).toEqual([]);
    await m.unmount();
  });

  it('shows a failure even when the shared reading has nothing to add', async () => {
    pond.listReminders.mockResolvedValue([reminder()]);
    pond.dismissReminder.mockRejectedValue(new TypeError('Network request failed'));
    const m = await mount();

    await act(async () => m.vm.actions.dismiss('r1'));

    expect(currentSnackbar()).toMatchObject({ tone: 'danger', message: 'Could not dismiss that reminder.' });
    expect(m.vm.data.rows.map((r) => r.id)).toEqual(['r1']);

    pond.dismissReminder.mockResolvedValue();
    await act(async () => currentSnackbar()?.action?.onPress());
    expect(pond.dismissReminder).toHaveBeenCalledTimes(2);
    await m.unmount();
  });
});
