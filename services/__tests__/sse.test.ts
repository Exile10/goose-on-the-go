/**
 * The event-stream grammar, fed the way a network actually delivers it: in
 * pieces that ignore line boundaries.
 */

import { createSseParser, type SseEvent } from '@/services/sse';

function parse(chunks: string[]): SseEvent[] {
  const events: SseEvent[] = [];
  const parser = createSseParser((e) => events.push(e));
  chunks.forEach((c) => parser.push(c));
  parser.end();
  return events;
}

describe('createSseParser', () => {
  it('dispatches on a blank line and names untyped events "message"', () => {
    expect(parse(['data: {"a":1}\n\n'])).toEqual([{ event: 'message', data: '{"a":1}', id: undefined }]);
  });

  it('reassembles a frame split mid-line and mid-CRLF', () => {
    const events = parse(['da', 'ta: hel', 'lo\r', '\n\r\n', 'data: two\n\n']);
    expect(events.map((e) => e.data)).toEqual(['hello', 'two']);
  });

  it('joins multi-line data with newlines, and reads event and id fields', () => {
    const events = parse(['event: tool\nid: 7\ndata: one\ndata: two\n\n']);
    expect(events).toEqual([{ event: 'tool', data: 'one\ntwo', id: '7' }]);
  });

  it('ignores comments and keep-alives, and drops only one leading space', () => {
    const events = parse([': ping\n\n', 'data:  padded\n\n']);
    expect(events.map((e) => e.data)).toEqual([' padded']);
  });

  it('flushes a final frame the server closed without a blank line', () => {
    expect(parse(['data: last']).map((e) => e.data)).toEqual(['last']);
  });
});
