/**
 * What the background connection's ongoing notification says, and that it follows the stream.
 *
 * The notice used to read "Connected to your Pond" from the moment the service started, with
 * no Pond anywhere in reach (A57, 2026-10-27). It now follows the stream: connecting until the
 * Pond accepts it, connected while it does, unreachable once it drops.
 */
import { NativeModules, Platform } from 'react-native';

import i18n from '@/services/i18n';
import type { NotificationStream } from '@/services/notification-stream';

// Hoisted above the imports: keeps expo-notifications, and its Expo Go warning, out of the test.
jest.mock('@/services/local-notifications', () => ({ presentLocally: jest.fn() }));

/** The options the module handed the last stream it opened. */
type StreamOptions = ConstructorParameters<typeof NotificationStream>[0];
const opened: StreamOptions[] = [];
jest.mock('@/services/notification-stream', () => ({
  NotificationStream: class {
    constructor(opts: StreamOptions) { opened.push(opts); }
    start() {}
    stop() {}
  },
  NotificationDeduplicator: class { accept() { return true; } },
}));

const presence = {
  start: jest.fn().mockResolvedValue(true),
  update: jest.fn().mockResolvedValue(true),
  stop: jest.fn().mockResolvedValue(true),
};

type Module = typeof import('@/services/background-connection');
let connection: Module;

const t = i18n.t as unknown as (key: string) => string;
const target = { baseUrl: 'https://pond.local:4443', token: 'session', deviceId: 'phone' };
const last = () => opened[opened.length - 1];

beforeEach(() => {
  opened.length = 0;
  jest.clearAllMocks();
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.replaceProperty(Platform, 'OS', 'android');
  NativeModules.PondPresence = presence;
  // A fresh module per test: the link state is module-level, as it has to be to outlive React.
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    connection = require('@/services/background-connection');
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  delete NativeModules.PondPresence;
});

describe('presenceNotice', () => {
  it('gives every state its own title, all present in the catalogue', () => {
    const states = ['connecting', 'connected', 'unreachable'] as const;
    const titles = states.map((state) => connection.presenceNotice(state).title);
    expect(new Set(titles).size).toBe(states.length);
    for (const state of states) {
      const { title, body } = connection.presenceNotice(state);
      expect(title).not.toMatch(/^notifications\./);
      expect(body).not.toMatch(/^notifications\./);
    }
  });

  it('promises prompt delivery only while connected', () => {
    expect(connection.presenceNotice('connected').body).toBe(t('notifications.background.connected.body'));
    expect(connection.presenceNotice('connected').body).toContain('straight away');
    expect(connection.presenceNotice('connecting').body).not.toContain('straight away');
    expect(connection.presenceNotice('unreachable').body).not.toContain('straight away');
  });

  it('never says connected unless it is', () => {
    expect(connection.presenceNotice('connecting').title).not.toBe(t('notifications.background.connected.title'));
    expect(connection.presenceNotice('unreachable').title).not.toBe(t('notifications.background.connected.title'));
  });
});

describe('the notice follows the stream', () => {
  it('starts the service saying connecting, not connected', async () => {
    await connection.startPresenceService();
    expect(presence.start).toHaveBeenCalledWith(
      t('notifications.background.connecting.title'),
      t('notifications.background.connecting.body'),
      t('notifications.background.channel'),
      t('notifications.background.channelDescription'),
    );
  });

  it('moves through connecting, connected and unreachable as the stream does', async () => {
    await connection.startPresenceService();
    connection.connectLink(target);
    expect(connection.presenceState()).toBe('connecting');

    last().onConnect?.();
    expect(connection.presenceState()).toBe('connected');
    expect(presence.update).toHaveBeenLastCalledWith(
      t('notifications.background.connected.title'),
      t('notifications.background.connected.body'),
      t('notifications.background.channel'),
      t('notifications.background.channelDescription'),
    );

    last().onDisconnect?.();
    expect(connection.presenceState()).toBe('unreachable');
    expect(presence.update).toHaveBeenLastCalledWith(
      t('notifications.background.unreachable.title'),
      t('notifications.background.unreachable.body'),
      expect.any(String),
      expect.any(String),
    );
  });

  it('re-posts only on a change, so a stream that keeps failing does not keep notifying', async () => {
    await connection.startPresenceService();
    connection.connectLink(target);
    last().onDisconnect?.();
    last().onDisconnect?.();
    last().onDisconnect?.();
    expect(presence.update).toHaveBeenCalledTimes(1);
  });

  it('updates nothing while the service is not running', () => {
    connection.connectLink(target);
    last().onConnect?.();
    expect(connection.presenceState()).toBe('connected');
    expect(presence.update).not.toHaveBeenCalled();
  });

  it('ignores a replaced stream reporting late', async () => {
    await connection.startPresenceService();
    connection.connectLink(target);
    const replaced = last();
    connection.connectLink({ ...target, token: 'rotated' });
    replaced.onConnect?.();
    expect(connection.presenceState()).toBe('connecting');
    replaced.onDisconnect?.();
    expect(connection.presenceState()).toBe('connecting');
  });

  it('keeps saying connected while a stream that was up is replaced', () => {
    connection.connectLink(target);
    last().onConnect?.();
    connection.connectLink({ ...target, token: 'rotated' });
    expect(connection.presenceState()).toBe('connected');
  });

  it('hears from the connection manager when there is no stream to report', () => {
    connection.noteNoEndpoint(false);
    expect(connection.presenceState()).toBe('unreachable');
    connection.noteNoEndpoint(true);
    expect(connection.presenceState()).toBe('connecting');
  });

  it('lets an open stream speak for itself when the endpoint goes', () => {
    connection.connectLink(target);
    last().onConnect?.();
    connection.noteNoEndpoint(false);
    expect(connection.presenceState()).toBe('connected');
    last().onDisconnect?.();
    expect(connection.presenceState()).toBe('unreachable');
  });
});
