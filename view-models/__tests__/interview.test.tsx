/**
 * The interview's view-models against the Pond's member routes. Pinned: another member's phone and an
 * older Pond see no interview rather than an error, a yes already said in the conversation is not a
 * failure, a draft opens in its own session without starting again, and an offer put away stays away.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ApiError, api } from '@/services/api-client';
import type { ProfileInterview } from '@/services/types';
import { useInterview, type UseInterview } from '@/view-models/use-interview';
import { useInterviewOffer, type UseInterviewOffer } from '@/view-models/use-interview-offer';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect: run } = jest.requireActual('react');
    run(effect, [effect]);
  },
}));
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true, paired: true }) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: { deviceSelf: jest.fn(), interview: jest.fn(), startInterview: jest.fn(), approveInterview: jest.fn() },
  };
});

const pond = jest.mocked(api);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const interview = (change: Partial<ProfileInterview> = {}): ProfileInterview => ({
  profileId: 'amina',
  status: 'in_progress',
  sessionId: 's-1',
  topics: [{ id: 'food', label: 'Food', status: 'answered' }],
  draft: [],
  ...change,
});

async function mount<T>(hook: () => T) {
  let latest!: T;
  const Probe = () => {
    latest = hook();
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
    unmount: () => act(() => tree.unmount()),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  pond.deviceSelf.mockResolvedValue({ device_id: 'd-1', profile: { id: 'amina', display_name: 'Amina' } });
  pond.interview.mockResolvedValue(interview());
});

describe('useInterview', () => {
  it('reads the interview of the member this phone belongs to', async () => {
    const m = await mount<UseInterview>(() => useInterview());
    expect(pond.interview).toHaveBeenCalledWith('amina');
    expect(m.vm.data.interview?.status).toBe('in_progress');
    m.unmount();
  });

  it('shows no interview, and no error, to another member’s phone or an older Pond', async () => {
    pond.interview.mockRejectedValue(new ApiError('GET → 403', 403, null));
    const m = await mount<UseInterview>(() => useInterview());
    expect(m.vm.data.interview).toBeNull();
    expect(m.vm.error).toBeNull();
    m.unmount();
  });

  it('asks nothing for a phone that belongs to nobody', async () => {
    pond.deviceSelf.mockResolvedValue({ device_id: 'd-1', profile: null });
    const m = await mount<UseInterview>(() => useInterview());
    expect(pond.interview).not.toHaveBeenCalled();
    expect(m.vm.data.interview).toBeNull();
    m.unmount();
  });

  it('reads nothing while disabled', async () => {
    const m = await mount<UseInterview>(() => useInterview('amina', false));
    expect(pond.deviceSelf).not.toHaveBeenCalled();
    expect(pond.interview).not.toHaveBeenCalled();
    m.unmount();
  });

  it('takes a draft already saved by a yes in the conversation as saved, and reads it again', async () => {
    pond.approveInterview.mockRejectedValue(new ApiError('POST → 409', 409, null, null, { code: 'no_draft' }));
    const m = await mount<UseInterview>(() => useInterview('amina'));
    pond.interview.mockResolvedValue(interview({ status: 'done' }));
    let saved: string[] | null = null;
    await act(async () => {
      saved = await m.vm.actions.approve();
    });
    expect(saved).toEqual([]);
    expect(m.vm.data.interview?.status).toBe('done');
    expect(m.vm.error).toBeNull();
    m.unmount();
  });

  it('says why when the save itself fails', async () => {
    pond.approveInterview.mockRejectedValue(new ApiError('POST → 500', 500, null));
    const m = await mount<UseInterview>(() => useInterview('amina'));
    let saved: string[] | null = [];
    await act(async () => {
      saved = await m.vm.actions.approve();
    });
    expect(saved).toBeNull();
    m.unmount();
  });
});

describe('useInterviewOffer', () => {
  it('starts or takes up the interview and opens its conversation', async () => {
    pond.startInterview.mockResolvedValue(interview({ sessionId: 's-2' }));
    const m = await mount<UseInterviewOffer>(() => useInterviewOffer());
    expect(m.vm.invite).toBe('resume');
    await act(async () => m.vm.actions.open());
    expect(pond.startInterview).toHaveBeenCalledWith('amina');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/conversation', params: { session: 's-2', interview: 'amina' } });
    m.unmount();
  });

  it('opens a waiting draft in its own session without starting again', async () => {
    pond.interview.mockResolvedValue(interview({ status: 'awaiting_approval', sessionId: 's-1' }));
    const m = await mount<UseInterviewOffer>(() => useInterviewOffer());
    expect(m.vm.invite).toBe('review');
    await act(async () => m.vm.actions.open());
    expect(pond.startInterview).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/conversation', params: { session: 's-1', interview: 'amina' } });
    m.unmount();
  });

  it('stays put away for that member once dismissed', async () => {
    const m = await mount<UseInterviewOffer>(() => useInterviewOffer());
    await act(async () => m.vm.actions.dismiss());
    expect(m.vm.invite).toBeNull();
    m.unmount();
    const again = await mount<UseInterviewOffer>(() => useInterviewOffer());
    expect(again.vm.invite).toBeNull();
    again.unmount();
  });

  it('offers nothing once the interview is done', async () => {
    pond.interview.mockResolvedValue(interview({ status: 'done' }));
    const m = await mount<UseInterviewOffer>(() => useInterviewOffer());
    expect(m.vm.invite).toBeNull();
    m.unmount();
  });
});
