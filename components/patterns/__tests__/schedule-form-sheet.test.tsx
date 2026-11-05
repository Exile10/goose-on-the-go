/**
 * Where the form offers "Ask me if it's missed" (#168): on every repeat, not only a custom cron, and
 * never on a one-off, which the Pond runs late on its own.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import i18n from '@/services/i18n';

import { ScheduleFormSheet } from '../schedule-form-sheet';

jest.mock('@/components/ui/g-icon', () => ({ GIcon: () => null }));
jest.mock('@/components/patterns/routine-devices', () => ({ RoutineDevices: () => null }));

function texts(tree: ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(''));
}

function press(tree: ReactTestRenderer, label: string) {
  const target = tree.root.findAll((node) => typeof node.props.onPress === 'function' && texts({ root: node } as never).includes(label))[0];
  act(() => target.props.onPress());
}

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<ScheduleFormSheet open onClose={() => {}} onCreate={async () => null} asksIfMissed />);
  });
  return tree;
}

describe("the form's missed-run switch", () => {
  const asks = i18n.t('schedule.form.askIfMissed');

  it('is not offered for a one-off', () => {
    expect(texts(render())).not.toContain(asks);
  });

  it.each(['hourly', 'daily', 'weekly', 'monthly', 'custom'] as const)('is offered on a %s repeat', (timing) => {
    const tree = render();
    press(tree, i18n.t(`schedule.form.${timing}`));
    expect(texts(tree)).toContain(asks);
  });
});
