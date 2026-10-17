import { chunk, encodeFrame, FrameReader, FramingError, MAX_MESSAGE_BYTES } from '../setup-channel/framing';

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('setup channel framing', () => {
  it('puts the UTF-8 length before the JSON, big-endian', () => {
    const frame = encodeFrame({ type: 'hello', id: 1, name: 'Mbuzi' });
    const body = JSON.stringify({ type: 'hello', id: 1, name: 'Mbuzi' });
    expect(Array.from(frame.slice(0, 4))).toEqual([0, 0, 0, body.length]);
    expect(Buffer.from(frame.slice(4)).toString('utf8')).toBe(body);
  });

  it('counts bytes, not characters', () => {
    const frame = encodeFrame({ ssid: 'Café ☕' });
    const body = Buffer.from(JSON.stringify({ ssid: 'Café ☕' }), 'utf8');
    expect(new DataView(frame.buffer).getUint32(0, false)).toBe(body.length);
  });

  it('refuses to send a message over 16 KiB', () => {
    expect(() => encodeFrame({ pad: 'x'.repeat(MAX_MESSAGE_BYTES) })).toThrow(FramingError);
  });

  it('cuts writes no longer than the link takes, in order', () => {
    const frame = encodeFrame({ pad: 'y'.repeat(100) });
    const parts = chunk(frame, 20);
    expect(parts.every((p) => p.length <= 20)).toBe(true);
    expect(Buffer.concat(parts.map((p) => Buffer.from(p)))).toEqual(Buffer.from(frame));
  });

  it.each([1, 3, 4, 5, 20, 182, 512])('reassembles a message cut into %i-byte notifications', (size) => {
    const message = { id: 7, type: 'wifi_scan', ok: true, networks: [{ ssid: 'Home', signal: 80 }] };
    const reader = new FrameReader();
    const out: unknown[] = [];
    for (const part of chunk(encodeFrame(message), size)) out.push(...reader.push(part));
    expect(out).toEqual([message]);
    expect(reader.midMessage).toBe(false);
  });

  it('reads two messages sent one after the other', () => {
    const reader = new FrameReader();
    expect(reader.push(encodeFrame({ id: 1 }))).toEqual([{ id: 1 }]);
    expect(reader.push(encodeFrame({ id: 2 }))).toEqual([{ id: 2 }]);
  });

  it('refuses a length over 16 KiB before reading any of it', () => {
    const reader = new FrameReader();
    expect(() => reader.push(bytes(0, 0, 0x40, 0x01))).toThrow(FramingError);
  });

  it('refuses a notification that runs past the end of its message', () => {
    const reader = new FrameReader();
    const frame = encodeFrame({ id: 1 });
    expect(() => reader.push(Uint8Array.from([...frame, 0]))).toThrow(FramingError);
  });

  it('refuses a body that is not a JSON object', () => {
    const reader = new FrameReader();
    expect(() => reader.push(bytes(0, 0, 0, 2, 0x5b, 0x5d))).toThrow(FramingError);
    expect(() => new FrameReader().push(bytes(0, 0, 0, 1, 0x7b))).toThrow(FramingError);
  });
});
