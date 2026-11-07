// A held microphone: letting go sends what was said, sliding away sends nothing, a tap that lingered
// sends nothing and says how, and a release that lands while the microphone is still opening counts.

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { MicBuffer } from '@/services/voice-io';
import { VOICE_NOTE_MAX_MS, useVoiceNote, type VoiceNote, type VoiceNoteRecorder } from '@/view-models/use-voice-note';

jest.mock('@/services/haptics', () => ({ confirm: jest.fn(), reject: jest.fn(), tap: jest.fn() }));

const mockMic = {
  onBuffer: null as ((b: MicBuffer) => void) | null,
  open: null as (() => void) | null,
  start: jest.fn(),
  stop: jest.fn(),
  granted: true,
};
jest.mock('@/services/voice-io', () => ({
  voiceSupported: () => true,
  requestMicrophone: jest.fn(async () => ({ granted: mockMic.granted, canAskAgain: true })),
  beginVoiceSession: jest.fn(async () => undefined),
  endVoiceSession: jest.fn(async () => undefined),
  useMicStream: (onBuffer: (b: MicBuffer) => void) => {
    mockMic.onBuffer = onBuffer;
    return { start: mockMic.start, stop: mockMic.stop };
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const trees: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => trees.splice(0).forEach((t) => t.unmount()));
  jest.clearAllMocks();
  mockMic.granted = true;
  mockMic.start.mockImplementation(async () => undefined);
});

function mount() {
  const sent: VoiceNote[] = [];
  let latest!: VoiceNoteRecorder;
  const Probe = () => {
    latest = useVoiceNote((note) => sent.push(note));
    return null;
  };
  act(() => {
    trees.push(create(<Probe />));
  });
  return { sent, get vm() { return latest; } };
}

/** `ms` of speech at 16 kHz, in 100 ms buffers. */
function speak(ms: number) {
  for (let at = 0; at < ms; at += 100) {
    act(() => mockMic.onBuffer?.({ samples: new Int16Array(1600).fill(2000), sampleRate: 16_000 }));
  }
}

describe('useVoiceNote', () => {
  it('hands over a 16 kHz WAV of what was said when the finger lifts', async () => {
    const h = mount();
    await act(() => h.vm.begin());
    expect(h.vm.state).toBe('recording');
    speak(1500);
    act(() => h.vm.release());

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].durationMs).toBe(1500);
    const wav = h.sent[0].wav;
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(16_000);
    expect(h.vm.state).toBe('idle');
    expect(mockMic.stop).toHaveBeenCalled();
  });

  it('sends nothing when the finger slides away', async () => {
    const h = mount();
    await act(() => h.vm.begin());
    speak(1500);
    act(() => h.vm.cancel());
    expect(h.sent).toHaveLength(0);
    expect(h.vm.error).toBeNull();
  });

  it('sends nothing for a tap that lingered, and says to hold while speaking', async () => {
    const h = mount();
    await act(() => h.vm.begin());
    speak(300);
    act(() => h.vm.release());
    expect(h.sent).toHaveLength(0);
    expect(h.vm.error).toBe('Hold the microphone while you speak, then let go to send.');
  });

  it('honours a release that lands while the microphone is still opening', async () => {
    let open!: () => void;
    mockMic.start.mockImplementation(() => new Promise<void>((resolve) => (open = resolve)));
    const h = mount();
    let begun!: Promise<void>;
    act(() => {
      begun = h.vm.begin();
    });
    await act(async () => undefined);
    act(() => h.vm.release());
    await act(async () => {
      open();
      await begun;
    });
    expect(h.vm.state).toBe('idle');
    expect(mockMic.stop).toHaveBeenCalled();
    expect(h.sent).toHaveLength(0);
  });

  it('records nothing once the microphone is refused', async () => {
    mockMic.granted = false;
    const h = mount();
    await act(() => h.vm.begin());
    expect(h.vm.state).toBe('idle');
    expect(mockMic.start).not.toHaveBeenCalled();
    expect(h.vm.error).not.toBeNull();
  });

  it('sends by itself at the limit', async () => {
    const h = mount();
    await act(() => h.vm.begin());
    speak(VOICE_NOTE_MAX_MS);
    expect(h.sent).toHaveLength(1);
    expect(h.vm.state).toBe('idle');
  });
});
