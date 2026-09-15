/**
 * Regression tests for the SSE frame parser.
 *
 * The bug these exist for: the parser split frames on a literal '\n\n', which
 * never occurs under CRLF framing ('\r\n\r\n' has no adjacent bare newlines).
 * Against a server that frames that way, no frame is ever emitted and the
 * carried remainder grows without bound — silent total non-delivery, not a
 * delay. The spec permits either framing, so the parser has to tolerate both.
 */

import { parseSseChunk } from '@/services/notification-stream';

/** Collect everything `parseSseChunk` emits, alongside the carried remainder. */
function parse(chunk: string): { emitted: string[]; remainder: string } {
  const emitted: string[] = [];
  const remainder = parseSseChunk(chunk, (data) => emitted.push(data));
  return { emitted, remainder };
}

describe('parseSseChunk', () => {
  it('emits LF-framed events', () => {
    const { emitted, remainder } = parse('data: {"id":"a"}\n\ndata: {"id":"b"}\n\n');

    expect(emitted).toEqual(['{"id":"a"}', '{"id":"b"}']);
    expect(remainder).toBe('');
  });

  it('emits CRLF-framed events', () => {
    const { emitted, remainder } = parse('data: {"id":"a"}\r\n\r\ndata: {"id":"b"}\r\n\r\n');

    expect(emitted).toEqual(['{"id":"a"}', '{"id":"b"}']);
    expect(remainder).toBe('');
  });

  it('carries a partial frame into the next chunk instead of emitting it', () => {
    const first = parse('data: {"id":"a"}\n\ndata: {"id"');
    expect(first.emitted).toEqual(['{"id":"a"}']);
    expect(first.remainder).toBe('data: {"id"');

    const second = parse(`${first.remainder}:"b"}\n\n`);
    expect(second.emitted).toEqual(['{"id":"b"}']);
    expect(second.remainder).toBe('');
  });

  it('joins the data lines of a multi-line frame', () => {
    const { emitted } = parse('data: line one\ndata: line two\n\n');

    expect(emitted).toEqual(['line one\nline two']);
  });

  it('ignores comment keep-alive frames, which carry no data line', () => {
    const { emitted } = parse(': keep-alive\n\ndata: {"id":"a"}\n\n');

    expect(emitted).toEqual(['{"id":"a"}']);
  });
});
