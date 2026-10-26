/**
 * What the automation form offers a camera rule to listen for: every signal, each person by name,
 * and the cameras when there are several.
 */

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { SAMPLE_SETTINGS } from '@/models/pond-settings';
import { api } from '@/services/api-client';
import type { FacePerson, PondSettings } from '@/services/types';
import { useVisionSignals, type UseVisionSignals } from '@/view-models/use-vision-signals';

jest.mock('@/services/pond-trust', () => ({ assertPondTrust: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/services/api-client', () => ({ api: { listCameras: jest.fn() } }));

const server = { hydrated: true };
jest.mock('@/providers/server-provider', () => ({ useServer: () => ({ hydrated: server.hydrated }) }));

const faces = {
  data: { people: [] as FacePerson[] },
  nameOf: (id: string) => (id === 'amina' ? 'Amina' : null),
};
jest.mock('../use-faces', () => ({ useFaces: () => faces }));

const settings: { settings: PondSettings | null } = { settings: null };
jest.mock('../use-pond-settings', () => ({ usePondSettings: () => settings }));

const pond = jest.mocked(api);
const mounted: ReactTestRenderer[] = [];

async function mount(): Promise<{ readonly vm: UseVisionSignals }> {
  let latest!: UseVisionSignals;
  const Probe = () => {
    latest = useVisionSignals();
    return null;
  };
  await act(async () => {
    mounted.push(create(<Probe />));
  });
  return { get vm() { return latest; } };
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  jest.resetAllMocks();
  server.hydrated = true;
  faces.data = { people: [{ profile_id: 'amina', name: 'Amina', enrollments: 2, threshold: null, last_enrolled_at: null }] };
  settings.settings = { ...SAMPLE_SETTINGS };
  pond.listCameras.mockResolvedValue([]);
});

afterEach(async () => {
  for (const tree of mounted.splice(0)) await act(async () => tree.unmount());
});

it('offers each signal, then each person by name', async () => {
  const m = await mount();
  expect(m.vm.options.map((o) => o.value)).toEqual([
    '', 'motion', 'person', 'pet', 'vehicle', 'package', 'face_detected', 'face_recognized', 'face_unknown', 'face:amina',
  ]);
  expect(m.vm.options.at(-1)?.label).toBe('Amina');
  expect(m.vm.nameOf('amina')).toBe('Amina');
});

it('marks a kind the pond is not watching for', async () => {
  settings.settings = { ...SAMPLE_SETTINGS, vision_event_types: ['motion'] };
  const m = await mount();
  const byValue = Object.fromEntries(m.vm.options.map((o) => [o.value, o]));
  expect(byValue.motion.hint).toBeNull();
  expect(byValue.package.hint).toContain('Not being watched');
});

it('still offers the signals before the settings are read, with everything counted as watched', async () => {
  settings.settings = null;
  const m = await mount();
  expect(m.vm.options.filter((o) => o.hint?.includes('Not being watched'))).toEqual([]);
});

it('reads the cameras once when the form opens', async () => {
  pond.listCameras.mockResolvedValue([
    { id: 'camera-1', live: true, last_frame_at: null, snapshot_url: null, stream_url: null },
    { id: 'garage', live: false, last_frame_at: null, snapshot_url: null, stream_url: null },
  ]);
  const m = await mount();
  expect(m.vm.cameras).toEqual(['camera-1', 'garage']);
  expect(pond.listCameras).toHaveBeenCalledTimes(1);
});

it('asks for nothing before the connection has hydrated', async () => {
  server.hydrated = false;
  await mount();
  expect(pond.listCameras).not.toHaveBeenCalled();
});

it('still offers the signals when the cameras cannot be read', async () => {
  pond.listCameras.mockRejectedValue(new Error('offline'));
  const m = await mount();
  expect(m.vm.cameras).toEqual([]);
  expect(m.vm.options.length).toBeGreaterThan(8);
});
