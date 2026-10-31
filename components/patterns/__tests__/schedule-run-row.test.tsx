/**
 * A run row opens to everything the run produced and closes again.
 *
 * The complaint was a phone that cut every answer at six lines with no way to
 * read the rest, printed the agent's markdown as raw asterisks, and gave the
 * time a run took as a bare count of milliseconds. This pins the row that
 * replaced it: a plain preview, a button that says whether it is open, the
 * chat's renderer once it is, and no button at all when there is nothing more
 * to show.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { useInkTheme } from '@jarida/ink/native';

import { Markdown } from '@/components/patterns/markdown';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import type { ScheduleRun } from '@/services/types';

import { RunRow } from '../schedule-run-row';

// lucide ships ES modules Jest does not transform; the glyph is not under test, only which one is asked for.
jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));

const WEATHER = [
  '**Weather in Nairobi:**',
  '',
  '* Temperature: 22 C',
  '* Humidity: 60%',
  '* Wind: 10 km/h',
  '* Sky: partly cloudy',
].join('\n');

function run(overrides: Partial<ScheduleRun>): ScheduleRun {
  return {
    id: 'run-1',
    schedule_id: 'sched-1',
    status: 'completed',
    result: null,
    error: null,
    started_at: '2026-10-28T07:00:00Z',
    finished_at: '2026-10-28T07:02:09Z',
    duration_ms: 128_820,
    ...overrides,
  };
}

/** Async, so the reduce-motion setting Ink reads on mount settles inside `act`. */
async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

/** `Markdown` is memoised, and the renderer keys a memoised component by the function inside it. */
const MarkdownBody = (Markdown as unknown as { type: React.ComponentType }).type;

function markdowns(tree: ReactTestRenderer): ReactTestInstance[] {
  return tree.root.findAllByType(MarkdownBody);
}

/** Every string the row draws, in order. */
function texts(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(Text)
    .map((node) => [node.props.children].flat().filter((c) => typeof c === 'string').join(''))
    .filter((s) => s.length > 0);
}

/** The row's press, if it has one. */
function button(tree: ReactTestRenderer): ReactTestInstance | null {
  return tree.root.findAllByType(GPressable)[0] ?? null;
}

function press(tree: ReactTestRenderer) {
  const target = button(tree);
  if (!target) throw new Error('the row has no button');
  expect(target.props.accessibilityRole).toBe('button');
  act(() => {
    target.props.onPress();
  });
}

describe('RunRow', () => {
  it('marks a missed run nobody chose to run as skipped, not failed', async () => {
    const tree = await render(<RunRow run={run({ status: 'skipped' })} />);
    expect(texts(tree).join('\n')).toContain('Skipped');
  });

  it('says when a late run was due', async () => {
    const tree = await render(<RunRow run={run({ caught_up_from: '2026-10-28T06:30:00Z' })} />);
    expect(texts(tree).join('\n')).toMatch(/Ran late/);
  });

  it('shows a plain preview with no markdown markers while closed', async () => {
    const tree = await render(<RunRow run={run({ result: WEATHER })} />);
    const drawn = texts(tree).join('\n');
    expect(drawn).toContain('Weather in Nairobi:');
    expect(drawn).not.toMatch(/\*/);
    expect(drawn).not.toContain('Sky: partly cloudy');
    expect(markdowns(tree)).toHaveLength(0);
  });

  it('opens to the whole answer in the chat renderer, and closes again', async () => {
    const tree = await render(<RunRow run={run({ result: WEATHER })} />);
    const chevron = () => tree.root.findAllByType(GIcon).map((icon) => icon.props.name);
    expect(button(tree)?.props.accessibilityState).toEqual({ expanded: false });
    expect(chevron()).toEqual(['chevron-right']);
    expect(button(tree)?.props.accessibilityHint).toBe('Shows everything this run produced');

    press(tree);
    expect(button(tree)?.props.accessibilityState).toEqual({ expanded: true });
    expect(chevron()).toEqual(['chevron']);
    expect(button(tree)?.props.accessibilityHint).toBe('Shows only the start of what this run produced');
    expect(markdowns(tree)).toHaveLength(1);
    expect(markdowns(tree)[0].props.source).toBe(WEATHER);
    expect(texts(tree).join('\n')).toContain('Sky: partly cloudy');

    press(tree);
    expect(button(tree)?.props.accessibilityState).toEqual({ expanded: false });
    expect(markdowns(tree)).toHaveLength(0);
  });

  it('gives a short answer no button, because there is nothing more to show', async () => {
    const tree = await render(<RunRow run={run({ result: 'All **three** lights are off.' })} />);
    expect(button(tree)).toBeNull();
    expect(tree.root.findAllByType(GIcon)).toHaveLength(0);
    expect(texts(tree)).toContain('All three lights are off.');
  });

  it('opens a long error to all of it, in the danger tone', async () => {
    let danger = '';
    function Probe() {
      danger = useInkTheme().color.dangerFg;
      return null;
    }
    await render(<Probe />);
    const error = Array.from({ length: 5 }, (_, i) => `step ${i + 1} failed`).join('\n\n');
    const tree = await render(<RunRow run={run({ status: 'failed', error })} />);
    const preview = tree.root.findAllByType(Text).find((node) => node.props.children === 'step 1 failed\nstep 2 failed\nstep 3 failed…');
    expect(preview).toBeDefined();
    expect(StyleSheet.flatten(preview!.props.style).color).toBe(danger);

    press(tree);
    const whole = tree.root.findAllByType(Text).find((node) => node.props.children === error);
    expect(whole).toBeDefined();
    expect(whole!.props.selectable).toBe(true);
    expect(StyleSheet.flatten(whole!.props.style).color).toBe(danger);
    expect(markdowns(tree)).toHaveLength(0);
  });

  it('says how long the run took in words', async () => {
    const tree = await render(<RunRow run={run({ result: 'Done.' })} />);
    expect(texts(tree)).toContain('2 min 9 s');
  });
});
