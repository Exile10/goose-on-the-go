/**
 * The weather cards in a turn's tool trail, drawn the way the chat draws them.
 *
 * A seven-day forecast came out on a phone as a card holding the place name
 * and a sun: the forecast payload was drawn as a current reading, which it
 * has no fields for. These pin the forecast as its own card, one row a day,
 * and a payload with nothing to draw folded into the chip instead of an empty
 * card. Both schemes are rendered, because the rows take their ink from the
 * theme and a hard-coded colour would vanish on one of them.
 */

import '@/services/i18n';
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { InkEdge, InkProvider } from '@jarida/ink/native';

import type { ToolCall } from '@/models/chat';
import { FORECAST_ROWS, ToolTrail, foldedTools } from '../tool-card';

jest.mock('@/services/haptics', () => ({ selectionTick: jest.fn(async () => {}) }));
// lucide ships ES modules jest does not transform; the icon a row asked for is what matters here.
jest.mock('@/components/ui/g-icon', () => ({ GIcon: 'GIcon' }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function forecastDays(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(2026, 9, 27 + i);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return {
      date: iso,
      description: i % 2 === 0 ? 'Slight rain' : 'Mainly clear',
      temp_max_c: 24 + i,
      temp_min_c: 13,
      precipitation_probability_pct: i % 2 === 0 ? 60 : 5,
    };
  });
}

function tool(name: string, data: Record<string, unknown>): ToolCall {
  return {
    id: `call-${name}`,
    name: `giap-weather__${name}`,
    args: '{}',
    status: 'ok',
    result: 'Forecast for Nairobi, Kenya\n2026-10-27: Slight rain, 13-24 C',
    card: { type: 'weather', data },
  };
}

function render(tools: ToolCall[], scheme: 'light' | 'dark' = 'light'): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <InkProvider scheme={scheme} accent="Purple">
        <ToolTrail tools={tools} done />
      </InkProvider>,
    );
  });
  return tree;
}

/** Every string the tree draws, in order. */
function texts(tree: ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map((node) => {
    const children = node.props.children;
    return Array.isArray(children) ? children.join('') : String(children);
  });
}

/** The icons drawn inside a node, by name. */
function icons(node: ReactTestInstance): string[] {
  return node.findAll((n) => n.type === ('GIcon' as unknown as React.ElementType)).map((n) => n.props.name);
}

/** The forecast's rows, found by the label each one is read out by. */
function rows(tree: ReactTestRenderer) {
  return tree.root.findAll(
    (node) => typeof node.type === 'string' && node.props.accessible === true && /chance of rain|High/.test(node.props.accessibilityLabel ?? ''),
  );
}

describe('the forecast card', () => {
  it('draws one row a day under the place and the range', () => {
    const tree = render([tool('get_weather_forecast', { location: 'Nairobi, Kenya', forecast: forecastDays(7) })]);
    const drawn = texts(tree);
    expect(drawn[0]).toBe('Nairobi, Kenya');
    expect(drawn).toContain('Oct 27 – Nov 2');
    expect(rows(tree)).toHaveLength(7);
    expect(drawn).toContain('Tue, Oct 27');
    expect(drawn).toContain('Mon, Nov 2');
    expect(drawn).toContain('30°');
    expect(drawn).toContain('60%');
    expect(rows(tree)[0].props.accessibilityLabel).toBe('Tue, Oct 27, Slight rain, High 24°, Low 13°, 60% chance of rain');
    expect(icons(rows(tree)[0])).toEqual(['rain', 'droplet']);
    expect(icons(rows(tree)[1])).toEqual(['sun', 'droplet']);
    // A card, so no chip for the same tool.
    expect(tree.root.findAllByType(InkEdge)).toHaveLength(1);
    expect(drawn).not.toContain('Forecast');
  });

  it('draws a week at most and counts the days past it', () => {
    const tree = render([tool('get_weather_forecast', { location: 'Nairobi, Kenya', forecast: forecastDays(10) })]);
    expect(rows(tree)).toHaveLength(FORECAST_ROWS);
    expect(texts(tree)).toContain('3 more days');
  });

  it('names a single day without a range and leaves out what a day lacks', () => {
    const tree = render([
      tool('get_weather_forecast', {
        location: 'Kisumu',
        forecast: [{ date: '2026-10-27', description: 'Overcast', temp_max_c: 27 }],
      }),
    ]);
    const drawn = texts(tree);
    expect(drawn).toContain('Oct 27');
    expect(drawn.some((s) => s.includes('–'))).toBe(false);
    expect(drawn.some((s) => s.endsWith('%'))).toBe(false);
    expect(rows(tree)[0].props.accessibilityLabel).toBe('Tue, Oct 27, Overcast, High 27°');
  });

  it('draws the current reading as it did', () => {
    const tree = render([
      tool('get_current_weather', {
        location: 'Nairobi, Kenya',
        temperature: 19.2,
        feels_like: 20.4,
        condition: 'Mainly clear',
        humidity: 78,
        wind_speed: 8.1,
        is_day: true,
      }),
    ]);
    expect(texts(tree)).toEqual(['Nairobi, Kenya', '19°', 'Mainly clear', 'Feels like 20° · Humidity 78% · Wind 8 km/h']);
  });

  it('folds a payload with nothing to draw into the chip, never an empty card', () => {
    const empty = tool('get_weather_forecast', { location: 'Nairobi, Kenya', forecast: [] });
    const tree = render([empty]);
    expect(tree.root.findAllByType(InkEdge)).toHaveLength(0);
    expect(texts(tree)).toEqual([]);
    expect(foldedTools([empty])).toEqual([empty]);

    const bare = tool('get_current_weather', { location: 'Nairobi, Kenya' });
    expect(render([bare]).root.findAllByType(InkEdge)).toHaveLength(0);
    expect(foldedTools([bare])).toEqual([bare]);
  });

  it('keeps a drawn forecast out of the chip', () => {
    const drawn = tool('get_weather_forecast', { location: 'Nairobi, Kenya', forecast: forecastDays(3) });
    expect(foldedTools([drawn])).toEqual([]);
  });

  it('takes its ink from the theme in both schemes', () => {
    const data = { location: 'Nairobi, Kenya', forecast: forecastDays(3) };
    const colours = (['light', 'dark'] as const).map((scheme) => {
      const tree = render([tool('get_weather_forecast', data)], scheme);
      expect(rows(tree)).toHaveLength(3);
      const day = tree.root.findAllByType(Text).find((node) => node.props.children === 'Tue, Oct 27');
      return StyleSheet.flatten(day?.props.style).color as string;
    });
    expect(colours[0]).toEqual(expect.any(String));
    expect(colours[1]).toEqual(expect.any(String));
    expect(colours[0]).not.toBe(colours[1]);
  });
});
