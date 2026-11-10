/**
 * The Debug view-model (issue #165): a home Pond opens nothing, a test Pond streams its log and
 * reads timing out of it, and the switch and the rollback report what the Pond said.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ApiError, api } from '@/services/api-client';
import type { LogEntry, LogStreamEvent } from '@/services/types';
import i18n from '@/services/i18n';
import {
  commandTiming,
  deviceCommandLabel,
  describeCommand,
  describeLine,
  formatDuration,
  groupLog,
  mergeNewestFirst,
  modelLabel,
} from '@/models/debug';
import { useDebug, type UseDebug } from '@/view-models/use-debug';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => {
  const actual = jest.requireActual('@/services/api-client');
  return {
    ...actual,
    api: {
      developerDebug: jest.fn(),
      setDeveloperDebug: jest.fn(),
      activeChatRole: jest.fn(),
      rollbackModel: jest.fn(),
      streamLogs: jest.fn(),
      listLogs: jest.fn(),
      listDevices: jest.fn(),
    },
  };
});

const pond = jest.mocked(api);

function line(id: number, metadata: Record<string, unknown> | null, over: Partial<LogEntry> = {}): LogEntry {
  return {
    id,
    timestamp: '2026-10-29 09:06:28',
    level: 'INFO',
    source: 'giap::trace',
    message: '',
    metadata: metadata ? JSON.stringify(metadata) : null,
    ...over,
  };
}

const turnEnd = (id: number, session = 's1') =>
  line(id, { kind: 'turn_end', session_id: session, total_latency_ms: 16697, ttft_ms: 2119, completion_tokens: 201 });

/** The stream as the Pond holds it open: frames are pushed by the test; it ends on abort. */
function openStream() {
  const stream: { push: (e: LogStreamEvent) => void; signal: AbortSignal | null } = { push: () => {}, signal: null };
  pond.streamLogs.mockImplementation((onEvent, signal, onOpen) => {
    stream.push = onEvent;
    stream.signal = signal ?? null;
    onOpen?.();
    return new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()));
  });
  return stream;
}

interface Mounted {
  readonly vm: UseDebug;
  unmount: () => Promise<void>;
}

async function mount(): Promise<Mounted> {
  let latest!: UseDebug;
  const Probe = () => {
    latest = useDebug();
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
  jest.resetAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  pond.developerDebug.mockResolvedValue({ test_pond: true, debug: false });
  pond.activeChatRole.mockResolvedValue({ model_id: 'gguf/new-model', rollback: { model_id: 'gguf/steady-model', model: 'steady-model' } });
  pond.listLogs.mockResolvedValue([]);
  pond.listDevices.mockResolvedValue([]);
});

afterEach(() => jest.restoreAllMocks());

describe('commandTiming', () => {
  it('reads how long a command took from its turn_end line', () => {
    expect(commandTiming(turnEnd(7))).toEqual({
      id: 7,
      timestamp: '2026-10-29 09:06:28',
      totalMs: 16697,
      firstTokenMs: 2119,
      completionTokens: 201,
      device: null,
    });
  });

  it('times a device the Pond drove, from the line its Matter controller logs', () => {
    const driven = line(8, {
      kind: 'matter_device_command',
      device: 'matter-3-1',
      verb: 'power',
      value: 'true',
      duration_ms: 412,
    });
    expect(commandTiming(driven)).toEqual({
      id: 8,
      timestamp: '2026-10-29 09:06:28',
      totalMs: 412,
      firstTokenMs: null,
      completionTokens: null,
      device: { id: 'matter-3-1', verb: 'power', value: 'true', failed: false },
    });
  });

  it('marks a device command that failed, which the Pond logs with an error code', () => {
    const meta = { kind: 'matter_device_command', device: 'matter-3-1', verb: 'power', duration_ms: 5000, error_code: 'timeout' };
    expect(commandTiming(line(9, meta, { level: 'WARN' }))?.device?.failed).toBe(true);
  });

  it('names a device as the household does, or by its id when the Pond has no name for it', () => {
    const t = i18n.t.bind(i18n);
    const names = new Map([['matter-3-1', 'Kitchen light']]);
    const power = (value: string | null, failed = false) => ({ id: 'matter-3-1', verb: 'power', value, failed });
    expect(deviceCommandLabel(power('true'), names, t)).toBe('Kitchen light on');
    expect(deviceCommandLabel(power('false', true), names, t)).toBe('Kitchen light off failed');
    // A Pond from before it logged the value still says what it did.
    expect(deviceCommandLabel(power(null), names, t)).toBe('Kitchen light power');
    expect(deviceCommandLabel({ id: 'matter-9-2', verb: 'level', value: '40', failed: false }, names, t)).toBe(
      'matter-9-2 level',
    );
  });

  it('leaves out the warm-up turns the Pond runs for itself', () => {
    expect(commandTiming(turnEnd(7, 'prewarm-1793264697488'))).toBeNull();
  });

  it('is null for any other line, and for metadata that is not JSON', () => {
    expect(commandTiming(line(1, { kind: 'tool_call' }))).toBeNull();
    expect(commandTiming(line(2, null))).toBeNull();
    expect(commandTiming(line(3, null, { metadata: '{not json' }))).toBeNull();
  });
});

describe('formatting', () => {
  it('joins two newest-first lists, each line once', () => {
    const a = [{ id: 5 }, { id: 3 }];
    const b = [{ id: 4 }, { id: 3 }, { id: 1 }];
    expect(mergeNewestFirst(a, b, 3).map((x) => x.id)).toEqual([5, 4, 3]);
  });

  it('says milliseconds under a second and seconds above', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(16697)).toBe('16.7 s');
  });

  it('names a model without its catalogue category', () => {
    expect(modelLabel('gguf/gemma-4-E4B-it-qat-UD-Q4_K_XL')).toBe('gemma-4-E4B-it-qat-UD-Q4_K_XL');
    expect(modelLabel('plain')).toBe('plain');
  });
});

describe('the log as sentences', () => {
  const t = i18n.t.bind(i18n);

  it('gathers a chat message under one heading, in the order it happened', () => {
    const lines = [
      line(6, { kind: 'summary_refresh', session_id: 's1' }),
      line(5, { kind: 'memory_extraction_pass', written: 0 }),
      turnEnd(4),
      line(3, { kind: 'tool_result', session_id: 's1', tool: 'giap-schedule__list_schedules', latency_ms: 1 }),
      line(2, { kind: 'turn_start', session_id: 's1', model: 'gemma' }),
      line(1, { kind: 'memory_extraction_pass', written: 0 }),
    ];
    const items = groupLog(lines);
    expect(items.map((i) => i.type)).toEqual(['line', 'command', 'line']);
    const command = items[1];
    if (command.type !== 'command') throw new Error('not a command');
    expect(command.lines.map((l) => l.id)).toEqual([2, 3, 4, 6]);
    expect(describeCommand(command)).toEqual({ warmUp: false, startedAt: lines[4].timestamp, totalMs: 16697, running: false });
  });

  it('starts a new heading for each message in the same chat', () => {
    const items = groupLog([
      turnEnd(4),
      line(3, { kind: 'turn_start', session_id: 's1' }),
      turnEnd(2),
      line(1, { kind: 'turn_start', session_id: 's1' }),
    ]);
    expect(items).toHaveLength(2);
  });

  it('counts a line that repeats rather than listing it again', () => {
    const items = groupLog([
      line(3, { kind: 'memory_extraction_pass', written: 1 }),
      line(2, { kind: 'memory_extraction_pass', written: 0 }),
      line(1, { kind: 'developer_debug', enabled: true }),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: 'line', repeats: 2, entry: { id: 3 } });
  });

  it('marks a warm-up, and a message seen starting but not yet answered', () => {
    const [item] = groupLog([line(1, { kind: 'turn_start', session_id: 'prewarm-1' })]);
    if (item.type !== 'command') throw new Error('not a command');
    expect(describeCommand(item)).toMatchObject({ warmUp: true, totalMs: null, running: true });
  });

  it('reads each known kind as a sentence', () => {
    expect(describeLine(turnEnd(1), t)).toEqual({
      text: 'Replied in 16.7 s',
      detail: 'first word 2.1 s · 201 tokens',
    });
    expect(describeLine(line(2, { kind: 'tool_result', tool: 'giap-x__do_thing', latency_ms: 1, failed: true }), t).text).toBe(
      'Do thing failed',
    );
    expect(describeLine(line(3, { kind: 'model_activated', role: 'chat', model_id: 'gguf/gemma' }), t).text).toBe(
      'Chat model set to gemma',
    );
    expect(describeLine(line(4, { kind: 'tools_withheld_for_missing_secret', tools: '{"giap-k__search_web"}' }), t).detail).toBe(
      'Web search',
    );
  });

  it('falls back to the Pond’s own words, and says where they came from', () => {
    expect(describeLine(line(1, null, { message: 'KV prefix reused', source: 'giap::trace' }), t)).toEqual({
      text: 'KV prefix reused',
      detail: null,
    });
    expect(describeLine(line(2, { kind: 'brand_new_thing' }), t).text).toBe('Brand new thing');
    expect(describeLine(line(3, null, { message: 'odd token', level: 'WARN', source: 'llama-cpp-2' }), t)).toEqual({
      text: 'Odd token',
      detail: 'llama-cpp-2',
    });
  });
});

describe('useDebug', () => {
  it('opens nothing on a home Pond', async () => {
    pond.developerDebug.mockResolvedValue({ test_pond: false, debug: false });
    const m = await mount();
    expect(m.vm.data.testPond).toBe(false);
    expect(pond.streamLogs).not.toHaveBeenCalled();
    expect(pond.activeChatRole).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('treats a Pond without the route as no test Pond, not as an error', async () => {
    pond.developerDebug.mockRejectedValue(new ApiError('GET → 404', 404, null, null, null));
    const m = await mount();
    expect(m.vm.data.testPond).toBe(false);
    expect(m.vm.error).toBeNull();
    await m.unmount();
  });

  it('streams the log on a test Pond, newest first, and times each command', async () => {
    const stream = openStream();
    const m = await mount();
    expect(m.vm.data.stream).toBe('live');
    expect(m.vm.data.chat?.rollback?.model_id).toBe('gguf/steady-model');

    await act(async () => {
      stream.push({ kind: 'status', status: { chat_provider: 'local', chat_model: 'new-model' } });
      stream.push({ kind: 'log', entry: line(1, { kind: 'tool_call' }) });
      stream.push({ kind: 'log', entry: turnEnd(2) });
      stream.push({ kind: 'skipped', count: 3 });
    });
    expect(m.vm.data.lines.map((l) => l.id)).toEqual([2, 1]);
    expect(m.vm.data.timings.map((t) => t.totalMs)).toEqual([16697]);
    expect(m.vm.data.skipped).toBe(3);
    await m.unmount();
  });

  it('shows a command run while the screen was closed, with its timing', async () => {
    pond.listLogs.mockResolvedValue([turnEnd(9), line(8, { kind: 'turn_start' })]);
    const stream = openStream();
    const m = await mount();
    expect(pond.listLogs).toHaveBeenCalledWith({ limit: 200 });
    await act(async () => {
      stream.push({ kind: 'log', entry: line(10, { kind: 'tool_call' }) });
      stream.push({ kind: 'log', entry: turnEnd(9) });
    });
    expect(m.vm.data.lines.map((l) => l.id)).toEqual([10, 9, 8]);
    expect(m.vm.data.timings.map((t) => t.id)).toEqual([9]);
    await m.unmount();
  });

  it('reads the device names on a test Pond, so timing can show them', async () => {
    pond.listDevices.mockResolvedValue([{ id: 'matter-3-1', name: 'Kitchen light', is_online: true }]);
    openStream();
    const m = await mount();
    expect(m.vm.data.deviceNames.get('matter-3-1')).toBe('Kitchen light');
    await m.unmount();
  });

  it('re-reads the chat model when a switch is logged, from anywhere', async () => {
    const stream = openStream();
    const m = await mount();
    pond.activeChatRole.mockResolvedValue({ model_id: 'gguf/steady-model', rollback: null });
    await act(async () => {
      stream.push({ kind: 'log', entry: line(5, { kind: 'model_activated', role: 'chat' }) });
    });
    expect(m.vm.data.chat?.model_id).toBe('gguf/steady-model');
    await m.unmount();
  });

  it('closes the stream when the screen leaves', async () => {
    const stream = openStream();
    const m = await mount();
    await m.unmount();
    expect(stream.signal?.aborted).toBe(true);
  });

  it('puts the switch back and says why when the Pond refuses it', async () => {
    openStream();
    pond.setDeveloperDebug.mockRejectedValue(new ApiError('PUT → 409', 409, null, 'not_a_test_pond', null));
    const m = await mount();
    await act(async () => {
      await m.vm.actions.setDebug(true);
    });
    expect(m.vm.data.debug).toBe(false);
    expect(m.vm.error).toMatch(/isn’t a test Pond/);
    await m.unmount();
  });

  it('rolls back, then shows the model chat now runs on', async () => {
    openStream();
    pond.rollbackModel.mockResolvedValue({ role: 'chat', model_id: 'gguf/steady-model' });
    const m = await mount();
    pond.activeChatRole.mockResolvedValue({ model_id: 'gguf/steady-model', rollback: null });
    let ok = false;
    await act(async () => {
      ok = await m.vm.actions.rollback();
    });
    expect(ok).toBe(true);
    expect(m.vm.data.chat?.model_id).toBe('gguf/steady-model');
    expect(m.vm.data.chat?.rollback).toBeNull();
    await m.unmount();
  });

  it('says there is nothing to go back to when the Pond has no earlier model', async () => {
    openStream();
    pond.rollbackModel.mockRejectedValue(new ApiError('POST → 404', 404, null, 'nothing_to_roll_back', null));
    const m = await mount();
    await act(async () => {
      await m.vm.actions.rollback();
    });
    expect(m.vm.error).toMatch(/no earlier model/);
    await m.unmount();
  });
});
