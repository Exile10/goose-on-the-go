/**
 * Owner setup has to write exactly what pond-desktop's wizard writes, or a Pond set up from a phone
 * reads differently from one set up at a desk. The keys are pinned against `useOnboardingPersist.ts`.
 */

import {
  birthdayOf,
  canContinue,
  defaultDraft,
  draftFromPond,
  finishPatch,
  firstStepFor,
  profilePrefs,
  resumeIndex,
  settingsPatch,
  setupLanguageFor,
  setupNote,
  shortPhraseSuggestion,
  stepRecords,
  wakeChoiceValid,
  wakeDraftFrom,
  wakePhrase,
  wakePhraseProblem,
  writesProfile,
} from '@/models/owner-setup';

const draft = (change: Partial<ReturnType<typeof defaultDraft>> = {}) => ({ ...defaultDraft('Africa/Nairobi'), ...change });

describe('resuming', () => {
  it('opens on the step after the furthest one the Pond recorded', () => {
    expect(resumeIndex('not_started')).toBe(0);
    expect(resumeIndex('Location')).toBe(1);
    expect(resumeIndex('GooseIdentity')).toBe(1);
  });

  it('asks About you again when only part of it was recorded, by an older build', () => {
    expect(resumeIndex('Welcome')).toBe(0);
    expect(resumeIndex('Basics')).toBe(0);
    expect(resumeIndex('Accessibility')).toBe(0);
  });

  it('reopens anything past How Goose talks there, where finishing is', () => {
    for (const step of ['Personality', 'WakeWord', 'Model', 'Extensions', 'Completed']) expect(resumeIndex(step)).toBe(1);
    expect(resumeIndex('Somewhere')).toBe(0);
    expect(resumeIndex(null)).toBe(0);
  });

  it('records the desktop’s steps each screen stands for', () => {
    expect(stepRecords('about-you')).toEqual(['Basics', 'Location']);
    expect(stepRecords('personality')).toEqual(['GooseIdentity']);
    expect(stepRecords('model')).toEqual(['Model']);
  });
});

describe('what each step writes', () => {
  it('writes the desktop’s settings keys and no others', () => {
    const d = draft({ userName: ' Amina ', assistantName: ' Bata ', ttsVoice: 'bf_emma', ttsSpeed: 1.2, wakeWord: 'hey goose' });
    expect(settingsPatch('about-you', d)).toEqual({
      user_name: 'Amina',
      timezone: 'Africa/Nairobi',
      weather_location_name: '',
      weather_enabled: false,
    });
    expect(settingsPatch('personality', d)).toEqual({
      prompt_style: 'balanced',
      assistant_personality: 'friendly and helpful',
      assistant_name: 'Bata',
      voice_tts_voice: 'bf_emma',
      voice_tts_speed: 1.2,
    });
    expect(settingsPatch('model', d)).toBeNull();
    expect(finishPatch(d)).toEqual({ agent_memory_inject: true });
  });

  it('leaves coordinates out until something has found some', () => {
    expect(settingsPatch('about-you', draft())).not.toHaveProperty('weather_latitude');
    expect(settingsPatch('about-you', draft({ latitude: -1.29, longitude: 36.82 }))).toMatchObject({
      weather_latitude: -1.29,
      weather_longitude: 36.82,
    });
  });

  it('sends the whole preference map, since the Pond replaces it, with flags as strings and empties dropped', () => {
    expect(profilePrefs(draft({ preferredName: ' Ami ', atypicalSpeech: true, language: 'sw' }))).toEqual({
      preferred_name: 'Ami',
      language: 'sw',
      accessibility_atypical_speech: 'true',
      accessibility_slow_speech: 'false',
    });
    expect(writesProfile('about-you')).toBe(true);
    expect(writesProfile('personality')).toBe(false);
  });

  it('asks for a name and a zone before About you is saved', () => {
    expect(canContinue('about-you', draft())).toBe(false);
    expect(canContinue('about-you', draft({ userName: 'Amina' }))).toBe(true);
    expect(canContinue('about-you', draft({ userName: 'Amina', timezone: ' ' }))).toBe(false);
  });

  it('stores a custom phrase as typed and a preset as itself', () => {
    expect(wakePhrase(draft({ wakeWord: 'custom', wakeWordCustom: '  hey duck ' }))).toBe('hey duck');
    expect(wakePhrase(draft({ wakeWord: 'ok computer', wakeWordCustom: 'ignored' }))).toBe('ok computer');
  });
});

describe('starting from the phone', () => {
  it('takes the phone’s language when the desktop offers it, else English', () => {
    expect(setupLanguageFor(['sw-KE', 'en-GB'])).toBe('sw');
    expect(setupLanguageFor(['nl-NL', 'fr-BE'])).toBe('fr');
    expect(setupLanguageFor(['nl-NL'])).toBe('en');
    expect(setupLanguageFor([])).toBe('en');
    expect(defaultDraft('Africa/Nairobi', 'sw').language).toBe('sw');
  });
});

describe('filling the draft back in', () => {
  // What GET /settings would say on a Pond nobody has touched.
  const fresh = { user_name: 'Friend', assistant_name: 'Goose', timezone: 'UTC', voice_wake_word: 'goose', voice_tts_voice: '' };

  it('does not take a fresh Pond’s defaults for anybody’s answers', () => {
    expect(draftFromPond(draft(), fresh, 0).userName).toBe('');
  });

  it('takes the Pond’s record for the steps it recorded', () => {
    const d = draftFromPond(draft(), { ...fresh, user_name: 'Amina', timezone: 'Europe/London', voice_wake_word: 'hey duck' }, 1);
    expect(d.userName).toBe('Amina');
    expect(d.timezone).toBe('Europe/London');
    expect(d.ttsVoice).toBe('af_heart');
  });

  it('reads the wake phrase the Pond holds as a preset or a phrase of its own', () => {
    expect(wakeDraftFrom('hey duck')).toEqual({ wakeWord: 'custom', wakeWordCustom: 'hey duck' });
    expect(wakeDraftFrom('ok computer')).toEqual({ wakeWord: 'ok computer', wakeWordCustom: '' });
    expect(wakeDraftFrom(null)).toEqual({ wakeWord: 'hey goose', wakeWordCustom: '' });
    expect(wakeChoiceValid({ wakeWord: 'custom', wakeWordCustom: 'a' })).toBe(false);
  });
});

describe('finishing', () => {
  it('goes back to the earliest step that sets a missing field', () => {
    expect(firstStepFor(['assistant_name', 'user_name'])).toBe('about-you');
    expect(firstStepFor(['timezone'])).toBe('about-you');
    expect(firstStepFor(['assistant_name'])).toBe('personality');
  });

  it('opens the model step for a missing chat model, and only after the others', () => {
    expect(firstStepFor(['chat_model'])).toBe('model');
    expect(firstStepFor(['chat_model', 'timezone'])).toBe('about-you');
    expect(firstStepFor(['nonsense'])).toBeNull();
  });

  it('leaves what was typed under Assistant notes as one note, and nothing when it was left blank', () => {
    expect(setupNote(draft({ notes: '  Always answer in Swahili.\n' }))).toEqual({
      key: 'house_notes',
      instruction: 'Always answer in Swahili.',
      active: true,
      sort_order: 0,
    });
    expect(setupNote(draft({ notes: ' \n ' }))).toBeNull();
    expect(setupNote(draft())).toBeNull();
  });
});

describe('the wake phrase', () => {
  it('refuses what the Pond’s check refuses', () => {
    expect(wakePhraseProblem('hey goose')).toBeNull();
    expect(wakePhraseProblem("o'malley-ann")).toBeNull();
    expect(wakePhraseProblem('hey goose 2')).toBe('characters');
    expect(wakePhraseProblem('one two three four five')).toBe('length');
    expect(wakePhraseProblem('a')).toBe('tooShort');
  });

  it('suggests the "hey" form of a phrase likely to wake by accident', () => {
    expect(shortPhraseSuggestion('duck')).toBe('hey duck');
    expect(shortPhraseSuggestion('hey')).toBe('');
    // The desktop's estimate puts "hey goose" at five sounds, under the six it asks for.
    expect(shortPhraseSuggestion('hey goose')).toBe('');
    expect(shortPhraseSuggestion('good morning pond')).toBeNull();
    expect(shortPhraseSuggestion('hey goose 2')).toBeNull();
  });
});

describe('a birthday', () => {
  it('is the date typed, zero-padded as the desktop stores it', () => {
    expect(birthdayOf({ year: '1990', month: '3', day: '7' }, 2026)).toBe('1990-03-07');
  });

  it('is held back until it is a date that exists, rather than moved to one', () => {
    expect(birthdayOf({ year: '1990', month: '2', day: '30' }, 2026)).toBeNull();
    expect(birthdayOf({ year: '2000', month: '2', day: '29' }, 2026)).toBe('2000-02-29');
    expect(birthdayOf({ year: '1990', month: '', day: '7' }, 2026)).toBeNull();
    expect(birthdayOf({ year: '2031', month: '3', day: '7' }, 2026)).toBeNull();
    expect(birthdayOf({ year: '1850', month: '3', day: '7' }, 2026)).toBeNull();
  });
});
