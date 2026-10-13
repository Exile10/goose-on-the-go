jest.mock('../api-client', () => ({ api: { requestLocal: jest.fn() } }));
import i18n from '../i18n';
import { AppState, NativeModules } from 'react-native';
import { api } from '../api-client';
import { enableRemoteAccess, cancelRemoteAccess, machineKeyPreview, remoteNodeRunning, restoreRemoteAccess, resumeRemoteAccess } from '../remote-access';
const local = 'https://192.168.1.2:4443';
const control = 'https://coord.example';
const pending = JSON.stringify({ state: 'NeedsLogin', machineKey: 'mkey:' + 'b'.repeat(64), authUrl: `${control}/register/pending-registration`, addresses: [] });
const running = JSON.stringify({ state: 'Running', addresses: ['100.64.0.2'] });
let bridge: Record<string, jest.Mock>;
beforeEach(() => {
  jest.useFakeTimers(); Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  bridge = { beginRemote: jest.fn(async () => pending), remoteStatus: jest.fn(async () => running), cancelRemote: jest.fn(async () => undefined), activateRemote: jest.fn(async () => undefined) };
  NativeModules.PondTls = bridge;
  jest.mocked(api.requestLocal).mockReset();
  jest.mocked(api.requestLocal).mockImplementation(async (_endpoint, path) => path.endsWith('/configuration') ? { enabled: true, controlUrl: control } : path.endsWith('/info') ? { tailnet_address: '100.64.0.1', https_port: 4443 } : {});
});
afterEach(() => jest.useRealTimers());
it('makes no native coordination contact without local approval', async () => {
  jest.mocked(api.requestLocal).mockResolvedValueOnce({ enabled: false, controlUrl: control });
  await expect(enableRemoteAccess('profile', local, jest.fn(), jest.fn())).rejects.toThrow(i18n.t('remote.approval'));
  expect(bridge.beginRemote).not.toHaveBeenCalled();
});
it('explains missing infrastructure without requesting approval or contacting a coordinator', async () => {
  jest.mocked(api.requestLocal).mockResolvedValueOnce({ enabled: false, controlUrl: '' });
  const progress = jest.fn();
  await expect(enableRemoteAccess('profile', local, progress, jest.fn())).rejects.toThrow(i18n.t('remote.unconfigured'));
  expect(progress).not.toHaveBeenCalled();
  expect(bridge.beginRemote).not.toHaveBeenCalled();
});
it('refuses remote pairing addresses before any request', async () => {
  await expect(enableRemoteAccess('profile', 'https://100.64.0.1:4443', jest.fn(), jest.fn())).rejects.toThrow();
  expect(api.requestLocal).not.toHaveBeenCalled(); expect(bridge.beginRemote).not.toHaveBeenCalled();
});
it('submits registration once and commits only a pinned-Pond supplied address', async () => {
  const commit = jest.fn(async () => undefined);
  const result = enableRemoteAccess('profile', local, jest.fn(), commit);
  await jest.advanceTimersByTimeAsync(1000); await result;
  expect(bridge.beginRemote).toHaveBeenCalledWith('profile', control);
  expect(jest.mocked(api.requestLocal).mock.calls.every(([endpoint]) => endpoint === local)).toBe(true);
  expect(jest.mocked(api.requestLocal).mock.calls.filter(([_endpoint, path]) => path.endsWith('/enrollment'))).toHaveLength(1);
  expect(commit).toHaveBeenCalledWith('https://100.64.0.1:4443', control, expect.any(Function));
});
it('never retries an ambiguous enrollment write or changes the saved profile', async () => {
  jest.mocked(api.requestLocal).mockResolvedValueOnce({ enabled: true, controlUrl: control }).mockRejectedValueOnce(new Error('connection lost'));
  const commit = jest.fn();
  await expect(enableRemoteAccess('profile', local, jest.fn(), commit)).rejects.toThrow('connection lost');
  expect(commit).not.toHaveBeenCalled(); expect(bridge.cancelRemote).toHaveBeenCalled();
  expect(jest.mocked(api.requestLocal).mock.calls.filter(([_endpoint, path]) => path.endsWith('/enrollment'))).toHaveLength(1);
});
it('rejects a stale enrollment result after cancellation', async () => {
  let finish!: (value: string) => void;
  bridge.beginRemote.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
  const commit = jest.fn();
  const result = enableRemoteAccess('profile', local, jest.fn(), commit);
  const rejected = expect(result).rejects.toThrow();
  await Promise.resolve(); await Promise.resolve(); await cancelRemoteAccess(); finish(running);
  await rejected; expect(commit).not.toHaveBeenCalled();
});
it('restores only the saved profile transport before use, and stops for local-only', async () => {
  await restoreRemoteAccess('saved', control); await restoreRemoteAccess('saved', '');
  expect(bridge.activateRemote.mock.calls).toEqual([['saved', control], ['saved', '']]);
});

// The node runs in the app process, so returning to the foreground is the first moment
// the app can learn that the OS took it away. Before this, nothing asked: the resume path
// re-probed HTTP endpoints, which cannot tell a dead node from an unreachable Pond.
it('restarts the embedded node when it did not survive the background', async () => {
  bridge.remoteStatus.mockResolvedValueOnce(JSON.stringify({ state: 'Stopped', addresses: [] }));
  await expect(resumeRemoteAccess('saved', control)).resolves.toBe(true);
  expect(bridge.activateRemote.mock.calls).toEqual([['saved', control]]);
});
it('leaves a node that survived the background alone', async () => {
  await expect(resumeRemoteAccess('saved', control)).resolves.toBe(false);
  expect(bridge.activateRemote).not.toHaveBeenCalled();
});
it('asks nothing of the bridge for a local-only profile', async () => {
  await expect(resumeRemoteAccess('saved', '')).resolves.toBe(false);
  expect(bridge.remoteStatus).not.toHaveBeenCalled();
  expect(bridge.activateRemote).not.toHaveBeenCalled();
});
// An unreadable status is not evidence the node is healthy, and the cost of being wrong
// is asymmetric: a needless restart costs a moment, a missed one costs remote access.
it('restarts when the node status cannot be read', async () => {
  bridge.remoteStatus.mockRejectedValueOnce(new Error('bridge gone'));
  await expect(resumeRemoteAccess('saved', control)).resolves.toBe(true);
  expect(bridge.activateRemote.mock.calls).toEqual([['saved', control]]);
});

it('requires an explicit recovery request, waits for local approval and executes once', async () => {
  const id = '11111111-2222-3333-4444-555555555555';
  jest.mocked(api.requestLocal).mockImplementation(async (_endpoint, path, init) => {
    if (path.endsWith('/configuration')) return { enabled: true, controlUrl: control };
    if (path.endsWith('/info')) return { tailnet_address: '100.64.0.1', https_port: 4443 };
    if (path.endsWith('/recovery')) return { id };
    if (path.endsWith(id) && !init?.method) return { approved: true };
    return {};
  });
  const commit = jest.fn(async () => undefined), onReview = jest.fn();
  const result = enableRemoteAccess('new-local-profile', local, jest.fn(), commit, { onReview });
  await jest.advanceTimersByTimeAsync(1000); await result;
  // The native node's own key, as the Pond's review will show it.
  expect(onReview).toHaveBeenCalledWith(id, 'mkey:bbbb bbbb bbbb bbbb');
  expect(commit).toHaveBeenCalledTimes(1);
  expect(jest.mocked(api.requestLocal).mock.calls.filter(([, path, init]) => path.endsWith(id) && init?.method === 'POST')).toHaveLength(1);
  expect(jest.mocked(api.requestLocal).mock.calls.some(([, path]) => path.endsWith('/enrollment'))).toBe(false);
});
it('cancels an unapproved recovery without registration or profile changes', async () => {
  const id = '11111111-2222-3333-4444-555555555555';
  jest.mocked(api.requestLocal).mockImplementation(async (_endpoint, path) => {
    if (path.endsWith('/configuration')) return { enabled: true, controlUrl: control };
    if (path.endsWith('/recovery')) return { id };
    return { approved: false };
  });
  const commit = jest.fn();
  const result = enableRemoteAccess('new-local-profile', local, jest.fn(), commit, { onReview: jest.fn() });
  const rejected = expect(result).rejects.toThrow();
  await jest.advanceTimersByTimeAsync(1);
  await cancelRemoteAccess();
  await jest.advanceTimersByTimeAsync(5000); await rejected;
  expect(commit).not.toHaveBeenCalled();
  expect(jest.mocked(api.requestLocal).mock.calls.some(([, path, init]) => path.endsWith(id) && init?.method === 'DELETE')).toBe(true);
  expect(jest.mocked(api.requestLocal).mock.calls.some(([, path, init]) => path.endsWith(id) && init?.method === 'POST')).toBe(false);
});
it('never replays an ambiguous replacement and preserves the saved profile', async () => {
  const id = '11111111-2222-3333-4444-555555555555';
  jest.mocked(api.requestLocal).mockImplementation(async (_endpoint, path, init) => {
    if (path.endsWith('/configuration')) return { enabled: true, controlUrl: control };
    if (path.endsWith('/recovery')) return { id };
    if (path.endsWith(id) && init?.method === 'POST') throw new Error('replacement response lost');
    return { approved: true };
  });
  const commit = jest.fn();
  await expect(enableRemoteAccess('new-local-profile', local, jest.fn(), commit, { onReview: jest.fn() })).rejects.toThrow('replacement response lost');
  expect(commit).not.toHaveBeenCalled();
  expect(jest.mocked(api.requestLocal).mock.calls.filter(([, path, init]) => path.endsWith(id) && init?.method === 'POST')).toHaveLength(1);
});

it('waits for the node to start before a tailnet probe, and no longer than its budget', async () => {
  const starting = JSON.stringify({ state: 'Starting', addresses: [] });
  bridge.remoteStatus.mockResolvedValueOnce(starting).mockRejectedValueOnce(new Error('not yet')).mockResolvedValueOnce(running);
  const ready = remoteNodeRunning(() => false);
  await jest.advanceTimersByTimeAsync(500);
  await expect(ready).resolves.toBe(true);
  expect(bridge.remoteStatus).toHaveBeenCalledTimes(3);

  bridge.remoteStatus.mockResolvedValue(starting);
  const never = remoteNodeRunning(() => false);
  await jest.advanceTimersByTimeAsync(10_250);
  await expect(never).resolves.toBe(false);
});

it('stops waiting for the node once the answer is no longer wanted', async () => {
  bridge.remoteStatus.mockResolvedValue(JSON.stringify({ state: 'Starting', addresses: [] }));
  let abandoned = false;
  const ready = remoteNodeRunning(() => abandoned);
  await jest.advanceTimersByTimeAsync(250);
  abandoned = true;
  await jest.advanceTimersByTimeAsync(250);
  await expect(ready).resolves.toBe(false);
});

it('shows the same start of the machine key as the Pond\'s review', () => {
  expect(machineKeyPreview(`mkey:0123456789abcdef${'0'.repeat(48)}`)).toBe('mkey:0123 4567 89ab cdef');
  expect(machineKeyPreview('')).toBe('mkey:');
});
