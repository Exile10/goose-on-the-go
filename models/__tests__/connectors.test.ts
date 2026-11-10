/**
 * Connectors: the setup form is drawn from the fields the Pond names, so a field the phone does not
 * know is a text field, and a status it does not know never claims to be working.
 */

import { blankForm, categoryIcon, connectorsByCategory, inUse, missingFields, readConnector, readConnectors } from '@/models/connectors';

const wire = {
  id: 'c-mpesa',
  name: 'M-PESA statements',
  summary: 'Reads statements.',
  icon: 'wallet',
  category: 'money',
  status: 'needs_setup',
  status_detail: null,
  kind: 'mcp',
  provides: { tools: 2, events: [{ id: 'statement', label: 'A new statement' }], feeds: ['ideas', 'weather'] },
  setup: {
    fields: [
      { key: 'phone', label: 'Phone number', kind: 'text', required: true },
      { key: 'pin', label: 'Password', kind: 'secret', required: true, help: 'Stays on your Pond.' },
      { key: 'months', label: 'How far back', kind: 'select', options: ['1 month', '3 months'], required: false },
      { key: 'colour', label: 'Colour', kind: 'colour_wheel', required: false },
      { key: 'mode', label: 'Mode', kind: 'select', options: [], required: false },
      { key: 'mine', label: 'Only mine', kind: 'toggle', required: false },
    ],
    oauth: null,
  },
};

describe('reading a connector', () => {
  it('keeps its fields, reading an unknown kind and an empty select as text', () => {
    const c = readConnector(wire)!;
    expect(c.setup.fields.map((f) => f.kind)).toEqual(['text', 'secret', 'select', 'text', 'text', 'toggle']);
    expect(c.provides.feeds).toEqual(['ideas']);
    expect(c.icon).toBe('wallet');
  });

  it('reads an unknown status as not connected and an unknown category as the member’s own', () => {
    const c = readConnector({ ...wire, status: 'humming', category: 'space', icon: 'rocket' })!;
    expect(c).toMatchObject({ status: 'available', category: 'custom', icon: 'rocket' });
    expect(categoryIcon(c.category)).toBe('plug');
  });

  it('keeps an oauth link and a webhook address only when they are web addresses', () => {
    expect(readConnector({ ...wire, setup: { fields: [], oauth: 'https://accounts.example.com/auth' }, webhook_url: 'https://pond/hooks/in/abc' })).toMatchObject({
      setup: { oauth: 'https://accounts.example.com/auth' },
      webhookUrl: 'https://pond/hooks/in/abc',
    });
    expect(readConnector({ ...wire, setup: { oauth: 'intent://x' } })?.setup.oauth).toBeNull();
    expect(readConnectors({ connectors: [wire, { id: 'x' }] })).toHaveLength(1);
  });
});

describe('the form and the lists', () => {
  const c = readConnector(wire)!;
  it('starts toggles off and selects on their first option, and names the required fields left empty', () => {
    const form = blankForm(c.setup.fields);
    expect(form).toMatchObject({ phone: '', mine: false, months: '1 month' });
    expect(missingFields(c.setup.fields, { ...form, phone: '0712 345678' })).toEqual(['pin']);
  });

  it('groups by category with what needs attention first, and shows only what is in use on the strip', () => {
    const all = [
      readConnector({ ...wire, id: 'a', name: 'A', category: 'mail', status: 'available' })!,
      readConnector({ ...wire, id: 'b', name: 'B', category: 'mail', status: 'error' })!,
      readConnector({ ...wire, id: 'c', name: 'C', category: 'music', status: 'connected' })!,
    ];
    expect(connectorsByCategory(all).map((g) => [g.category, g.connectors.map((x) => x.id)])).toEqual([
      ['mail', ['b', 'a']],
      ['music', ['c']],
    ]);
    expect(inUse(all).map((x) => x.id)).toEqual(['b', 'c']);
  });
});
