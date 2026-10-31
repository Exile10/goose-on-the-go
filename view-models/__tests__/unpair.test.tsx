/**
 * Unpairing from a Pond that may not answer: the Pond is always asked first, a failure is sorted
 * into "nothing answered" or "the Pond said no", and forgetting the Pond on this phone alone
 * happens only when the user chose it, never as a quiet fallback.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import i18n from '@/services/i18n';
import { ApiError } from '@/services/api-client';
import { PondTrustError } from '@/services/pond-trust';
import type { ChoiceRequest, ConfirmRequest } from '@/providers/confirm-provider';
import { classifyUnpairFailure, useUnpair, type UseUnpair } from '@/view-models/use-unpair';

jest.mock('@/services/pond-trust', () => ({
  PondTrustError: class PondTrustError extends Error {},
}));

const mockServer = {
  unpair: jest.fn<Promise<void>, []>(),
  forgetLocally: jest.fn<Promise<void>, []>(),
};
jest.mock('@/providers/server-provider', () => ({
  useServer: () => mockServer,
}));

const mockConfirm = jest.fn<Promise<boolean>, [ConfirmRequest]>();
const mockChoose = jest.fn<Promise<unknown>, [ChoiceRequest<unknown>]>();
jest.mock('@/providers/confirm-provider', () => ({
  useConfirm: () => mockConfirm,
  useChoice: () => mockChoose,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = i18n.t as unknown as (key: string) => string;

async function mount(): Promise<{ tree: ReactTestRenderer; hook: () => UseUnpair }> {
  let latest!: UseUnpair;
  const Probe = () => {
    latest = useUnpair();
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  return { tree, hook: () => latest };
}

async function run(): Promise<UseUnpair> {
  const { tree, hook } = await mount();
  await act(async () => {
    await hook().start();
  });
  const after = hook();
  await act(async () => tree.unmount());
  return after;
}

let warn: jest.SpyInstance;
let info: jest.SpyInstance;
let error: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockConfirm.mockResolvedValue(true);
  mockServer.unpair.mockResolvedValue(undefined);
  mockServer.forgetLocally.mockResolvedValue(undefined);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  info.mockRestore();
  error.mockRestore();
});

describe('classifyUnpairFailure', () => {
  it('reads an answer from the Pond as a refusal', () => {
    expect(classifyUnpairFailure(new ApiError('failed', 500, null))).toBe('refused');
    expect(classifyUnpairFailure(new ApiError('not acknowledged', 200, null))).toBe('refused');
  });

  it('reads a network failure, a timeout or a different machine at the address as unreachable', () => {
    expect(classifyUnpairFailure(new TypeError('Network request failed'))).toBe('unreachable');
    expect(classifyUnpairFailure(new DOMException('timed out', 'TimeoutError'))).toBe('unreachable');
    expect(classifyUnpairFailure(new PondTrustError())).toBe('unreachable');
  });
});

describe('useUnpair', () => {
  it('asks nothing more when the Pond releases the phone', async () => {
    const after = await run();

    expect(mockServer.unpair).toHaveBeenCalledTimes(1);
    expect(mockChoose).not.toHaveBeenCalled();
    expect(mockServer.forgetLocally).not.toHaveBeenCalled();
    expect(after.unpairing).toBe(false);
  });

  it('does nothing when the first question is declined', async () => {
    mockConfirm.mockResolvedValue(false);
    await run();

    expect(mockServer.unpair).not.toHaveBeenCalled();
    expect(mockServer.forgetLocally).not.toHaveBeenCalled();
  });

  // The provider forgets the phone itself on a 401 or 403 and resolves, so an auth refusal reaches
  // the view-model as a success: no second question about something already done.
  it('treats a Pond that already dropped the session as released', async () => {
    mockServer.unpair.mockResolvedValue(undefined);
    await run();

    expect(mockChoose).not.toHaveBeenCalled();
    expect(mockServer.forgetLocally).not.toHaveBeenCalled();
  });

  it('offers removal from this phone, and says the Pond keeps listing it, when the Pond does not answer', async () => {
    mockServer.unpair.mockRejectedValue(new TypeError('Network request failed'));
    mockChoose.mockResolvedValue('forget');
    await run();

    expect(mockChoose).toHaveBeenCalledTimes(1);
    const asked = mockChoose.mock.calls[0][0];
    expect(asked.title).toBe(t('profile.unpairUnreachableTitle'));
    expect(asked.message).toBe(t('profile.unpairUnreachableBody'));
    expect(asked.message).toMatch(/dashboard/);
    expect(asked.options.map((o) => o.label)).toEqual([t('profile.removeFromPhone'), t('common.retry')]);
    expect(asked.options[0].destructive).toBe(true);
    expect(mockServer.forgetLocally).toHaveBeenCalledTimes(1);
  });

  it('keeps the pairing when the offer is cancelled', async () => {
    mockServer.unpair.mockRejectedValue(new TypeError('Network request failed'));
    mockChoose.mockResolvedValue(null);
    const after = await run();

    expect(mockServer.forgetLocally).not.toHaveBeenCalled();
    expect(after.unpairing).toBe(false);
  });

  it('asks the Pond again on Try again, and stops once it answers', async () => {
    mockServer.unpair.mockRejectedValueOnce(new TypeError('Network request failed')).mockResolvedValueOnce(undefined);
    mockChoose.mockResolvedValue('release');
    await run();

    expect(mockServer.unpair).toHaveBeenCalledTimes(2);
    expect(mockChoose).toHaveBeenCalledTimes(1);
    expect(mockServer.forgetLocally).not.toHaveBeenCalled();
  });

  it('says the Pond answered, in its own words, when it would not release the phone', async () => {
    mockServer.unpair.mockRejectedValue(new ApiError('Pond revocation failed', 503, null));
    mockChoose.mockResolvedValue('forget');
    await run();

    const asked = mockChoose.mock.calls[0][0];
    expect(asked.title).toBe(t('profile.unpairRefusedTitle'));
    expect(asked.message).toBe(t('profile.unpairRefusedBody'));
    expect(mockServer.forgetLocally).toHaveBeenCalledTimes(1);
  });

  it('says so, and lets it be tried again, when this phone cannot clear its own copy', async () => {
    mockServer.unpair.mockRejectedValue(new TypeError('Network request failed'));
    mockServer.forgetLocally.mockRejectedValueOnce(new Error('keychain')).mockResolvedValueOnce(undefined);
    mockChoose.mockResolvedValueOnce('forget').mockResolvedValueOnce(true);
    await run();

    expect(mockChoose.mock.calls[1][0].title).toBe(t('profile.removeFailedTitle'));
    expect(mockServer.forgetLocally).toHaveBeenCalledTimes(2);
  });

  it('never rejects, so a tap cannot raise an unhandled rejection', async () => {
    mockServer.unpair.mockRejectedValue(new TypeError('Network request failed'));
    mockServer.forgetLocally.mockRejectedValue(new Error('keychain'));
    mockChoose.mockResolvedValueOnce('forget').mockResolvedValueOnce(null);
    const { tree, hook } = await mount();
    await act(async () => {
      await expect(hook().start()).resolves.toBeUndefined();
    });
    expect(hook().unpairing).toBe(false);
    await act(async () => tree.unmount());
  });
});
