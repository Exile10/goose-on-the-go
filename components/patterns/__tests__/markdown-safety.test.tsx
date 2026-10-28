// What a long report may contain, drawn as the phone draws it. The text is the model's, so nothing in
// it may run, fetch or launch: HTML stays text, only web links link, and a picture is never loaded.

import React from 'react';
import { Image, Linking, Text } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { Markdown } from '@/components/patterns/markdown';

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
// lucide is not transformed under jest; the renderer only draws a tick with it.
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function draw(source: string): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Markdown source={source} />);
  });
  return tree;
}

/** Every string drawn, in order, as one text. */
function words(tree: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: ReactTestInstance | string) => {
    if (typeof node === 'string') out.push(node);
    else node.children.forEach(walk);
  };
  walk(tree.root);
  return out.join('');
}

function links(tree: ReactTestRenderer): ReactTestInstance[] {
  return tree.root.findAll((n) => n.type === Text && n.props.accessibilityRole === 'link');
}

it('shows HTML as the text it is, and draws none of it', async () => {
  const tree = await draw('Before <b>bold</b> after.\n\n<script>alert("hi")</script>\n\n<iframe src="https://x.test"></iframe>');
  const text = words(tree);
  expect(text).toContain('<b>bold</b>');
  expect(text).toContain('<script>alert("hi")</script>');
  expect(text).toContain('<iframe src="https://x.test"></iframe>');
});

it('links only web addresses; a script or an app scheme stays plain text', async () => {
  const tree = await draw(
    '[Fort Jesus](https://www.openstreetmap.org/search?query=Fort%20Jesus) [run](javascript:alert(1)) [app](intent://x) [file](file:///etc/hosts)',
  );
  const linked = links(tree);
  expect(linked).toHaveLength(1);
  expect(words(tree)).toContain('run');
  expect(words(tree)).toContain('app');
});

it('never loads a picture, and shows what it was of instead', async () => {
  const tree = await draw('![The beach at Nyali](https://tracker.example/pixel.png)\n\n![](javascript:alert(1))');
  expect(tree.root.findAll((n) => n.type === Image)).toHaveLength(0);
  expect(words(tree)).toContain('The beach at Nyali');
});

it('draws a plan: a table, a read-only checklist and struck-through text', async () => {
  const tree = await draw(
    '| Day | Dinner |\n| --- | --- |\n| Saturday | Grilled fish |\n\n- [x] Train tickets\n- [ ] Sunscreen\n\n~~Rain jacket~~ Light cardigan',
  );
  const text = words(tree);
  expect(text).toContain('Saturday');
  expect(text).toContain('Grilled fish');
  expect(text).toContain('Train tickets');
  expect(text).not.toContain('[x]');
  // Checklist boxes are drawn, not pressable: a report cannot be ticked off from here.
  expect(tree.root.findAll((n) => typeof n.props.onPress === 'function' && n.props.accessibilityRole !== 'link')).toHaveLength(0);
  expect(tree.root.findAll((n) => n.type === Text && JSON.stringify(n.props.style ?? '').includes('line-through'))).not.toHaveLength(0);
});

it('opens a map where the phone opens maps, and any other page in the in-app browser', async () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const tree = await draw('[Old Port](https://www.openstreetmap.org/search?query=Old%20Port) and [the timetable](https://metickets.krc.co.ke)');
  const [map, page] = links(tree);
  await act(async () => map.props.onPress());
  await act(async () => page.props.onPress());
  expect(openURL).toHaveBeenCalledWith('https://www.openstreetmap.org/search?query=Old%20Port');
  expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://metickets.krc.co.ke');
  expect(openURL).toHaveBeenCalledTimes(1);
  openURL.mockRestore();
});
