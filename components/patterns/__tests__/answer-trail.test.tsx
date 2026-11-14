/**
 * The chip under an answer: one source named by its site, one tool by its name, more counted, and
 * a sheet that lists each page and each tool. A tool that did not finish marks the chip, so folding
 * the tools away never hides a failure.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import i18n from '@/services/i18n';
import type { ToolCall } from '@/models/chat';
import type { CitedSource } from '@/models/sources';
import { ThemeProvider } from '@/providers/theme-provider';

import { TrailChip, TrailSheet, trailWords, useTrail, type TrailState } from '../answer-trail';

jest.mock('@/components/ui/g-icon', () => ({ GIcon: 'GIcon' }));
jest.mock('@/services/haptics', () => ({ selectionTick: jest.fn(async () => {}) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = i18n.t.bind(i18n);

const wiki: CitedSource = { title: 'Michael Clarke Duncan', url: 'https://en.wikipedia.org/wiki/Michael_Clarke_Duncan' };
const bio: CitedSource = { title: 'Michael Clarke Duncan', url: 'https://www.biography.com/actors/michael-clarke-duncan' };
const cbs: CitedSource = { title: 'Actor Michael Clarke Duncan dead at 54', url: 'https://www.cbsnews.com/news/duncan' };

function call(name: string, status: ToolCall['status'] = 'ok', result = 'done'): ToolCall {
  return { id: `call-${name}`, name: `giap__${name}`, args: '{}', status, result };
}

describe('the chip words', () => {
  it('names one page by its site, as a person names it', () => {
    expect(trailWords([wiki], [], t)).toBe('Wikipedia');
    expect(trailWords([cbs], [], t)).toBe('cbsnews.com');
  });

  it('counts several pages, and names or counts the tools beside them', () => {
    expect(trailWords([wiki, bio, cbs], [], t)).toBe('3 sources');
    expect(trailWords([], [call('search_web')], t)).toBe('Web search');
    expect(trailWords([], [call('search_web'), call('get_current_weather')], t)).toBe('2 tools');
    expect(trailWords([wiki, bio], [call('search_web')], t)).toBe('2 sources, Web search');
  });
});

function texts(node: ReactTestInstance): string[] {
  return node.findAllByType(Text).map((n) => [n.props.children].flat().join(''));
}

function Harness({ sources, tools, onState }: { sources: CitedSource[]; tools: ToolCall[]; onState?: (s: TrailState) => void }) {
  const state = useTrail(sources);
  onState?.(state);
  return (
    <>
      <TrailChip state={state} tools={tools} />
      {state.mounted ? <TrailSheet state={state} tools={tools} /> : null}
    </>
  );
}

// The theme reads its saved choice back from storage, so it settles a tick after the first frame.
async function render(sources: CitedSource[], tools: ToolCall[], onState?: (s: TrailState) => void): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ThemeProvider>
        <Harness sources={sources} tools={tools} onState={onState} />
      </ThemeProvider>,
    );
  });
  return tree;
}

const chip = (tree: ReactTestRenderer) =>
  tree.root.find((n) => typeof n.type !== 'string' && n.props.accessibilityHint === t('chat.trail.hint') && Boolean(n.props.onPress));

describe('the chip and its sheet', () => {
  it('draws nothing for an answer that read nothing and ran nothing', async () => {
    expect(texts((await render([], [])).root)).toEqual([]);
  });

  it('opens a sheet listing each page by site and title', async () => {
    const tree = await render([wiki, bio, cbs], []);
    expect(texts(tree.root)).toEqual(['3 sources']);
    act(() => chip(tree).props.onPress());
    const drawn = texts(tree.root);
    expect(drawn).toContain(t('chat.trail.titleSources'));
    expect(drawn).toContain('Wikipedia');
    expect(drawn).toContain('biography.com');
    expect(drawn).toContain('Actor Michael Clarke Duncan dead at 54');
    expect(drawn).toContain('3');
  });

  it('opens at the page a number in the text names', async () => {
    let state!: TrailState;
    const tree = await render([wiki, bio], [], (s) => (state = s));
    act(() => state.chips?.open(bio.url));
    expect(state.focus).toBe(bio.url);
    expect(texts(tree.root)).toContain('biography.com');
    expect(state.chips?.numberOf(bio.url)).toBe(2);
  });

  it("groups pages and tools apart, and opens a tool's raw answer on a tap", async () => {
    const tree = await render([wiki], [call('search_web', 'ok', 'Ten pages about the actor')]);
    act(() => chip(tree).props.onPress());
    const drawn = texts(tree.root);
    expect(drawn).toContain(t('chat.trail.titleBoth'));
    expect(drawn).toContain(t('chat.trail.titleTools'));
    expect(drawn).not.toContain('Ten pages about the actor');
    const row = tree.root.find((n) => typeof n.type !== 'string' && n.props.accessibilityLabel === 'Web search' && Boolean(n.props.onPress));
    act(() => row.props.onPress());
    expect(texts(tree.root)).toContain('Ten pages about the actor');
  });

  it('marks the chip when a tool did not finish', async () => {
    const tree = await render([], [call('search_web', 'error', '')]);
    const icons = chip(tree).findAll((n) => n.type === ('GIcon' as unknown as React.ElementType)).map((n) => n.props.name);
    expect(icons).toEqual(['warn']);
  });
});
