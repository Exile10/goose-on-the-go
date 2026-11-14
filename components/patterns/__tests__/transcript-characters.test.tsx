// Every character either side of a conversation reaches the screen as written: what the person
// typed is never read as markdown, and a reply's markdown and TeX are drawn, not shown as syntax.

import React from 'react';
import { ScrollView } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { Markdown } from '@/components/patterns/markdown';
import { MessageRow } from '@/components/patterns/message-row';
import type { Message } from '@/models/chat';

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
// The swipe runs on gesture-handler and worklets, which jest's stand-ins cannot carry; the sheet and viewer are modals.
jest.mock('@/components/patterns/swipe-to-reply', () => ({ SwipeToReply: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/patterns/picture-viewer', () => ({ PictureViewer: () => null }));
jest.mock('@/components/patterns/reply-part-sheet', () => ({ ReplyPartSheet: () => null }));
jest.mock('@/components/patterns/pond-picture', () => ({ PondPicture: (props: { path: string }) => `pond:${props.path}` }));
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));
// A user bubble draws none of these; loading them would start Reanimated and the network.
jest.mock('@/components/patterns/voice-note-mic', () => ({ clockWords: () => '' }));
jest.mock('@/components/patterns/cited-sources', () => ({ PagePictures: () => null, SourcesChipRow: () => null, useSources: () => ({}) }));
jest.mock('@/components/patterns/message-note', () => ({ FromLine: () => null, OfferPanel: () => null, ReceiptChips: () => null }));
jest.mock('@/components/patterns/thinking-quips', () => ({ ThinkingQuips: () => null }));
jest.mock('@/components/patterns/tool-card', () => ({ ToolTrail: () => null, foldedTools: () => [] }));
jest.mock('@/view-models/use-page-pictures', () => ({ usePagePictures: () => [] }));
jest.mock('@/services/voice-io', () => ({ playFile: jest.fn() }));
jest.mock('@/services/api-client', () => ({ api: {} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function draw(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

function words(tree: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: ReactTestInstance | string) => {
    if (typeof node === 'string') out.push(node);
    else node.children.forEach(walk);
  };
  walk(tree.root);
  return out.join('');
}

const TYPED = [
  'Is $5 + $10 = $15? Path: $HOME/bin:$PATH and /usr/local/bin',
  'C:\\Users\\jerry\\notes.txt, a\\b, \\$ and \\\\',
  '*not bold* **nor this** `nor code` # not a heading',
  '<b>tags</b> &amp; &lt;entities&gt; 50% ~5~ x^2 $x^2$',
  // A thumbs-up with a skin tone, and a family joined with zero-width joiners.
  'Habari! Ñandú, naïve café, 中文, العربية, \u{1F44D}\u{1F3FD} \u{1F468}\u200D\u{1F469}\u200D\u{1F467}',
].join('\n');

it('draws what the person typed exactly as typed, markdown and TeX included', async () => {
  const message: Message = { id: 'u1', role: 'user', content: TYPED, timestamp: 0 };
  const tree = await draw(<MessageRow message={message} position="only" turnSeed={0} />);
  expect(words(tree)).toBe(TYPED);
});

it("keeps a reply's dollars, slashes and backslashes when it holds no math", async () => {
  const tree = await draw(
    <Markdown source={'Add `$HOME/bin` to $PATH: it costs $5 and $10, or $5-$10.\n\nC:\\Users\\jerry and /usr/local/bin, 50/50, US$5.'} />,
  );
  const text = words(tree);
  expect(text).toContain('$HOME/bin');
  expect(text).toContain('to $PATH: it costs $5 and $10, or $5-$10.');
  expect(text).toContain('C:\\Users\\jerry and /usr/local/bin, 50/50, US$5.');
});

it("keeps a cited link's words, and draws a bare-number citation as its number", async () => {
  const urls = ['https://www.sebastiani.com/', 'https://en.wikipedia.org/wiki/Sonoma'];
  const sources = { numberOf: (url: string) => (urls.includes(url) ? urls.indexOf(url) + 1 : undefined), open: jest.fn() };
  const tree = await draw(
    <Markdown source={'[Sebastiani](https://www.sebastiani.com/) is close to [Sonoma](https://en.wikipedia.org/wiki/Sonoma) [2](https://en.wikipedia.org/wiki/Sonoma).'} sources={sources} />,
  );
  expect(words(tree)).toBe('Sebastiani is close to Sonoma \u2009[2].');
});

it("draws a reply's escapes and entities as the characters they stand for", async () => {
  const tree = await draw(<Markdown source={'\\$5 \\*not em\\* \\\\ &mdash; &copy; &#36; &amp;lt;'} />);
  expect(words(tree)).toBe('$5 *not em* \\ — © $ &lt;');
});

it("draws a reply's TeX as math, inline and on a line of its own", async () => {
  const tree = await draw(
    <Markdown source={'Since $a^2 + b^2 = c^2$ and \\(\\theta = 30^\\circ\\):\n\n$$\n\\frac{\\sqrt{3}}{2} \\approx 0.866\n$$'} />,
  );
  const text = words(tree);
  expect(text).toContain('Since a² + b² = c² and θ = 30°:');
  expect(text).toContain('√3/2 ≈ 0.866');
  expect(text).not.toMatch(/\$|\\frac|\\\(/);
  // The equation scrolls sideways rather than wrapping, as code does.
  expect(tree.root.findAll((n) => n.type === ScrollView)).toHaveLength(1);
});

it("keeps a reply's TeX in a code block as the code it is", async () => {
  const tree = await draw(<Markdown source={'```latex\n$x^2$ \\frac{a}{b}\n```'} />);
  expect(words(tree)).toContain('$x^2$ \\frac{a}{b}');
});
