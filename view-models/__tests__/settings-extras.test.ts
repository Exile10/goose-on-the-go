/**
 * What each menu row says it is set to, and the lists some controls choose from.
 */

import i18n from '@/services/i18n';
import type { TFunction } from 'i18next';

import { SAMPLE_SETTINGS } from '@/models/pond-settings';
import type { ModelEntry, ZoneChoice } from '@/services/types';
import {
  chatModelTitle,
  providerChoices,
  searchZones,
  summarize,
  voiceChoices,
  type Extras,
} from '@/view-models/use-settings-extras';

const t = i18n.t as unknown as TFunction;
const extras: Extras = { remoteEnabled: false, webSearch: 'ok', chatModel: 'qwen3-4b', extensions: 2, people: 3, theme: 'system' };

describe('menu values', () => {
  it('says how each setting stands', () => {
    expect(summarize('remoteAccess', SAMPLE_SETTINGS, extras, t)).toBe('Off');
    expect(summarize('internet', SAMPLE_SETTINGS, extras, t)).toBe('Open');
    expect(summarize('voice', SAMPLE_SETTINGS, extras, t)).toBe('“goose”');
    expect(summarize('tools', SAMPLE_SETTINGS, extras, t)).toBe('7 of 10 on');
    expect(summarize('people', SAMPLE_SETTINGS, extras, t)).toBe('3 people');
    expect(summarize('privacy', { ...SAMPLE_SETTINGS, mic_enabled: false }, extras, t)).toBe('Microphone off');
    expect(summarize('appearance', SAMPLE_SETTINGS, extras, t)).toBe('Match this phone');
  });

  it('names quiet hours only when Goose may speak up', () => {
    expect(summarize('announcements', SAMPLE_SETTINGS, extras, t)).toBe('Off');
    expect(summarize('announcements', { ...SAMPLE_SETTINGS, unprompted_speech_enabled: true }, extras, t)).toBe('Quiet 22:00–07:00');
  });

  it('shows nothing for a setting it has not read, rather than a guess', () => {
    expect(summarize('memory', null, extras, t)).toBeNull();
    expect(summarize('people', null, { ...extras, people: null }, t)).toBeNull();
  });

  it('leaves web search blank on a Pond without it, and says when its key was refused', () => {
    expect(summarize('webSearch', SAMPLE_SETTINGS, { ...extras, webSearch: 'unsupported' }, t)).toBeNull();
    expect(summarize('webSearch', SAMPLE_SETTINGS, { ...extras, webSearch: 'rejected' }, t)).toBe('Needs a key');
  });

  it('reads the chat model from either shape the Pond answers with', () => {
    expect(chatModelTitle({ chat: { provider: 'local', model: 'qwen3-4b', model_id: 'gguf/qwen3-4b' } })).toBe('qwen3-4b');
    expect(chatModelTitle({ chat: 'qwen3-4b' })).toBe('qwen3-4b');
    expect(chatModelTitle({ chat: null })).toBeNull();
    expect(chatModelTitle(undefined)).toBeNull();
  });
});

describe('choices', () => {
  const model = (category: ModelEntry['category'], name: string, downloaded = true): ModelEntry => ({
    id: `${category}:${name}`, category, name, downloaded, active: false,
  });

  it('offers only engines this Pond has a model for', () => {
    expect(providerChoices([model('gguf', 'a'), model('ollama', 'b'), model('whisper', 'c')], false)).toEqual(['local', 'ollama']);
    expect(providerChoices([model('gguf', 'a', false)], false)).toEqual([]);
    expect(providerChoices([], true)).toEqual(['mesh']);
  });

  it('lists every voice, marking the ones still to download', () => {
    expect(voiceChoices([model('tts', 'af_heart'), model('tts', 'bf_emma', false), model('gguf', 'x')])).toEqual([
      { id: 'af_heart', installed: true },
      { id: 'bf_emma', installed: false },
    ]);
  });

  it('finds a time zone by city, zone or offset', () => {
    const zones: ZoneChoice[] = [
      { zone: 'Africa/Nairobi', offset: '+03:00', place: 'Nairobi' },
      { zone: 'America/New_York', offset: '-04:00', place: 'New York' },
    ];
    expect(searchZones(zones, 'nairobi').map((z) => z.zone)).toEqual(['Africa/Nairobi']);
    expect(searchZones(zones, 'new_york').map((z) => z.zone)).toEqual(['America/New_York']);
    expect(searchZones(zones, '-04')).toHaveLength(1);
    expect(searchZones(zones, '  ')).toHaveLength(2);
  });
});
