/**
 * Owner setup has to write exactly what pond-desktop's wizard writes, or a Pond set up from a phone
 * reads differently from one set up at a desk. The keys are pinned against `useOnboardingPersist.ts`.
 */

import {
  calibrationPrompts,
  defaultDraft,
  draftFromPond,
  firstStepFor,
  profilePrefs,
  resumeIndex,
  settingsPatch,
  shortPhraseSuggestion,
  wakePhrase,
  wakePhraseProblem,
  writesProfile,
} from '@/models/owner-setup';

const draft = (change: Partial<ReturnType<typeof defaultDraft>> = {}) => ({ ...defaultDraft('Africa/Nairobi'), ...change });

describe('resuming', () => {
  it('opens on the step after the furthest one the Pond recorded', () => {
    expect(resumeIndex('not_started')).toBe(0);
    expect(resumeIndex('Welcome')).toBe(1);
    expect(resumeIndex('Basics')).toBe(2);
    expect(resumeIndex('Location')).toBe(3);
    expect(resumeIndex('GooseIdentity')).toBe(4);
    expect(resumeIndex('WakeWord')).toBe(5);
  });

  it('folds the steps the desktop merged into the screen that holds them', () => {
    expect(resumeIndex('Accessibility')).toBe(resumeIndex('Basics'));
    expect(resumeIndex('Personality')).toBe(resumeIndex('GooseIdentity'));
  });

  it('never runs past the last screen, and starts over on a name it does not know', () => {
    expect(resumeIndex('Extensions')).toBe(5);
    expect(resumeIndex('Completed')).toBe(5);
    expect(resumeIndex('Somewhere')).toBe(0);
    expect(resumeIndex(null)).toBe(0);
  });
});

describe('what each step writes', () => {
  it('writes the desktop’s settings keys and no others', () => {
    const d = draft({ userName: ' Amina ', assistantName: ' Bata ', ttsVoice: 'bf_emma', ttsSpeed: 1.2, wakeWord: 'hey goose' });
    expect(settingsPatch('welcome', d)).toBeNull();
    expect(settingsPatch('about-you', d)).toEqual({ user_name: 'Amina' });
    expect(settingsPatch('locale', d)).toEqual({ timezone: 'Africa/Nairobi', weather_location_name: '', weather_enabled: false });
    expect(settingsPatch('personality', d)).toEqual({
      prompt_style: 'balanced',
      assistant_personality: 'friendly and helpful',
      assistant_name: 'Bata',
      voice_tts_voice: 'bf_emma',
      voice_tts_speed: 1.2,
    });
    expect(settingsPatch('wake-word', d)).toEqual({ voice_wake_word: 'hey goose' });
    expect(settingsPatch('complete', d)).toEqual({ agent_memory_inject: true });
  });

  it('leaves coordinates out until something has found some', () => {
    expect(settingsPatch('locale', draft())).not.toHaveProperty('weather_latitude');
    expect(settingsPatch('locale', draft({ latitude: -1.29, longitude: 36.82 }))).toMatchObject({
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
    expect(writesProfile('locale')).toBe(true);
    expect(writesProfile('personality')).toBe(false);
  });

  it('stores a custom phrase as typed and a preset as itself', () => {
    expect(wakePhrase(draft({ wakeWord: 'custom', wakeWordCustom: '  hey duck ' }))).toBe('hey duck');
    expect(wakePhrase(draft({ wakeWord: 'ok computer', wakeWordCustom: 'ignored' }))).toBe('ok computer');
  });
});

describe('filling the draft back in', () => {
  // What GET /settings would say on a Pond nobody has touched.
  const fresh = { user_name: 'Friend', assistant_name: 'Goose', timezone: 'UTC', voice_wake_word: 'goose', voice_tts_voice: '' };

  it('does not take a fresh Pond’s defaults for anybody’s answers', () => {
    const d = draftFromPond(draft(), fresh, 1);
    expect(d.userName).toBe('');
    expect(d.timezone).toBe('Africa/Nairobi');
  });

  it('takes the Pond’s record for the steps it recorded', () => {
    const d = draftFromPond(draft(), { ...fresh, user_name: 'Amina', timezone: 'Europe/London', voice_wake_word: 'hey duck' }, 5);
    expect(d.userName).toBe('Amina');
    expect(d.timezone).toBe('Europe/London');
    expect(d.wakeWord).toBe('custom');
    expect(d.wakeWordCustom).toBe('hey duck');
    expect(d.ttsVoice).toBe('af_heart');
  });
});

describe('finishing', () => {
  it('goes back to the earliest step that sets a missing field', () => {
    expect(firstStepFor(['assistant_name', 'user_name'])).toBe('about-you');
    expect(firstStepFor(['timezone'])).toBe('locale');
    expect(firstStepFor(['assistant_name'])).toBe('personality');
  });

  it('has no step to send anyone to for a missing chat model', () => {
    expect(firstStepFor(['chat_model'])).toBeNull();
    expect(firstStepFor(['chat_model', 'timezone'])).toBe('locale');
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

  it('reads the Pond’s own five calibration sentences', () => {
    expect(calibrationPrompts(' goose ')).toEqual([
      'goose',
      'Hey goose, good morning',
      'OK goose, what time is it',
      'goose, tell me a joke',
      'Thank you goose',
    ]);
  });
});
