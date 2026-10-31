/**
 * A turn, as it arrives and as it is read back.
 *
 * `applyFrame` is fed the frame shapes `routes.rs` writes, in the order a real
 * turn sends them. `fromHistory` is fed rows in the order the Pond stores them
 * — results before the call that asked for them — because that ordering is the
 * one thing a naive fold gets wrong.
 */

import type { TFunction } from 'i18next';

import en from '@/services/i18n/locales/en.json';
import { GREETINGS_PER_PERIOD, SUBTITLES, THINKING_QUIPS, WORKING_QUIPS, periodOf } from '@/constants/quips';
import { bareToolName, humanizeTool, keptLine, readSearch, sourcesOf } from '@/constants/tools';
import i18n from '@/services/i18n';
import type { Message } from '@/models/chat';
import type { SessionMessage } from '@/services/types';
import {
  applyFrame,
  cardOf,
  cardToKeep,
  derivedTitle,
  fromHistory,
  keptStubOf,
  statusFor,
  titleFromThread,
  toolResultText,
} from '@/view-models/use-chat';

const t = ((key: string, opts?: Record<string, unknown>) =>
  opts?.tool ? `${key}:${String(opts.tool)}` : key) as unknown as TFunction;

const empty = (): Message => ({ id: 'r', role: 'assistant', content: '', timestamp: 0, pending: true });

describe('applyFrame', () => {
  it('builds a reply from a real turn: a tool, its result, then the words', () => {
    const frames = [
      { type: 'status', content: 'Agent working...' },
      { type: 'tool_call', tool: 'giap-weather__get_current_weather', id: 'c1', input: { location: 'Nairobi' } },
      {
        type: 'tool_result',
        tool: 'giap-weather__get_current_weather',
        id: 'c1',
        content: 'Nairobi: 23C, overcast',
        ui: { card_type: 'weather', data: { location: 'Nairobi', temperature: 23 } },
      },
      { type: 'text', content: 'It is ', token: 'It is ' },
      { type: 'text', content: '23 degrees.', token: '23 degrees.' },
      { done: true, session_id: 's1' },
    ];
    const reply = frames.reduce(applyFrame, empty());
    expect(reply.content).toBe('It is 23 degrees.');
    expect(reply.tools).toEqual([
      {
        id: 'c1',
        name: 'giap-weather__get_current_weather',
        args: '{"location":"Nairobi"}',
        status: 'ok',
        result: 'Nairobi: 23C, overcast',
        card: { type: 'weather', data: { location: 'Nairobi', temperature: 23 } },
      },
    ]);
  });

  it('lets a review pass replace what streamed, and keeps reasoning passages', () => {
    let reply = applyFrame(empty(), { type: 'text', content: 'draft' });
    reply = applyFrame(reply, { type: 'thinking', content: 'hm' });
    reply = applyFrame(reply, { type: 'review_revision', content: 'final' });
    expect(reply.content).toBe('final');
    expect(reply.thinking).toEqual(['hm']);
  });

  it('keeps a result whose call it never saw, and ignores a repeated call', () => {
    let reply = applyFrame(empty(), { type: 'tool_result', id: 'x', tool: 't', content: 'late' });
    reply = applyFrame(reply, { type: 'tool_call', id: 'x', tool: 't', input: null });
    expect(reply.tools).toHaveLength(1);
    expect(reply.tools?.[0]).toMatchObject({ id: 'x', status: 'ok', result: 'late' });
  });

  it('ignores frames it does not draw', () => {
    const reply = empty();
    expect(applyFrame(reply, { type: 'turn_stats' })).toBe(reply);
    expect(applyFrame(reply, { type: 'context_warning' })).toBe(reply);
  });
});

describe('derivedTitle', () => {
  // The Pond's own cases for `derive_title_from_text`, which this must agree with.
  it('takes the first six words', () => {
    expect(derivedTitle('What is the capital of France exactly?')).toBe('What is the capital of France');
  });

  it('trims quotes and whitespace', () => {
    expect(derivedTitle('  "hello world"  ')).toBe('hello world');
    expect(derivedTitle("'single quoted'")).toBe('single quoted');
  });

  it('is empty when there are no words', () => {
    expect(derivedTitle('')).toBe('');
    expect(derivedTitle('   ')).toBe('');
  });

  it('caps a long word at sixty characters and an ellipsis', () => {
    const title = derivedTitle('a'.repeat(100));
    expect(Array.from(title)).toHaveLength(61);
    expect(title.endsWith('…')).toBe(true);
  });

  it('names the conversations on the wall as the Pond named them', () => {
    expect(derivedTitle('Is the name Jerry associated with any historical figures?')).toBe(
      'Is the name Jerry associated with',
    );
    expect(derivedTitle('What is the weather in Nairobi right now?')).toBe('What is the weather in Nairobi');
  });
});

describe('titleFromThread', () => {
  const said = (role: Message['role'], content: string, id = content): Message => ({
    id,
    role,
    content,
    timestamp: 0,
  });

  it('titles a conversation by its first question in words', () => {
    expect(titleFromThread([])).toBeNull();
    expect(
      titleFromThread([said('user', '', 'picture'), said('user', 'Whose dog is this, and why is it here?')]),
    ).toBe('Whose dog is this, and why');
  });

  it('declines a thread that may not begin at its beginning', () => {
    const long = Array.from({ length: 100 }, (_, i) => said(i % 2 ? 'assistant' : 'user', `turn ${i}`));
    expect(titleFromThread(long)).toBeNull();
  });
});

describe('cardOf', () => {
  it('reads a card only when the result names its kind and carries its facts', () => {
    expect(cardOf({ type: 'tool_result', ui: { card_type: 'weather', data: { temperature: 25.9 } } })).toEqual({
      type: 'weather',
      data: { temperature: 25.9 },
    });
    expect(cardOf({ type: 'tool_result', ui: { card_type: 'weather' } })).toBeUndefined();
    expect(cardOf({ type: 'tool_result', ui: { data: {} } })).toBeUndefined();
    expect(cardOf({ type: 'tool_result', content: 'plain text' })).toBeUndefined();
  });
});

describe('cardToKeep', () => {
  const search = { card_type: 'search', data: { query: 'q', results: [{ title: 'T', url: 'https://a.example/' }] } };

  /** Brave's terms allow search results only transient storage, so the phone keeps no copy. */
  it('keeps no card for a result the Pond marks transient', () => {
    expect(cardToKeep({ type: 'tool_result', id: 'c1', transient: true, ui: search })).toBeUndefined();
  });

  it('keeps every other card', () => {
    expect(cardToKeep({ type: 'tool_result', id: 'c1', ui: search })).toEqual({ type: 'search', data: search.data });
    expect(cardToKeep({ type: 'tool_result', id: 'c1', transient: false, ui: search })).toEqual({
      type: 'search',
      data: search.data,
    });
  });

  /** On screen the turn still draws it: only keeping it is refused. */
  it('still lets the live turn draw a transient card', () => {
    const reply = applyFrame(applyFrame(empty(), { type: 'tool_call', tool: 'giap-knowledge__search_web', id: 'c1' }), {
      type: 'tool_result',
      tool: 'giap-knowledge__search_web',
      id: 'c1',
      transient: true,
      content: 'Web results for: q',
      ui: search,
    });
    expect(reply.tools?.[0].card).toEqual({ type: 'search', data: search.data });
  });
});

const row = (r: Partial<SessionMessage>): SessionMessage => ({
  id: r.id ?? 'id',
  session_id: 's',
  role: r.role ?? 'user',
  content: r.content ?? '',
  created_at: '2026-09-24T09:00:00+00:00',
  ...r,
});

const STUB = 'Web search results are not kept after the turn. Sources: kenyapower.co.ke, nation.africa.';

/** The row as `GET /sessions/{id}/messages` returns it: the stored row as JSON, the marker inside. */
const keptRow = (callId: string, extra: Partial<SessionMessage> = {}) =>
  row({
    id: `t-${callId}`,
    role: 'tool',
    tool_call_id: callId,
    content: JSON.stringify({
      tool_call_id: callId,
      tool: 'giap-knowledge__search_web',
      content: STUB,
      arguments: '{"question":"power outage Nairobi"}',
      transient: true,
    }),
    ...extra,
  });

describe('keptStubOf', () => {
  it('reads the stub from inside the stored row', () => {
    expect(keptStubOf(keptRow('c1'))).toBe(STUB);
  });

  it('accepts the marker on the message, with the stub as its content', () => {
    expect(keptStubOf(row({ role: 'tool', tool_call_id: 'c1', content: ` ${STUB} `, transient: true }))).toBe(STUB);
  });

  it('is null for a row that holds its whole result, an empty stub, or a row that is not a tool row', () => {
    expect(keptStubOf(row({ role: 'tool', content: JSON.stringify({ content: '23C', transient: false }) }))).toBeNull();
    expect(keptStubOf(row({ role: 'tool', content: 'bare result' }))).toBeNull();
    expect(keptStubOf(row({ role: 'tool', content: JSON.stringify({ content: '  ', transient: true }) }))).toBeNull();
    expect(keptStubOf(row({ role: 'tool', content: '[1,2]' }))).toBeNull();
    expect(keptStubOf(row({ role: 'assistant', content: JSON.stringify({ content: STUB, transient: true }) }))).toBeNull();
  });
});

describe('fromHistory', () => {

  it('folds each stored result into the call that asked for it, results first', () => {
    const messages = fromHistory([
      row({ id: 'u', role: 'user', content: 'Weather?' }),
      row({
        id: 't',
        role: 'tool',
        tool_call_id: 'c1',
        content: JSON.stringify({ tool_call_id: 'c1', tool: 'w', content: '23C', arguments: '{}' }),
      }),
      row({
        id: 'a',
        role: 'assistant',
        content: 'It is 23 degrees.',
        tool_calls: [{ id: 'c1', name: 'giap-weather__get_current_weather', arguments: '{}' }],
      }),
    ]);
    expect(messages.map((m) => m.id)).toEqual(['u', 'a']);
    expect(messages[1].tools).toEqual([
      { id: 'c1', name: 'giap-weather__get_current_weather', args: '{}', status: 'ok', result: '23C' },
    ]);
  });

  it('leaves out system rows and assistant rows that said and did nothing', () => {
    const messages = fromHistory([
      row({ id: 'sys', role: 'system' as SessionMessage['role'], content: 'You are Goose.' }),
      row({ id: 'blank', role: 'assistant', content: '   ' }),
      row({ id: 'u', role: 'user', content: 'hi' }),
    ]);
    expect(messages.map((m) => m.id)).toEqual(['u']);
  });

  it('puts back the cards this phone kept, by call, and leaves the rest as text', () => {
    const blob = (id: string, content: string) =>
      JSON.stringify({ tool_call_id: id, tool: 'w', content, arguments: '{}' });
    const weather = { type: 'weather', data: { location: 'Nairobi', temperature: 25.9 } };
    const [, answer] = fromHistory(
      [
        row({ id: 'u', role: 'user', content: 'Weather, and the time?' }),
        row({ id: 't1', role: 'tool', tool_call_id: 'c1', content: blob('c1', 'Mainly clear') }),
        row({ id: 't2', role: 'tool', tool_call_id: 'c2', content: blob('c2', '13:18') }),
        row({
          id: 'a',
          role: 'assistant',
          content: 'Clear and warm.',
          tool_calls: [
            { id: 'c1', name: 'giap-weather__get_current_weather', arguments: '{}' },
            { id: 'c2', name: 'giap-system__get_time', arguments: '{}' },
          ],
        }),
      ],
      // A card kept for a call that is not in this conversation changes nothing.
      { c1: weather, elsewhere: { type: 'time', data: {} } },
    );
    expect(answer.tools?.map((tool) => tool.card)).toEqual([weather, undefined]);
    expect(answer.tools?.map((tool) => tool.result)).toEqual(['Mainly clear', '13:18']);
  });

  it('brings a result the Pond did not keep back as its stub, never as a result or a card', () => {
    const search = { type: 'search', data: { query: 'q', results: [{ title: 'Kept before', url: 'https://a.example/' }] } };
    const [, answer] = fromHistory(
      [
        row({ id: 'u', role: 'user', content: 'Is there an outage?' }),
        keptRow('c1'),
        row({
          id: 'a',
          role: 'assistant',
          content: 'Kenya Power lists one in Westlands.',
          tool_calls: [{ id: 'c1', name: 'giap-knowledge__search_web', arguments: '{}' }],
        }),
      ],
      // A card this phone kept before the Pond marked the result transient is not drawn.
      { c1: search },
    );
    expect(answer.tools).toEqual([
      { id: 'c1', name: 'giap-knowledge__search_web', args: '{}', status: 'ok', result: undefined, kept: STUB },
    ]);
    expect(sourcesOf(answer.tools)).toEqual([]);
  });

  it('carries pictures as Pond paths, to be fetched with the bearer header', () => {
    const [m] = fromHistory([
      row({
        role: 'user',
        content: 'Look',
        images: [{ id: 'i1', mime_type: 'image/jpeg', byte_size: 10, url: '/api/v1/sessions/s/attachments/i1' }],
      }),
    ]);
    expect(m.images).toEqual([
      { id: 'i1', uri: '/api/v1/sessions/s/attachments/i1', local: false, mimeType: 'image/jpeg' },
    ]);
  });
});

describe('readSearch', () => {
  it('reads the pages, titled, and never a link that is not the web', () => {
    const card = readSearch({
      query: ' museum hours ',
      results: [
        { title: 'Opening hours', url: 'https://www.museums.or.ke/visit', domain: 'museums.or.ke', snippet: 'Open 9 to 5.' },
        { title: '', url: 'https://example.com/a' },
        { title: 'Sneaky', url: 'javascript:alert(1)' },
        null,
        'not an entry',
        { title: '', url: '' },
      ],
    });
    expect(card).toEqual({
      query: 'museum hours',
      pages: [
        { title: 'Opening hours', url: 'https://www.museums.or.ke/visit', site: 'museums.or.ke', snippet: 'Open 9 to 5.' },
        { title: 'example.com', url: 'https://example.com/a', site: 'example.com', snippet: '' },
        { title: 'Sneaky', url: null, site: '', snippet: '' },
      ],
      places: [],
    });
  });

  /** The Pond's contract (small-model-tools.md section 8.10.3): a place's `url` may be "". */
  it('reads the places, a link only when the address is http(s), and drops one with no name', () => {
    const { places } = readSearch({
      query: 'What time does Java House at Junction close?',
      results: [],
      places: [
        { name: 'Java House Junction', url: 'https://www.javahouseafrica.com/junction', snippet: 'day: Monday; hours: 7 am - 10 pm' },
        { name: 'Artcaffe Junction', url: '', snippet: '' },
        { name: 'Somewhere', url: 'file:///etc/passwd', snippet: 'x' },
        { name: '  ', url: 'https://nameless.example/' },
        { url: 'https://nameless.example/' },
      ],
    });
    expect(places).toEqual([
      {
        title: 'Java House Junction',
        url: 'https://www.javahouseafrica.com/junction',
        site: 'javahouseafrica.com',
        snippet: 'day: Monday; hours: 7 am - 10 pm',
      },
      { title: 'Artcaffe Junction', url: null, site: '', snippet: '' },
      { title: 'Somewhere', url: null, site: '', snippet: 'x' },
    ]);
  });

  it('draws nothing from a card that is not one', () => {
    expect(readSearch({})).toEqual({ query: '', pages: [], places: [] });
    expect(readSearch({ query: 7, results: 'x', places: { name: 'n' } })).toEqual({ query: '', pages: [], places: [] });
  });
});

describe('keptLine', () => {
  const tool = (name: string, kept: string) => ({ id: 'c1', name, args: '{}', status: 'ok' as const, kept });

  /** The desktop's wording, so a reloaded conversation reads the same on both. */
  it('names the tool and the sources the stub names', () => {
    expect(keptLine(tool('giap-knowledge__search_web', STUB), i18n.t)).toBe(
      "Web search: results aren't kept after the turn. Sources: kenyapower.co.ke, nation.africa.",
    );
  });

  it('says so without sources when the stub names none', () => {
    expect(keptLine(tool('giap-knowledge__search_web', 'Not kept.'), i18n.t)).toBe(
      "Web search: results aren't kept after the turn.",
    );
    expect(keptLine(tool('acme__lookup_things', 'Not kept.'), i18n.t)).toBe(
      "Lookup things: results aren't kept after the turn.",
    );
  });
});

describe('toolResultText', () => {
  it('reads the result out of the stored blob, and tolerates a bare one', () => {
    expect(toolResultText(JSON.stringify({ content: 'ok' }))).toBe('ok');
    expect(toolResultText('plain text')).toBe('plain text');
  });
});

describe('statusFor', () => {
  it('says what the Pond said, or what a named tool is doing, or which tool it is', () => {
    expect(statusFor({ type: 'status', content: 'Compacting context...' }, t)).toBe('Compacting context...');
    // The review after the answer is still the turn, and says so.
    expect(statusFor({ type: 'review_status', content: 'Reviewing answer...' }, t)).toBe('Reviewing answer...');
    expect(statusFor({ type: 'tool_call', tool: 'giap-weather__get_current_weather' }, t)).toBe(
      'chat.tools.doingWeather',
    );
    expect(statusFor({ type: 'tool_call', tool: 'ext__open_garage_door' }, t)).toBe(
      'chat.tools.using:Open garage door',
    );
    expect(statusFor({ type: 'text', content: 'x' }, t)).toBeNull();
  });
});

describe('tool names and sources', () => {
  it('strips the extension and writes the rest in sentence case', () => {
    expect(bareToolName('giap-weather__get_current_weather')).toBe('get_current_weather');
    expect(humanizeTool('ext__open_garage_door')).toBe('Open garage door');
  });

  it('finds sources on the live card or in a saved result, once each', () => {
    const sources = sourcesOf([
      {
        id: '1',
        name: 'k',
        args: '{}',
        status: 'ok',
        card: { type: 'knowledge', data: { source_url: 'https://en.wikipedia.org/wiki/Nairobi' } },
      },
      { id: '2', name: 'k', args: '{}', status: 'ok', result: 'Pi is 3.14\n\nSource: https://www.wolframalpha.com/input?i=pi' },
      { id: '3', name: 'k', args: '{}', status: 'ok', result: 'x\n\nSource: https://en.wikipedia.org/wiki/Nairobi' },
    ]);
    expect(sources.map((s) => s.site)).toEqual(['Wikipedia', 'Wolfram Alpha']);
  });

  /** The search card draws its own pages, so they are not listed a second time under it. */
  it('leaves a web search\'s pages to its own card', () => {
    const sources = sourcesOf([
      {
        id: '1',
        name: 'giap-knowledge__search_web',
        args: '{}',
        status: 'ok',
        card: { type: 'search', data: { query: 'q', results: [{ title: 'T', url: 'https://www.museums.or.ke/visit' }] } },
      },
    ]);
    expect(sources).toEqual([]);
  });

  it('titles a live Wikipedia source with its article', () => {
    const [source] = sourcesOf([
      {
        id: '1',
        name: 'k',
        args: '{}',
        status: 'ok',
        card: { type: 'knowledge', data: { title: 'Nairobi', source_url: 'https://en.wikipedia.org/wiki/Nairobi' } },
      },
    ]);
    expect(source).toEqual({ title: 'Nairobi', site: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Nairobi' });
  });
});

describe('the quip and greeting catalogue', () => {
  const chat = en.chat as unknown as Record<string, Record<string, Record<string, string>>>;

  it('holds exactly as many lines as the code picks from', () => {
    expect(Object.keys(chat.quips.thinking)).toHaveLength(THINKING_QUIPS);
    expect(Object.keys(chat.quips.working)).toHaveLength(WORKING_QUIPS);
    for (const period of ['morning', 'afternoon', 'evening', 'night', 'anonymous']) {
      expect(Object.keys(chat.greeting[period])).toHaveLength(GREETINGS_PER_PERIOD);
    }
    expect(Object.keys(chat.greeting.subtitle)).toHaveLength(SUBTITLES);
  });

  it('puts the hours where the desktop does', () => {
    expect([4, 5, 11, 12, 16, 17, 21, 22].map(periodOf)).toEqual([
      'night',
      'morning',
      'morning',
      'afternoon',
      'afternoon',
      'evening',
      'evening',
      'night',
    ]);
  });
});
