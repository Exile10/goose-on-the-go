// pond-desktop's onboarding wizard as data, copied from its `onboarding.constants.ts` and
// `useOnboardingPersist.ts` so a Pond set up from either screen reads the same.

import type { TranslationKey } from '@/services/i18n';
import type { PondSettings } from '@/services/types';

export const SETUP_STEPS = ['welcome', 'about-you', 'locale', 'personality', 'wake-word', 'complete'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export function stepLabelKey(step: SetupStep): TranslationKey {
  switch (step) {
    case 'welcome':
      return 'setup.steps.welcome';
    case 'about-you':
      return 'setup.steps.aboutYou';
    case 'locale':
      return 'setup.steps.locale';
    case 'personality':
      return 'setup.steps.personality';
    case 'wake-word':
      return 'setup.steps.wakeWord';
    case 'complete':
      return 'setup.steps.complete';
  }
}

/** A required step has no Skip: the Pond refuses to finish without what it sets. */
export function isRequired(step: SetupStep): boolean {
  return step === 'about-you' || step === 'locale';
}

/** The backend `OnboardingStep` each step records once it is saved, as the desktop sends them. */
export const STEP_TO_BACKEND: Record<SetupStep, string> = {
  welcome: 'Welcome',
  'about-you': 'Basics',
  locale: 'Location',
  personality: 'GooseIdentity',
  'wake-word': 'WakeWord',
  complete: 'Extensions',
};

// Ten backend steps fold into six screens; Accessibility and Personality were merged on the desktop.
const BACKEND_TO_INDEX: Record<string, number> = {
  Welcome: 0,
  Basics: 1,
  Accessibility: 1,
  Location: 2,
  Personality: 3,
  GooseIdentity: 3,
  WakeWord: 4,
  Model: 5,
  Extensions: 5,
  Completed: 5,
};

/** The screen after the furthest one the Pond recorded: a recorded step was saved, so it is not asked again. */
export function resumeIndex(backendStep: string | null | undefined): number {
  const done = backendStep ? BACKEND_TO_INDEX[backendStep] : undefined;
  if (done === undefined) return 0;
  return Math.min(done + 1, SETUP_STEPS.length - 1);
}

export const PROMPT_STYLES = ['balanced', 'concise', 'technical', 'warm'] as const;
export type PromptStyle = (typeof PROMPT_STYLES)[number];

export const WAKE_PRESETS = ['goose', 'hey goose', 'ok computer', 'custom'] as const;
export type WakePreset = (typeof WAKE_PRESETS)[number];

/** The desktop's language list. Names are each language's own, so they are not translated. */
export const SETUP_LANGUAGES = [
  { key: 'en', name: 'English' },
  { key: 'fr', name: 'Français' },
  { key: 'es', name: 'Español' },
  { key: 'de', name: 'Deutsch' },
  { key: 'sw', name: 'Kiswahili' },
  { key: 'pt', name: 'Português' },
  { key: 'ja', name: '日本語' },
  { key: 'zh', name: '中文' },
] as const;

/** This phone's zone, which is nearly always the home's. */
export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The smallest speaking tier, the desktop's choice for setup: it leaves the chat model its memory. */
export const SETUP_VOICE_QUALITY = 'q8f16';

export interface SetupDraft {
  userName: string;
  preferredName: string;
  /** `YYYY-MM-DD`, or empty. */
  birthday: string;
  atypicalSpeech: boolean;
  slowSpeech: boolean;
  language: string;
  timezone: string;
  locationName: string;
  /** Filled by detection. 0/0 means unset, not the Gulf of Guinea. */
  latitude: number;
  longitude: number;
  enableWeather: boolean;
  promptStyle: string;
  personality: string;
  assistantName: string;
  ttsVoice: string;
  /** The engine's multiplier, 0.5 to 2. */
  ttsSpeed: number;
  wakeWord: string;
  wakeWordCustom: string;
  enableMemory: boolean;
}

export function defaultDraft(deviceZone: string): SetupDraft {
  return {
    userName: '',
    preferredName: '',
    birthday: '',
    atypicalSpeech: false,
    slowSpeech: false,
    language: 'en',
    timezone: deviceZone || 'UTC',
    locationName: '',
    latitude: 0,
    longitude: 0,
    enableWeather: false,
    promptStyle: 'balanced',
    personality: 'friendly and helpful',
    assistantName: 'Goose',
    ttsVoice: 'af_heart',
    ttsSpeed: 1,
    wakeWord: 'goose',
    wakeWordCustom: '',
    enableMemory: true,
  };
}

/** The `profiles.preferences` keys the Pond's `particulars_for` reads, as the desktop names them. */
export const PROFILE_PREF_KEYS = {
  preferredName: 'preferred_name',
  birthday: 'birthday',
  language: 'language',
  atypicalSpeech: 'accessibility_atypical_speech',
  slowSpeech: 'accessibility_slow_speech',
} as const;

/** The Pond's record for the steps it recorded and `base` for the rest: a fresh Pond's "Friend" is nobody's name. */
export function draftFromPond(base: SetupDraft, settings: Partial<PondSettings> | null, resumeAt: number): SetupDraft {
  const s = settings ?? {};
  const saved = (step: SetupStep) => SETUP_STEPS.indexOf(step) < resumeAt;
  const next = { ...base };
  if (saved('about-you') && s.user_name) next.userName = s.user_name;
  if (saved('locale')) {
    if (s.timezone) next.timezone = s.timezone;
    next.locationName = s.weather_location_name ?? next.locationName;
    next.enableWeather = s.weather_enabled ?? next.enableWeather;
  }
  if (saved('personality')) {
    next.promptStyle = s.prompt_style || next.promptStyle;
    next.personality = s.assistant_personality || next.personality;
    next.assistantName = s.assistant_name || next.assistantName;
    next.ttsVoice = s.voice_tts_voice || next.ttsVoice;
    next.ttsSpeed = s.voice_tts_speed || next.ttsSpeed;
  }
  if (saved('wake-word') && s.voice_wake_word) {
    const preset = (WAKE_PRESETS as readonly string[]).includes(s.voice_wake_word);
    next.wakeWord = preset ? s.voice_wake_word : 'custom';
    next.wakeWordCustom = preset ? next.wakeWordCustom : s.voice_wake_word;
  }
  return next;
}

/** The phrase the Pond will listen for. */
export function wakePhrase(draft: Pick<SetupDraft, 'wakeWord' | 'wakeWordCustom'>): string {
  return draft.wakeWord === 'custom' ? draft.wakeWordCustom.trim() : draft.wakeWord;
}

/** `PUT /settings` per step, key for key with the desktop. */
export function settingsPatch(step: SetupStep, draft: SetupDraft): Partial<PondSettings> | null {
  switch (step) {
    case 'about-you':
      return { user_name: draft.userName.trim() };
    case 'locale':
      return {
        timezone: draft.timezone,
        weather_location_name: draft.locationName,
        weather_enabled: draft.enableWeather,
        // Sending 0/0 would overwrite coordinates the Pond already geocoded.
        ...(draft.latitude !== 0 || draft.longitude !== 0
          ? { weather_latitude: draft.latitude, weather_longitude: draft.longitude }
          : {}),
      };
    case 'personality':
      return {
        prompt_style: draft.promptStyle,
        assistant_personality: draft.personality,
        assistant_name: draft.assistantName.trim(),
        voice_tts_voice: draft.ttsVoice,
        voice_tts_speed: draft.ttsSpeed,
      };
    case 'wake-word':
      return { voice_wake_word: wakePhrase(draft) };
    case 'complete':
      return { agent_memory_inject: draft.enableMemory };
    default:
      return null;
  }
}

/** The steps that write the owner's profile preferences: About you, and Language for its language. */
export function writesProfile(step: SetupStep): boolean {
  return step === 'about-you' || step === 'locale';
}

/** The whole preference map, since a PATCH replaces it: strings, flags as `"true"`, empties dropped. */
export function profilePrefs(draft: SetupDraft): Record<string, string> {
  const raw: Record<string, string> = {
    [PROFILE_PREF_KEYS.preferredName]: draft.preferredName.trim(),
    [PROFILE_PREF_KEYS.birthday]: draft.birthday.trim(),
    [PROFILE_PREF_KEYS.language]: draft.language,
    [PROFILE_PREF_KEYS.atypicalSpeech]: draft.atypicalSpeech ? 'true' : 'false',
    [PROFILE_PREF_KEYS.slowSpeech]: draft.slowSpeech ? 'true' : 'false',
  };
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
}

export type WakeProblem = 'characters' | 'length' | 'tooShort';

/** Why a phrase cannot be stored, mirroring the Pond's `Check::WakePhrase` as the desktop does. */
export function wakePhraseProblem(phrase: string): WakeProblem | null {
  const p = phrase.trim();
  if (!/^[\p{L}\s'-]*$/u.test(p)) return 'characters';
  const words = p.split(/\s+/).filter(Boolean);
  if (words.length > 4 || p.length > 40) return 'length';
  if ([...p].filter((c) => /\p{L}/u.test(c)).length < 2) return 'tooShort';
  return null;
}

const DIGRAPHS = ['igh', 'tch', 'th', 'sh', 'ch', 'ph', 'wh', 'ng', 'ck', 'qu', 'oo', 'ee', 'ea', 'ai', 'ay', 'oa', 'ou', 'ow', 'oi', 'oy', 'au', 'ey'];

/** A rough count of speech sounds in one English word, the desktop's estimate. */
export function estimateSounds(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  let n = 0;
  let prevVowel = false;
  for (let i = 0; i < w.length; ) {
    const d = DIGRAPHS.find((g) => w.startsWith(g, i));
    if (d) {
      n += d === 'qu' ? 2 : 1;
      prevVowel = /[aeiou]/.test(d) && d !== 'qu';
      i += d.length;
      continue;
    }
    const c = w[i];
    const vowel = /[aeiou]/.test(c) || (c === 'y' && i > 0);
    if (c === 'e' && i === w.length - 1 && w.length > 2 && !prevVowel) {
      i++;
      continue;
    }
    if (i > 0 && w[i - 1] === c && !vowel) {
      i++;
      continue;
    }
    if (!(vowel && prevVowel)) n += c === 'x' ? 2 : 1;
    prevVowel = vowel;
    i++;
  }
  return n;
}

/** Fewer sounds than this and a phrase wakes by accident far more often (Picovoice's guidance). */
export const MIN_SOUNDS = 6;

/** A valid phrase likely to wake by accident: the "hey" form to suggest, or `''` when it has one. */
export function shortPhraseSuggestion(phrase: string): string | null {
  if (wakePhraseProblem(phrase)) return null;
  const words = phrase.replace(/[^\p{L}]+/gu, ' ').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const sounds = words.reduce((n, w) => n + estimateSounds(w), 0);
  if (sounds >= MIN_SOUNDS) return null;
  return ['hey', 'ok', 'okay'].includes(words[0]) ? '' : `hey ${words.join(' ')}`;
}

/** Whether a step's own fields let it be saved. */
export function canContinue(step: SetupStep, draft: SetupDraft): boolean {
  switch (step) {
    case 'about-you':
      return draft.userName.trim().length > 0;
    case 'locale':
      return draft.timezone.trim().length > 0;
    case 'personality':
      return draft.assistantName.trim().length > 0;
    case 'wake-word':
      return draft.wakeWord !== 'custom' || wakePhraseProblem(draft.wakeWordCustom) === null;
    default:
      return true;
  }
}

/** The fields `POST /onboard/complete` checks, and the step that sets each; `chat_model` has none. */
export function stepForMissingField(field: string): SetupStep | null {
  switch (field) {
    case 'user_name':
      return 'about-you';
    case 'assistant_name':
      return 'personality';
    case 'timezone':
      return 'locale';
    default:
      return null;
  }
}

/** The earliest step that sets any missing field, so fixing one walks forward through the rest. */
export function firstStepFor(fields: readonly string[]): SetupStep | null {
  const steps = fields.map(stepForMissingField).filter((s): s is SetupStep => s !== null);
  if (steps.length === 0) return null;
  return SETUP_STEPS.find((s) => steps.includes(s)) ?? null;
}

/** What each calibration take reads: `calibration_prompts` in the Pond's pond-voice text.rs, word for word. */
export function calibrationPrompts(phrase: string): string[] {
  const p = phrase.trim();
  return [p, `Hey ${p}, good morning`, `OK ${p}, what time is it`, `${p}, tell me a joke`, `Thank you ${p}`];
}
