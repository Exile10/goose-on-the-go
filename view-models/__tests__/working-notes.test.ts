/**
 * Working notes: the text Goose writes before a tool call, which a newer Pond
 * names on the `tool_call` frame. It is the model at work, not the answer, so
 * the reply moves it into its steps. An older Pond never names it, and the
 * reply is then folded exactly as before.
 */

import type { Message } from '@/models/chat';
import { applyFrame } from '@/services/chat-runs';
import type { ChatFrame } from '@/services/types';

const empty = (): Message => ({ id: 'r', role: 'assistant', content: '', timestamp: 0, pending: true });

const fold = (frames: ChatFrame[]) => frames.reduce(applyFrame, empty());

describe('working notes', () => {
  it('moves the notes out of the answer and into the steps', () => {
    const reply = fold([
      { type: 'text', content: 'Let me check ' },
      { type: 'text', content: 'the weather.' },
      { type: 'tool_call', tool: 'giap-weather__get_weather', id: 'c1', input: {}, working_notes: 'Let me check the weather.' },
      { type: 'tool_result', tool: 'giap-weather__get_weather', id: 'c1', content: '23C' },
      { type: 'text', content: 'Now the news.' },
      { type: 'tool_call', tool: 'giap-knowledge__news', id: 'c2', input: {}, working_notes: 'Now the news.' },
      { type: 'tool_result', tool: 'giap-knowledge__news', id: 'c2', content: 'headlines' },
      { type: 'text', content: 'It is 23 degrees, ' },
      { type: 'text', content: 'and the news is quiet.' },
    ]);
    expect(reply.content).toBe('It is 23 degrees, and the news is quiet.');
    expect(reply.steps).toEqual(['Let me check the weather.', 'Now the news.']);
    expect(reply.tools?.map((tool) => tool.id)).toEqual(['c1', 'c2']);
  });

  it('removes the text since the last tool call when the answer does not end with the notes', () => {
    const reply = fold([
      { type: 'tool_call', tool: 'giap-weather__get_weather', id: 'c1', input: {} },
      { type: 'text', content: 'Checking the ' },
      { type: 'text', content: 'news now.' },
      { type: 'tool_call', tool: 'giap-knowledge__news', id: 'c2', input: {}, working_notes: 'Checking the news.' },
      { type: 'text', content: 'All quiet.' },
    ]);
    expect(reply.content).toBe('All quiet.');
    expect(reply.steps).toEqual(['Checking the news.']);
  });

  it('keeps text from before an earlier tool call when the fallback cuts', () => {
    const reply = fold([
      { type: 'text', content: 'Sure. ' },
      { type: 'tool_call', tool: 'giap-weather__get_weather', id: 'c1', input: {} },
      { type: 'text', content: 'Looking it up.' },
      { type: 'tool_call', tool: 'giap-knowledge__news', id: 'c2', input: {}, working_notes: 'Looking up.' },
    ]);
    expect(reply.content).toBe('Sure. ');
    expect(reply.steps).toEqual(['Looking up.']);
  });

  it('leaves the reply as it was when the Pond sends no notes', () => {
    const reply = fold([
      { type: 'text', content: 'Let me check the weather.' },
      { type: 'tool_call', tool: 'giap-weather__get_weather', id: 'c1', input: {} },
      { type: 'tool_result', tool: 'giap-weather__get_weather', id: 'c1', content: '23C' },
      { type: 'text', content: ' It is 23 degrees.' },
    ]);
    expect(reply.content).toBe('Let me check the weather. It is 23 degrees.');
    expect(reply.steps).toBeUndefined();
  });

  it('does not move the notes twice when a replay repeats the call', () => {
    const frames: ChatFrame[] = [
      { type: 'text', content: 'Let me look.' },
      { type: 'tool_call', tool: 'giap-weather__get_weather', id: 'c1', input: {}, working_notes: 'Let me look.' },
      { type: 'text', content: 'Sunny.' },
    ];
    const reply = fold([...frames, frames[1]]);
    expect(reply.content).toBe('Sunny.');
    expect(reply.steps).toEqual(['Let me look.']);
  });
});
