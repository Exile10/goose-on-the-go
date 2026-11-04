/**
 * The devices this Pond knows about, grouped the way the screen shows them.
 *
 * Control goes through `set_device_state`, which the server exposes on the
 * LLM-free dispatch path. A device shows a new state only once the Pond has read
 * it back from the device: an optimistic switch could say a heater was off while
 * it was still on. A Matter round trip is slow enough that an unacknowledged tap
 * reads as a broken switch, so the tap is shown at once as waiting instead.
 *
 * On a Pond with a device event stream, changes arrive as they happen and the
 * full read drops to a rare check, which is most of this screen's mobile data.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api, type PondApiClient } from '@/services/api-client';
import type { Device, DeviceEvent, DeviceStatePatch, MatterStatus, Room, UpdateDeviceRequest } from '@/services/types';
import { ago } from '@/models/elapsed';
import { COMMAND_MAX_WAIT_MS, commandKey, enqueue, sortWaiting, type WaitingCommand } from './command-queue';
import { describeApiError, logFailure } from './describe-error';
import { moveIntoRoom, unassignRoom } from './rooms';
import { useLive } from './use-live';
import { useScreenActive } from './use-screen-active';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';

/**
 * Read a device's power state out of `get_device_state`'s text.
 *
 * An MCP tool result is `{content, success}` — its first consumer is a language
 * model, so prose is the channel there is. pond-desktop reads the same
 * `power:` line for the same reason (`sections/Devices.tsx::powerStateOf`).
 *
 * Returns `undefined` when the device did not report power at all, which is a
 * third state and not the same as off: a contact sensor has no power line, and
 * a switch shown as "off" for one would be inventing a fact.
 */
export function parsePowerState(content: string): boolean | undefined {
  const line = content.split('\n').find((l) => /^\s*power:/.test(l));
  if (line === undefined) return undefined;
  const value = line.slice(line.indexOf(':') + 1).trim().toLowerCase();
  if (value === 'on') return true;
  if (value === 'off') return false;
  return undefined;
}

/**
 * Devices with no room of their own still have to appear somewhere.
 *
 * An id, not a name: shown through `roomLabel`. It used to be the English word, rendered raw, which
 * also merged it with a room the household had genuinely named "Unassigned".
 */
export const UNASSIGNED_ROOM = 'room.unassigned';

/** The tab shown before any room is chosen. An id, for the same reasons. */
export const ALL_ROOMS = 'room.all';

/** One room as the screens show it: a room the household named, or Unassigned, with its devices. */
export interface DeviceRoom {
  /** The room's id, or `UNASSIGNED_ROOM`. */
  id: string;
  /** As the household named it; empty for Unassigned, which `roomLabel` names. */
  name: string;
  devices: Device[];
}

/** What a room is called on screen: the app's own buckets as copy, a household's rooms as named. */
export function roomLabel(room: Pick<DeviceRoom, 'id' | 'name'>): string {
  if (room.id === UNASSIGNED_ROOM) return i18n.t('devices.roomUnassigned');
  if (room.id === ALL_ROOMS) return i18n.t('devices.roomAll');
  return room.name;
}

/**
 * The rooms a Pond from before `/rooms` named in each device's free-text `room`, one per name, with
 * the name as its id, and the devices given that id. They can be shown but not changed: that Pond
 * has nowhere to keep a room of its own.
 */
export function legacyRooms(devices: Device[]): { rooms: Room[]; devices: Device[] } {
  const names = [...new Set(devices.map((d) => d.room?.trim()).filter((n): n is string => !!n))];
  return {
    rooms: names.map((name) => ({ id: name, name })),
    devices: devices.map((d) => (d.room?.trim() ? { ...d, room_id: d.room.trim() } : d)),
  };
}

/** Whether another room already has this name, as people read names: trimmed, any case. */
export function nameTaken(rooms: Room[], name: string, exceptId?: string): boolean {
  const wanted = name.trim().toLocaleLowerCase();
  return rooms.some((r) => r.id !== exceptId && r.name.trim().toLocaleLowerCase() === wanted);
}

/**
 * A bridged Matter endpoint, e.g. `matter-12345-3`.
 *
 * One node is not one device: a bridge exposes several endpoints under one node,
 * and `DELETE /devices/{id}` refuses them because removing one would mean
 * removing the node the others live on. The UI must not offer that delete.
 */
export function isBridgedEndpoint(id: string): boolean {
  return /^matter-\d+-\d+$/.test(id);
}

/**
 * Whether a device accepts a given verb.
 *
 * `capabilities` is the list the controller derived from the device's clusters.
 * An unmapped device arrives typed `matter` with an empty list — which means
 * show no controls, not show an error. Treating absent as "everything" is how a
 * contact sensor gets offered a power button.
 */
export function supports(device: Device, verb: string): boolean {
  return device.capabilities?.includes(verb) ?? false;
}

/**
 * Reachable devices first, then by name.
 *
 * A household accumulates devices that are unplugged, moved or replaced, and
 * they keep their catalogue row. Ordering by whatever the server returned puts
 * a dead bulb above a lamp someone is reaching for.
 */
export function byReachability(a: Device, b: Device): number {
  if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * The room a device is in as the screens group it: its room's id, or `UNASSIGNED_ROOM` when it is
 * in none, or in one this phone has not read yet (another phone made it a moment ago).
 */
export function roomOf(device: Device, rooms: Room[]): string {
  const id = device.room_id;
  return id && rooms.some((r) => r.id === id) ? id : UNASSIGNED_ROOM;
}

/**
 * Every room, by name, each with its devices, then Unassigned when a device is in no room. A room
 * with no devices is listed too: it is still the household's, and Home management offers it. The
 * Devices tab leaves those out, since there is nothing in them to switch.
 */
export function groupByRoom(devices: Device[], rooms: Room[]): DeviceRoom[] {
  const byRoom = new Map<string, Device[]>();
  for (const d of devices) {
    const id = roomOf(d, rooms);
    const existing = byRoom.get(id);
    if (existing) existing.push(d);
    else byRoom.set(id, [d]);
  }
  const named = [...rooms]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => ({ id: r.id, name: r.name, devices: [...(byRoom.get(r.id) ?? [])].sort(byReachability) }));
  const unassigned = byRoom.get(UNASSIGNED_ROOM);
  // Unassigned sits last; it is a fallback, not a room anyone named.
  return unassigned ? [...named, { id: UNASSIGNED_ROOM, name: '', devices: [...unassigned].sort(byReachability) }] : named;
}

/**
 * A change to one device's name and room, the two things `PUT /devices/{id}` lets a person set.
 * `roomId` null moves the device to Unassigned.
 */
export interface DeviceEdit {
  device: Device;
  name: string;
  roomId: string | null;
}

/** The request body for an edit. The hostname is left out, so the Pond keeps it. */
export function editRequest(edit: DeviceEdit): UpdateDeviceRequest {
  return { name: edit.name.trim(), room_id: edit.roomId };
}

export interface EditFailure {
  edit: DeviceEdit;
  error: unknown;
}

export interface EditOutcome {
  /** The rows the Pond answered with, for the edits it accepted. */
  saved: Device[];
  failed: EditFailure[];
}

/**
 * Send every edit, one `PUT` each, and keep going past a refusal.
 *
 * In parallel and settled rather than stopped at the first failure: a room rename that moves five
 * devices and is refused for one (another member's phone, which only that phone may change) has
 * still moved four, and the person is told about the one rather than left guessing.
 */
export async function applyEdits(
  client: Pick<PondApiClient, 'updateDevice'>,
  edits: DeviceEdit[],
): Promise<EditOutcome> {
  const results = await Promise.allSettled(edits.map((e) => client.updateDevice(e.device.id, editRequest(e))));
  const saved: Device[] = [];
  const failed: EditFailure[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') saved.push(r.value);
    else failed.push({ edit: edits[i], error: r.reason });
  });
  return { saved, failed };
}

/** Put the rows the Pond answered with in place of the ones they replace. */
export function mergeSaved(devices: Device[], saved: Device[]): Device[] {
  const byId = new Map(saved.map((d) => [d.id, d]));
  return devices.map((d) => byId.get(d.id) ?? d);
}

/** Why one edit was refused, in words. Always something: a sheet that closes on a failure lies. */
export function describeEditError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403 && e.detail === 'device_not_yours') return i18n.t('errors.deviceNotYours');
    if (e.status === 400) return i18n.t('errors.deviceNameRequired');
  }
  return describeDeviceError(e) ?? i18n.t('errors.deviceNotSaved');
}

/**
 * What to tell the person about a batch of edits, or null when all of them landed.
 *
 * One edit reads as its reason. Several say how many were not saved as well, because some were,
 * and the reason given is the first refusal's.
 */
export function describeEditOutcome(outcome: EditOutcome, total: number): string | null {
  const first = outcome.failed[0];
  if (!first) return null;
  const reason = describeEditError(first.error);
  if (total === 1) return reason;
  return i18n.t('errors.someDevicesNotSaved', { count: outcome.failed.length, total, reason });
}

/** Why a room could not be made, renamed or deleted, in words. */
export function describeRoomError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return i18n.t('rooms.errors.notEmpty');
    if (e.status === 404) return i18n.t('rooms.errors.gone');
    if (e.status === 400) return i18n.t('rooms.errors.nameRequired');
  }
  return describeApiError(e) ?? i18n.t('errors.generic');
}

/**
 * The household's rooms, or, from a Pond that has no `/rooms`, the ones its devices name in free
 * text, which can only be shown. Any other failure is the read's to report.
 */
export async function readRooms(
  client: Pick<PondApiClient, 'listRooms'>,
  devices: Device[],
): Promise<{ rooms: Room[]; devices: Device[]; editable: boolean }> {
  try {
    return { rooms: await client.listRooms(), devices, editable: true };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { ...legacyRooms(devices), editable: false };
    throw e;
  }
}

export interface UseDevices {
  data: {
    devices: Device[];
    /** Every room the household named, empty ones included, then Unassigned if a device is in none. */
    rooms: DeviceRoom[];
    /**
     * The filter tabs: All, then each room with a device in it. Empty when there is only one such
     * room: a filter with a single option is chrome.
     */
    roomTabs: { id: string; label: string }[];
    /** False on a Pond from before rooms had ids: its rooms are shown, but cannot be changed. */
    roomsEditable: boolean;
    /** How many devices the Pond can currently reach. */
    onlineCount: number;
    /** Power state by device id, as the device last confirmed it. Absent means it did not report one. */
    powerById: Record<string, boolean>;
    /** The power asked for by device id, while the Pond has not yet confirmed it. */
    waitingById: Record<string, boolean>;
    /** Commands tapped while the Pond was out of reach, to be sent when it is back. */
    queued: WaitingCommand[];
    matter: MatterStatus | null;
    /**
     * How old what is on screen is, when the Pond could not be read since: "5 min". Null while
     * the last read worked, or before any has.
     */
    staleFor: string | null;
  };
  loading: boolean;
  /** No read of the list has worked yet and the last one failed: the list is unknown, not empty. */
  failed: boolean;
  /**
   * Why the last read or commission failed. A refused switch or removal is said in the snackbar,
   * with Try again, since it is about the card just touched rather than the list.
   */
  error: string | null;
  actions: {
    refresh: () => Promise<void>;
    setState: (device: Device, patch: DeviceStatePatch) => Promise<void>;
    /** Take back a command still waiting for the Pond. */
    cancel: (deviceId: string) => void;
    commission: (code: string, name?: string) => Promise<string | null>;
    remove: (device: Device) => Promise<void>;
    /** Resolves to why some or all of the edits were refused, or null once every one is saved. */
    edit: (edits: DeviceEdit[]) => Promise<string | null>;
    /** A new room, with the chosen devices moved into it. Resolves to the refusal, or null. */
    createRoom: (name: string, deviceIds: ReadonlySet<string>) => Promise<string | null>;
    renameRoom: (room: DeviceRoom, name: string) => Promise<string | null>;
    /** Moves the room's devices to Unassigned, then deletes it, which the Pond allows only once it is empty. */
    deleteRoom: (room: DeviceRoom) => Promise<string | null>;
    /** The room with this name, made if there is none yet: what a typed room in the device sheet means. */
    roomNamed: (name: string) => Promise<{ id: string } | { error: string }>;
  };
}

/**
 * How often the device list and power states are re-read while a devices screen is in front.
 *
 * Each read is one request for the list and one per switchable device, so this is the most
 * expensive poll in the app and it runs slower than Now Playing for that reason.
 */
export const DEVICES_MS = 15_000;

/** The full read while the event stream is open: only a check that nothing was missed. */
export const DEVICES_STREAMING_MS = 5 * 60_000;
/** The first wait before opening a dropped stream again, doubling up to the second. */
export const DEVICES_STREAM_RETRY_MS = 5_000;
export const DEVICES_STREAM_RETRY_MAX_MS = 60_000;

/** The device list with one `device` event applied. */
export function applyDeviceChange(devices: Device[], event: Extract<DeviceEvent, { type: 'device' }>): Device[] {
  const others = devices.filter((d) => d.id !== event.device.id);
  return event.change === 'removed' ? others : [...others, event.device];
}

/**
 * Fold a poll's power readings in without undoing anything changed after that poll began.
 *
 * A poll is slower than a tap. One that read the lamp as off just before it was switched on would
 * land afterwards and switch it back off on screen, and if it landed after the switch's own
 * read-back it would stay wrong until the next poll. So a device changed at or after
 * `pollStartedAt` keeps what it shows; every other device takes the poll, including a device the
 * poll no longer reports, which becomes unknown.
 */
export function mergePower(
  current: Record<string, boolean>,
  fresh: Record<string, boolean>,
  changedAt: Record<string, number>,
  pollStartedAt: number,
): Record<string, boolean> {
  const next = { ...fresh };
  for (const [id, at] of Object.entries(changedAt)) {
    if (at >= pollStartedAt && id in current) next[id] = current[id];
  }
  return next;
}

/**
 * Whether a poll's device list may be shown. Not if the list was changed here -- a removal or a
 * commission -- at or after the poll began, which would put a deleted device back.
 */
export function listPollStillCurrent(pollStartedAt: number, listChangedAt: number): boolean {
  return pollStartedAt > listChangedAt;
}

/**
 * Whether a poll's power readings may be applied. Not if a poll that began later has already
 * applied its own: reads are not awaited by the poll loop, so a slow one can land after a
 * faster, newer one and would put an older state back on screen.
 */
export function powerPollStillCurrent(pollStartedAt: number, newestAppliedAt: number): boolean {
  return pollStartedAt >= newestAppliedAt;
}

/**
 * How long the list on screen has gone without a successful read, once one has failed after it.
 * Every poll that fails moves `failedAt` on, so the age grows while the Pond stays out of reach.
 */
export function staleFor(updatedAt: number | null, failedAt: number | null): string | null {
  if (updatedAt == null || failedAt == null || failedAt < updatedAt) return null;
  return ago((failedAt - updatedAt) / 1000);
}

export function useDevices(): UseDevices {
  const [devices, setDevices] = useState<Device[]>([]);
  const [roomList, setRoomList] = useState<Room[]>([]);
  const [roomsEditable, setRoomsEditable] = useState(true);
  const [powerById, setPowerById] = useState<Record<string, boolean>>({});
  const [waitingById, setWaitingById] = useState<Record<string, boolean>>({});
  const [matter, setMatter] = useState<MatterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // When the list was last read, and when a read last failed after that.
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [failedAt, setFailedAt] = useState<number | null>(null);
  // Nothing to show at all, as against a stale list: the two read differently on screen.
  const [failed, setFailed] = useState(false);
  // When this screen last changed something itself, so a poll that began earlier cannot undo it.
  const powerChangedAt = useRef<Record<string, number>>({});
  const listChangedAt = useRef(0);
  const powerAppliedAt = useRef(0);
  // Whether a read has ever succeeded. Before that a failure is the screen's news; after it, a
  // failed poll keeps the last list rather than replacing it with an error.
  const loaded = useRef(false);
  // Commands waiting for the Pond (see command-queue.ts): read by the poll, copied to state for the screen.
  const queue = useRef<WaitingCommand[]>([]);
  const [queued, setQueued] = useState<WaitingCommand[]>([]);
  // Whether this Pond has echoed a command's key, so a command can be sent again without running twice.
  const honoursKeys = useRef(false);
  const replaying = useRef(false);

  const setQueue = useCallback((next: WaitingCommand[]) => {
    queue.current = next;
    setQueued(next);
  }, []);
  const stopWaiting = useCallback((deviceId: string) => {
    setWaitingById(({ [deviceId]: _settled, ...rest }) => rest);
  }, []);

  /**
   * Read power state for the devices that have it.
   *
   * One dispatch call per device, in parallel, and a device that fails is simply
   * left unknown rather than failing the grid — a single unreachable bulb should
   * not blank the screen.
   */
  const readPower = useCallback(async (list: Device[], startedAt: number) => {
    const readings = await Promise.all(
      list
        .filter((d) => supports(d, 'power'))
        .map(async (d) => {
          try {
            const result = await api.getDeviceState(d.id);
            return [d.id, parsePowerState(result.content)] as const;
          } catch {
            return [d.id, undefined] as const;
          }
        }),
    );
    const fresh = Object.fromEntries(
      readings.filter((r): r is readonly [string, boolean] => r[1] !== undefined),
    );
    if (!powerPollStillCurrent(startedAt, powerAppliedAt.current)) return;
    powerAppliedAt.current = startedAt;
    setPowerById((current) => mergePower(current, fresh, powerChangedAt.current, startedAt));
  }, []);

  // The base URL and bearer token arrive asynchronously; fetching before they
  // land calls the default address unauthenticated and never retries.
  const { hydrated } = useServer();

  /**
   * One attempt at a command, and the device's state read back once it lands. The read-back is the
   * confirmation, because devices quantise and clamp — asking for 37% brightness may land on 40.
   * Rendering the request rather than the result is a bug this protocol has already had once.
   *
   * `unreachable` is a failure that says nothing about the command, on a Pond that will know its key
   * when it comes again. A refusal is said in the snackbar, with a Try again, rather than as a
   * banner: the switch has already gone back, and that alone reads as a missed tap.
   */
  const send = useCallback(async (command: WaitingCommand): Promise<'done' | 'unreachable' | 'refused'> => {
    try {
      const answer = await api.setDeviceState(command.deviceId, command.patch, command.key);
      if (answer.idempotency_key === command.key) honoursKeys.current = true;
      const actual = parsePowerState((await api.getDeviceState(command.deviceId)).content);
      if (actual !== undefined) {
        // The read-back is the newest thing known about this device; a poll already in
        // flight began before it and must not overwrite it.
        powerChangedAt.current[command.deviceId] = Date.now();
        setPowerById((current) => ({ ...current, [command.deviceId]: actual }));
      }
      return 'done';
    } catch (e) {
      if (!(e instanceof ApiError) && honoursKeys.current) return 'unreachable';
      logFailure('devices', 'state change refused', e);
      showSnackbar({
        message: describeDeviceError(e) ?? i18n.t('errors.deviceNotSaved'),
        tone: 'danger',
        action: {
          label: i18n.t('common.retry'),
          onPress: () => {
            const device = devicesRef.current.find((d) => d.id === command.deviceId);
            if (device) void retry.current.setState(device, command.patch);
          },
        },
      });
      return 'refused';
    }
  }, []);

  /** Drop what has waited too long, and once the Pond answers again, send the rest in order. */
  const replay = useCallback(
    async (reachable: boolean) => {
      if (replaying.current || queue.current.length === 0) return;
      replaying.current = true;
      try {
        const { send: due, stale } = sortWaiting(queue.current, Date.now());
        if (stale.length > 0) {
          setQueue(queue.current.filter((c) => !stale.includes(c)));
          for (const c of stale) stopWaiting(c.deviceId);
          setError(i18n.t('devices.commandsExpired', { count: stale.length, minutes: COMMAND_MAX_WAIT_MS / 60_000 }));
        }
        if (!reachable) return;
        for (const command of due) {
          const outcome = await send(command);
          if (outcome === 'unreachable') break;
          // Cancelled, or replaced by a newer tap, while it was on its way: that one is still waiting.
          if (!queue.current.includes(command)) continue;
          setQueue(queue.current.filter((c) => c !== command));
          stopWaiting(command.deviceId);
        }
      } finally {
        replaying.current = false;
      }
    },
    [send, setQueue, stopWaiting],
  );

  /**
   * One read of the list, the power states and the controller.
   *
   * `loud` is a read somebody asked for: it shows a spinner and reports a failure. A poll is
   * quiet: it keeps what is on screen through a failure, because a Pond that is briefly
   * unreachable has said nothing about the devices, and the connection banner already says
   * whether it can be reached.
   */
  const load = useCallback(
    async (loud: boolean) => {
      const startedAt = Date.now();
      let reachable = false;
      if (loud) {
        setLoading(true);
        setError(null);
      }
      try {
        const read = await readRooms(api, await api.listDevices());
        const list = read.devices;
        reachable = true;
        if (listPollStillCurrent(startedAt, listChangedAt.current)) {
          setDevices(list);
          setRoomList(read.rooms);
          setRoomsEditable(read.editable);
        }
        loaded.current = true;
        setError(null);
        setUpdatedAt(Date.now());
        setFailedAt(null);
        setFailed(false);
        void readPower(list, startedAt);
      } catch (e) {
        setFailedAt(Date.now());
        if (loud || !loaded.current) {
          setError(describeDeviceError(e));
          logFailure('devices', 'read failed', e);
        } else logFailure('devices', 'refresh failed; showing the last list', e);
        if (!loaded.current) setFailed(true);
      } finally {
        setLoading(false);
      }
      void replay(reachable);
      // Matter status is advisory: a Pond with the controller unreachable still
      // lists and controls whatever is already registered, so a failure here must
      // not take the screen down with it.
      try {
        setMatter(await api.matterStatus());
      } catch {
        setMatter(null);
      }
    },
    [readPower, replay],
  );
  // Polling until the stream is open, and while it is down; see the effect below.
  const [streaming, setStreaming] = useState(false);
  const delay = useCallback(() => (streaming ? DEVICES_STREAMING_MS : DEVICES_MS), [streaming]);
  useLive(() => load(false), delay, hydrated);
  const active = useScreenActive();

  /**
   * The event stream, opened again whenever it ends, from the last event seen. A Pond without the
   * route answers 404 and is left to the poll. The first open starts from now, so one read follows
   * it to cover what changed in between.
   */
  useEffect(() => {
    if (!hydrated || !active) return;
    const controller = new AbortController();
    const { signal } = controller;
    let backoff = DEVICES_STREAM_RETRY_MS;
    let reopen: ReturnType<typeof setTimeout> | null = null;
    let lastSeq: number | undefined;

    const onEvent = (event: DeviceEvent) => {
      // An event is the Pond answering: what is on screen is current.
      setUpdatedAt(Date.now());
      setFailedAt(null);
      if (event.type === 'resync') return void load(false);
      lastSeq = event.seq;
      if (event.type === 'device') {
        listChangedAt.current = Date.now();
        setDevices((current) => applyDeviceChange(current, event));
        return;
      }
      if (event.key !== 'power' || typeof event.value !== 'boolean') return;
      const on = event.value;
      powerChangedAt.current[event.device_id] = Date.now();
      setPowerById((current) => ({ ...current, [event.device_id]: on }));
    };

    const open = () => {
      reopen = null;
      const resuming = lastSeq;
      api
        .streamDeviceEvents(onEvent, signal, () => {
          backoff = DEVICES_STREAM_RETRY_MS;
          setStreaming(true);
          if (resuming == null) void load(false);
          // The link is back: what was tapped meanwhile can go now, not at the next check.
          void replay(true);
        }, resuming)
        .then(
          () => true,
          (e: unknown) => !(e instanceof ApiError && e.status === 404),
        )
        .then((again) => {
          if (signal.aborted) return;
          setStreaming(false);
          if (!again) return;
          reopen = setTimeout(open, backoff);
          backoff = Math.min(backoff * 2, DEVICES_STREAM_RETRY_MAX_MS);
        });
    };
    open();

    return () => {
      controller.abort();
      if (reopen) clearTimeout(reopen);
      setStreaming(false);
    };
  }, [hydrated, active, load, replay]);

  const refresh = useCallback(() => load(true), [load]);

  // `send` is made once, so the Try again below reads the list through a ref rather than a closure.
  // Written in an effect, not during render: a ref set while rendering is read back by whatever
  // renders next, which React does not promise, and the rule that forbids it is right here.
  const devicesRef = useRef<Device[]>([]);
  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  // What the snackbar's Try again calls: the current switch and removal, set below once made.
  const retry = useRef<Pick<UseDevices['actions'], 'setState' | 'remove'>>({
    setState: async () => {},
    remove: async () => {},
  });

  /**
   * Send a patch, and show the device's new state only once the Pond has read it back. Until then
   * the asked-for power is waiting, not shown as the device's state. The read-back is the
   * confirmation, because devices quantise and clamp — asking for 37% brightness may land on 40.
   * Rendering the request rather than the result is a bug this protocol has already had once.
   * A tap the Pond could not be reached for waits in the queue, still shown as waiting, if this
   * Pond can take it again safely.
   */
  const setState = useCallback(
    async (device: Device, patch: DeviceStatePatch) => {
      if (patch.power !== undefined) {
        setWaitingById((current) => ({ ...current, [device.id]: patch.power as boolean }));
      }
      const command: WaitingCommand = { deviceId: device.id, patch, key: commandKey(), queuedAt: Date.now() };
      if ((await send(command)) === 'unreachable') {
        setQueue(enqueue(queue.current, command));
        return;
      }
      stopWaiting(device.id);
    },
    [send, setQueue, stopWaiting],
  );

  /** One already on its way when this is tapped may still arrive. */
  const cancel = useCallback(
    (deviceId: string) => {
      setQueue(queue.current.filter((c) => c.deviceId !== deviceId));
      stopWaiting(deviceId);
    },
    [setQueue, stopWaiting],
  );

  /** Returns the new device's id, or null when commissioning failed. */
  const commission = useCallback(async (code: string, name?: string) => {
    setError(null);
    try {
      const created = await api.commissionDevice({ code, name });
      const read = await readRooms(api, await api.listDevices());
      // After the read, so a poll that began before it cannot replace this list with an older one.
      listChangedAt.current = Date.now();
      setDevices(read.devices);
      setRoomList(read.rooms);
      return created.id;
    } catch (e) {
      setError(describeCommissionError(e));
      return null;
    }
  }, []);

  const remove = useCallback(
    async (device: Device) => {
      const previous = devices;
      listChangedAt.current = Date.now();
      setDevices((current) => current.filter((d) => d.id !== device.id));
      try {
        await api.deleteDevice(device.id);
      } catch (e) {
        setDevices(previous);
        logFailure('devices', 'remove refused', e);
        showSnackbar({
          message: describeDeviceError(e) ?? i18n.t('errors.generic'),
          tone: 'danger',
          action: { label: i18n.t('common.retry'), onPress: () => void retry.current.remove(device) },
        });
      } finally {
        // Again once the server has answered: a poll that began while the delete was still out
        // read a list the server had not yet changed.
        listChangedAt.current = Date.now();
      }
    },
    [devices],
  );

  useEffect(() => {
    retry.current = { setState, remove };
  }, [setState, remove]);

  const edit = useCallback(async (edits: DeviceEdit[]) => {
    if (edits.length === 0) return null;
    const outcome = await applyEdits(api, edits);
    listChangedAt.current = Date.now();
    setDevices((current) => mergeSaved(current, outcome.saved));
    for (const f of outcome.failed) {
      console.warn('[devices] edit refused', f.edit.device.id, f.error instanceof ApiError ? f.error.status : 'network');
    }
    // Then the whole list again, as a commission does: an edit can land a device in a room another
    // phone renamed meanwhile. The rows above already show this phone's own changes, so a read that
    // fails here leaves them standing rather than reporting a second failure.
    try {
      const read = await readRooms(api, await api.listDevices());
      listChangedAt.current = Date.now();
      setDevices(read.devices);
      setRoomList(read.rooms);
    } catch (e) {
      console.warn('[devices] reread after edit failed', e instanceof ApiError ? e.status : 'network');
    }
    return describeEditOutcome(outcome, edits.length);
  }, []);

  const createRoom = useCallback(
    async (name: string, deviceIds: ReadonlySet<string>) => {
      if (nameTaken(roomList, name)) return i18n.t('rooms.errors.nameTaken', { room: name.trim() });
      let room: Room;
      try {
        room = await api.createRoom(name.trim());
      } catch (e) {
        logFailure('devices', 'room not made', e);
        return describeRoomError(e);
      }
      setRoomList((current) => [...current, room]);
      return edit(moveIntoRoom(devices, deviceIds, room.id));
    },
    [devices, edit, roomList],
  );

  const renameRoom = useCallback(
    async (room: DeviceRoom, name: string) => {
      if (name.trim() === room.name) return null;
      if (nameTaken(roomList, name, room.id)) return i18n.t('rooms.errors.nameTaken', { room: name.trim() });
      try {
        const renamed = await api.renameRoom(room.id, name.trim());
        setRoomList((current) => current.map((r) => (r.id === renamed.id ? renamed : r)));
        return null;
      } catch (e) {
        logFailure('devices', 'room not renamed', e);
        return describeRoomError(e);
      }
    },
    [roomList],
  );

  const deleteRoom = useCallback(
    async (room: DeviceRoom) => {
      // Emptied first: the Pond keeps a room that still has a device in it.
      const refused = await edit(unassignRoom(devices, room.id));
      if (refused) return refused;
      try {
        await api.deleteRoom(room.id);
        setRoomList((current) => current.filter((r) => r.id !== room.id));
        return null;
      } catch (e) {
        logFailure('devices', 'room not deleted', e);
        return describeRoomError(e);
      }
    },
    [devices, edit],
  );

  const roomNamed = useCallback(
    async (name: string): Promise<{ id: string } | { error: string }> => {
      const wanted = name.trim().toLocaleLowerCase();
      const known = roomList.find((r) => r.name.trim().toLocaleLowerCase() === wanted);
      if (known) return { id: known.id };
      try {
        const room = await api.createRoom(name.trim());
        setRoomList((current) => [...current, room]);
        return { id: room.id };
      } catch (e) {
        logFailure('devices', 'room not made', e);
        return { error: describeRoomError(e) };
      }
    },
    [roomList],
  );

  const rooms = useMemo(() => groupByRoom(devices, roomList), [devices, roomList]);
  const occupied = useMemo(() => rooms.filter((r) => r.devices.length > 0), [rooms]);

  return {
    data: {
      devices,
      rooms,
      // One room means one destination, and a filter that cannot change what
      // is shown is chrome. The screen renders no tabs at all in that case.
      roomTabs:
        occupied.length > 1
          ? [{ id: ALL_ROOMS, name: '' }, ...occupied].map((r) => ({ id: r.id, label: roomLabel(r) }))
          : [],
      roomsEditable,
      onlineCount: devices.filter((d) => d.is_online).length,
      powerById,
      waitingById,
      queued,
      matter,
      staleFor: staleFor(updatedAt, failedAt),
    },
    loading,
    failed,
    error,
    actions: { refresh, setState, cancel, commission, remove, edit, createRoom, renameRoom, deleteRoom, roomNamed },
  };
}

function describeDeviceError(e: unknown): string | null {
  if (e instanceof ApiError) {
    if (e.status === 404) return i18n.t('errors.deviceGone');
    if (e.status === 409) return i18n.t('errors.bridgedEndpoint');
  }
  return describeApiError(e);
}

/**
 * Commissioning failures are a closed set server-side, and each one calls for a
 * different action — so they are explained rather than reported.
 *
 * The message never echoes the setup code. It is a credential, redacted on both
 * sides of the protocol, and putting it in UI copy would undo that.
 */
export function describeCommissionError(e: unknown): string | null {
  // As `describeApiError`: an unreachable pond is the banner's to report.
  if (!(e instanceof ApiError)) return null;
  switch (e.status) {
    case 503:
      return i18n.t('devices.matterStartingRetry');
    case 502:
      return i18n.t('devices.matterRefused');
    case 400:
      return i18n.t('devices.setupCodeRejected');
    default:
      return describeApiError(e);
  }
}
