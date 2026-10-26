/**
 * The vision automations view-model: the camera's rules out of all of them, the starters the pond
 * would actually produce, and what adding one does. The rules, the faces and the settings are
 * each their own view-model's business, so each is a stub here.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { FacePerson, PondSettings, Rule } from '@/services/types';
import { SAMPLE_SETTINGS } from '@/models/pond-settings';
import { useVisionAutomations, type UseVisionAutomations } from '@/view-models/use-vision-automations';

const mockRules = {
  data: { rules: [] as Rule[] },
  loading: false,
  error: null as string | null,
  failed: false,
  actions: {
    refresh: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    setPaused: jest.fn(),
  },
};
jest.mock('../use-rules', () => ({ useRules: () => mockRules }));

const mockFaces = {
  data: { available: true, defaultThreshold: 0.45, people: [] as FacePerson[], known: 0 },
  loading: false,
  failed: false,
  nameOf: (id: string) => (id === 'amina' ? 'Amina' : null),
};
jest.mock('../use-faces', () => ({ useFaces: () => mockFaces }));

const mockSettings: { settings: PondSettings | null } = { settings: null };
jest.mock('../use-pond-settings', () => ({ usePondSettings: () => mockSettings }));

const person = (over: Partial<FacePerson> = {}): FacePerson => ({
  profile_id: 'amina', name: 'Amina', enrollments: 3, threshold: null, last_enrolled_at: null, ...over,
});

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1', name: 'x', paused: false, currently_running: false, created_at: 't', last_fired: null, cooldown_secs: 60,
  source: { kind: 'camera', signal: 'package' }, actions: [{ type: 'notify', title: 'a', body: 'b' }], ...over,
});

const mounted: ReactTestRenderer[] = [];
async function mount(): Promise<{ readonly vm: UseVisionAutomations; rerender: () => Promise<void> }> {
  let latest!: UseVisionAutomations;
  const Probe = () => {
    latest = useVisionAutomations();
    return null;
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe />);
    mounted.push(tree);
  });
  return { get vm() { return latest; }, rerender: async () => act(async () => tree.update(<Probe />)) };
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRules.data.rules = [];
  mockRules.loading = false;
  mockRules.error = null;
  mockRules.failed = false;
  mockFaces.data = { available: true, defaultThreshold: 0.45, people: [person()], known: 1 };
  mockFaces.loading = false;
  mockFaces.failed = false;
  mockSettings.settings = { ...SAMPLE_SETTINGS };
  mockRules.actions.create.mockResolvedValue(null);
});

afterEach(async () => {
  for (const tree of mounted.splice(0)) await act(async () => tree.unmount());
});

describe('the rules', () => {
  it('keeps the ones that listen to a camera, and none of the rest', async () => {
    mockRules.data.rules = [
      rule({ id: 'a', source: { kind: 'camera', signal: 'pet' } }),
      rule({ id: 'b', source: { kind: 'sensor', signal: 'temperature' } }),
      rule({ id: 'c', source: { kind: 'device', signal: 'power' } }),
    ];
    const m = await mount();
    expect(m.vm.data.rules.map((r) => r.id)).toEqual(['a']);
  });

  it('names a person from a face signal through the faces', async () => {
    const m = await mount();
    expect(m.vm.data.nameOf('amina')).toBe('Amina');
  });

  it('passes the rules’ own loading and failure on, and their actions through', async () => {
    mockRules.loading = true;
    mockRules.error = 'busy';
    mockRules.failed = true;
    const m = await mount();
    expect(m.vm.loading).toBe(true);
    expect(m.vm.error).toBe('busy');
    expect(m.vm.failed).toBe(true);
    expect(m.vm.actions.update).toBe(mockRules.actions.update);
    expect(m.vm.actions.setPaused).toBe(mockRules.actions.setPaused);
  });
});

describe('the starters', () => {
  it('offers them built from what the pond watches for and who it knows', async () => {
    const m = await mount();
    expect(m.vm.data.starters.map((s) => s.id)).toEqual(['unknown-face', 'package', 'greet:amina', 'night']);
    expect(m.vm.data.peopleBlock).toBeNull();
  });

  it('offers none before the settings are known, rather than some that then go', async () => {
    mockSettings.settings = null;
    const m = await mount();
    expect(m.vm.data.starters).toEqual([]);
  });

  it('offers none while the faces or the rules are still loading, or the faces could not be read', async () => {
    mockFaces.loading = true;
    expect((await mount()).vm.data.starters).toEqual([]);
    mockFaces.loading = false;
    mockFaces.failed = true;
    expect((await mount()).vm.data.starters).toEqual([]);
    mockFaces.failed = false;
    mockRules.loading = true;
    expect((await mount()).vm.data.starters).toEqual([]);
  });

  it('leaves out a kind the pond is not watching for', async () => {
    mockSettings.settings = { ...SAMPLE_SETTINGS, vision_event_types: ['motion'] };
    const m = await mount();
    expect(m.vm.data.starters.map((s) => s.id)).toEqual(['night']);
  });

  it('says why none about a person is offered', async () => {
    mockSettings.settings = { ...SAMPLE_SETTINGS, vision_face_recognition_enabled: false };
    expect((await mount()).vm.data.peopleBlock).toBe('recognitionOff');
    mockSettings.settings = { ...SAMPLE_SETTINGS };
    mockFaces.data = { ...mockFaces.data, people: [person({ enrollments: 0 })] };
    expect((await mount()).vm.data.peopleBlock).toBe('nobody');
    mockFaces.data = { ...mockFaces.data, available: false };
    expect((await mount()).vm.data.peopleBlock).toBe('unavailable');
  });

  it('says nothing about people while it does not yet know', async () => {
    mockSettings.settings = null;
    expect((await mount()).vm.data.peopleBlock).toBeNull();
  });

  it('stops offering one once a rule for it exists', async () => {
    const m = await mount();
    expect(m.vm.data.starters.map((s) => s.id)).toContain('package');

    mockRules.data.rules = [rule({ source: { kind: 'camera', signal: 'package' } })];
    await m.rerender();

    expect(m.vm.data.starters.map((s) => s.id)).not.toContain('package');
  });
});

describe('adding a starter', () => {
  it('creates the rule the starter describes, and says so', async () => {
    const m = await mount();
    const starter = m.vm.data.starters.find((s) => s.id === 'package')!;

    let added = false;
    await act(async () => {
      added = await m.vm.actions.add(starter);
    });

    expect(mockRules.actions.create).toHaveBeenCalledWith(starter.request);
    expect(added).toBe(true);
    expect(m.vm.addError).toBeNull();
    expect(m.vm.adding.size).toBe(0);
  });

  it('holds its button while the pond answers', async () => {
    let finish!: (refusal: string | null) => void;
    mockRules.actions.create.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const m = await mount();
    const starter = m.vm.data.starters[0];

    let pending!: Promise<boolean>;
    await act(async () => {
      pending = m.vm.actions.add(starter);
    });
    expect(m.vm.adding.has(starter.id)).toBe(true);

    await act(async () => {
      finish(null);
      await pending;
    });
    expect(m.vm.adding.has(starter.id)).toBe(false);
  });

  it('says why the pond refused, and reports that nothing was added', async () => {
    mockRules.actions.create.mockResolvedValue('The scheduler is not running.');
    const m = await mount();

    let added = true;
    await act(async () => {
      added = await m.vm.actions.add(m.vm.data.starters[0]);
    });

    expect(added).toBe(false);
    expect(m.vm.addError).toBe('The scheduler is not running.');
  });
});
