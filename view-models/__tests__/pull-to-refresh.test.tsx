/**
 * The pull every Pond screen refreshes with: it looks for the Pond first when the connection strip
 * says another attempt can help, reads the screen again either way, and always lets the spinner go.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { ConnectionState } from '@/models/connection';
import {
  PullSectionsProvider,
  usePullSections,
  usePullToRefresh,
  useReloadOnPull,
  type PullSections,
  type PullToRefresh,
} from '@/view-models/use-pull-to-refresh';

const mockServer: { hydrated: boolean; connectionState: ConnectionState; recover: jest.Mock } = {
  hydrated: true,
  connectionState: 'local',
  recover: jest.fn(),
};
jest.mock('@/providers/server-provider', () => ({
  useServer: () => mockServer,
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mounted: ReactTestRenderer[] = [];

async function mount(reload: () => unknown): Promise<{ readonly pull: PullToRefresh }> {
  let latest!: PullToRefresh;
  const Probe = () => {
    latest = usePullToRefresh(reload);
    return null;
  };
  await act(async () => {
    mounted.push(create(<Probe />));
  });
  return {
    get pull() {
      return latest;
    },
  };
}

beforeEach(() => {
  mockServer.hydrated = true;
  mockServer.connectionState = 'local';
  mockServer.recover = jest.fn().mockResolvedValue('https://pond.local:4443');
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
  jest.restoreAllMocks();
});

describe('usePullToRefresh', () => {
  it('only reads the screen again while the Pond is reachable', async () => {
    const reload = jest.fn().mockResolvedValue(undefined);
    const m = await mount(reload);
    await act(async () => m.pull.onRefresh());
    expect(mockServer.recover).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each<ConnectionState>(['disconnected', 'reconnecting', 'trust'])(
    'looks for the Pond before reading again while the strip says %s',
    async (state) => {
      mockServer.connectionState = state;
      const order: string[] = [];
      mockServer.recover.mockImplementation(async () => {
        order.push('recover');
        return null;
      });
      const reload = jest.fn(async () => {
        order.push('reload');
      });
      const m = await mount(reload);
      await act(async () => m.pull.onRefresh());
      expect(order).toEqual(['recover', 'reload']);
    },
  );

  it.each<ConnectionState>(['unpaired', 'upgrade', 'revoked'])(
    'does not probe for a phone the Pond will not answer (%s): pairing is the action there',
    async (state) => {
      mockServer.connectionState = state;
      const reload = jest.fn();
      const m = await mount(reload);
      await act(async () => m.pull.onRefresh());
      expect(mockServer.recover).not.toHaveBeenCalled();
      expect(reload).toHaveBeenCalledTimes(1);
    },
  );

  it('does not probe before the saved pairing has loaded', async () => {
    mockServer.hydrated = false;
    mockServer.connectionState = 'disconnected';
    const m = await mount(jest.fn());
    await act(async () => m.pull.onRefresh());
    expect(mockServer.recover).not.toHaveBeenCalled();
  });

  it('holds the spinner until the reload settles, and ignores a second pull meanwhile', async () => {
    const read = deferred();
    const reload = jest.fn(() => read.promise);
    const m = await mount(reload);
    expect(m.pull.refreshing).toBe(false);

    await act(async () => m.pull.onRefresh());
    expect(m.pull.refreshing).toBe(true);
    await act(async () => m.pull.onRefresh());
    expect(reload).toHaveBeenCalledTimes(1);

    await act(async () => read.resolve());
    expect(m.pull.refreshing).toBe(false);

    // Settled, so the next pull is a new one.
    await act(async () => m.pull.onRefresh());
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('logs a reload that throws, without its text, and still lets the spinner go', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const read = deferred();
    const m = await mount(() => read.promise);
    await act(async () => m.pull.onRefresh());
    expect(m.pull.refreshing).toBe(true);

    await act(async () => read.reject(new Error('socket hang up at 10.0.0.2')));
    expect(m.pull.refreshing).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[pull-to-refresh\] refresh failed kind=/));
    expect(warn.mock.calls.join(' ')).not.toContain('10.0.0.2');
  });

  it('still reads the screen again when the connection check itself throws', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockServer.connectionState = 'disconnected';
    mockServer.recover.mockRejectedValue(new Error('probe crashed'));
    const reload = jest.fn();
    const m = await mount(reload);
    await act(async () => m.pull.onRefresh());
    expect(m.pull.refreshing).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('sections inside a scroll another component owns', () => {
  function Section({ reload }: { reload: () => unknown }) {
    useReloadOnPull(reload);
    return null;
  }

  async function mountScreen(sections: (() => unknown)[]) {
    let latest!: PullSections;
    const Screen = ({ shown }: { shown: (() => unknown)[] }) => {
      latest = usePullSections();
      return (
        <PullSectionsProvider value={latest.registry}>
          {shown.map((reload, i) => (
            <Section key={i} reload={reload} />
          ))}
        </PullSectionsProvider>
      );
    };
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<Screen shown={sections} />);
    });
    mounted.push(tree);
    return {
      get sections() {
        return latest;
      },
      show: (shown: (() => unknown)[]) => act(async () => tree.update(<Screen shown={shown} />)),
    };
  }

  it('reads every section the screen holds, and waits for all of them', async () => {
    const slow = deferred();
    const first = jest.fn(() => slow.promise);
    const second = jest.fn();
    const m = await mountScreen([first, second]);

    let settled = false;
    await act(async () => {
      void m.sections.reload().then(() => (settled = true));
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    await act(async () => slow.resolve());
    expect(settled).toBe(true);
  });

  it('forgets a section that is no longer shown, such as the other tab', async () => {
    const schedules = jest.fn();
    const automations = jest.fn();
    const m = await mountScreen([schedules]);
    await m.show([automations]);
    await act(async () => {
      await m.sections.reload();
    });
    expect(schedules).not.toHaveBeenCalled();
    expect(automations).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a section outside any screen that pulls', async () => {
    const reload = jest.fn();
    await act(async () => {
      mounted.push(create(<Section reload={reload} />));
    });
    expect(reload).not.toHaveBeenCalled();
  });
});
