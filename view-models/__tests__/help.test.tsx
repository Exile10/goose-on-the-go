/**
 * Help & Feedback opens the phone's mail app with a filled-in email to support, says which Pond
 * version the household runs when the Pond answers, and still writes the email when it does not.
 */

import React from 'react';
import { Linking } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/services/i18n';
import { api } from '@/services/api-client';
import { SUPPORT_EMAIL } from '@/constants/app';
import { useHelp, type UseHelp } from '@/view-models/use-help';

jest.mock('expo-device', () => ({ modelName: 'Pixel 9', osName: 'Android', osVersion: '16' }));
jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return { ...actual, api: { systemInfo: jest.fn() } };
});
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: true }) }));

const pond = jest.mocked(api);

async function render(): Promise<{ help: () => UseHelp; tree: ReactTestRenderer }> {
  let latest!: UseHelp;
  const Probe = () => {
    latest = useHelp();
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
  });
  return { help: () => latest, tree };
}

/** The email the mail app was asked to open, read back out of its link. */
function opened(): { to: string; subject: string | null; body: string } {
  const url = new URL(jest.mocked(Linking.openURL).mock.calls[0][0]);
  return { to: url.pathname, subject: url.searchParams.get('subject'), body: url.searchParams.get('body') ?? '' };
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

describe('writing to support', () => {
  it('reports a problem to support with the app, phone and Pond versions', async () => {
    pond.systemInfo.mockResolvedValue({ hostname: 'pond', version: '2.3.1' });
    const { help, tree } = await render();
    await act(() => help().actions.write('problem'));

    const mail = opened();
    expect(mail.to).toBe(SUPPORT_EMAIL);
    expect(mail.subject).toBe('A problem with Goose On The Go');
    expect(mail.body).toContain('Phone: Pixel 9');
    expect(mail.body).toContain('System: Android 16');
    expect(mail.body).toContain('Pond version: 2.3.1');
    expect(help().mailFailed).toBe(false);
    await act(async () => tree.unmount());
  });

  it('still writes the email when the Pond cannot be reached', async () => {
    pond.systemInfo.mockRejectedValue(new Error('unreachable'));
    const { help, tree } = await render();
    await act(() => help().actions.write('feedback'));

    const mail = opened();
    expect(mail.subject).toBe('Feedback on Goose On The Go');
    expect(mail.body).toContain('Pond version: Not known');
    await act(async () => tree.unmount());
  });

  it('says so when the phone has no mail app to open', async () => {
    pond.systemInfo.mockResolvedValue({ hostname: 'pond' });
    jest.mocked(Linking.openURL).mockRejectedValue(new Error('no handler'));
    const { help, tree } = await render();
    await act(() => help().actions.write('problem'));

    expect(help().mailFailed).toBe(true);
    await act(async () => tree.unmount());
  });
});
