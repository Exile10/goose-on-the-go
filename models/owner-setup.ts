// pond-desktop's onboarding wizard as data, copied from its `onboarding.constants.ts` and
// `useOnboardingPersist.ts` so a Pond set up from either screen reads the same.

import type { TranslationKey } from '@/services/i18n';
import type { PondSettings } from '@/services/types';

/**
 * The desktop's six screens, trimmed to what a phone has to ask: who you are and where (the place
 * and language prefilled from the phone), how Goose talks, and a model only when the Pond has none.
 * The wake word moved to Home's "Finish setting up" card, and the summary to Settings.
 */
export const SETUP_STEPS = ['about-you', 'personality', 'model'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export function stepLabelKey(step: SetupStep): TranslationKey {
  switch (step) {
    case 'about-you':
      return 'setup.steps.aboutYou';
    case 'personality':
      return 'setup.steps.personality';
    case 'model':
      return 'setup.steps.model';
  }
}

/** A required step has no Skip: the Pond refuses to finish without what it sets. */
export function isRequired(step: SetupStep): boolean {
  return step === 'about-you' || step === 'model';
}

/** The backend `OnboardingStep`s each step records once it is saved, in the order the desktop sends them. */
export function stepRecords(step: SetupStep): string[] {
  switch (step) {
    case 'about-you':
      return ['Basics', 'Location'];
    case 'personality':
      return ['GooseIdentity'];
    case 'model':
      return ['Model'];
  }
}

// About you is saved only once Location is recorded too; a Pond with Basics alone was left half way
// by an older build, and its zone is not known to be saved. Finishing lives on How Goose talks, so
// anything past it reopens there.
const BACKEND_TO_INDEX: Record<string, number> = {
  Location: 0,
  Personality: 1,
  GooseIdentity: 1,
  WakeWord: 1,
  Model: 1,
  Extensions: 1,
  Completed: 1,
};

/** The screen after the furthest one the Pond recorded: a recorded step was saved, so it is not asked again. */
export function resumeIndex(backendStep: string | null | undefined): number {
  const done = backendStep ? BACKEND_TO_INDEX[backendStep] : undefined;
  if (done === undefined) return 0;
  return Math.min(done + 1, SETUP_STEPS.indexOf('personality'));
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

/** The phone's language when it is one the desktop offers, else English. */
export function setupLanguageFor(tags: readonly (string | null | undefined)[]): string {
  for (const tag of tags) {
    const key = tag?.toLowerCase().split(/[-_]/)[0];
    if (key && SETUP_LANGUAGES.some((l) => l.key === key)) return key;
  }
  return 'en';
}

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

export function defaultDraft(deviceZone: string, language = 'en'): SetupDraft {
  return {
    userName: '',
    preferredName: '',
    birthday: '',
    atypicalSpeech: false,
    slowSpeech: false,
    language,
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
  if (saved('about-you')) {
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
  return next;
}

/** The wake phrase the Pond holds, as the wake step's preset or custom choice. */
export function wakeDraftFrom(phrase: string | null | undefined): Pick<SetupDraft, 'wakeWord' | 'wakeWordCustom'> {
  const p = phrase?.trim() ?? '';
  if (!p) return { wakeWord: 'goose', wakeWordCustom: '' };
  return (WAKE_PRESETS as readonly string[]).includes(p) ? { wakeWord: p, wakeWordCustom: '' } : { wakeWord: 'custom', wakeWordCustom: p };
}

/** The phrase the Pond will listen for. */
export function wakePhrase(draft: Pick<SetupDraft, 'wakeWord' | 'wakeWordCustom'>): string {
  return draft.wakeWord === 'custom' ? draft.wakeWordCustom.trim() : draft.wakeWord;
}

/** `PUT /settings` per step, key for key with the desktop; About you carries the desktop's Location step too. */
export function settingsPatch(step: SetupStep, draft: SetupDraft): Partial<PondSettings> | null {
  switch (step) {
    case 'about-you':
      return {
        user_name: draft.userName.trim(),
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
    case 'model':
      return null;
  }
}

/** What All set used to save with Finish: memory on, which Settings > Memory shows and changes. */
export function finishPatch(draft: SetupDraft): Partial<PondSettings> {
  return { agent_memory_inject: draft.enableMemory };
}

/** The step that writes the owner's profile preferences, language among them. */
export function writesProfile(step: SetupStep): boolean {
  return step === 'about-you';
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
      return draft.userName.trim().length > 0 && draft.timezone.trim().length > 0;
    case 'personality':
      return draft.assistantName.trim().length > 0;
    case 'model':
      return true;
  }
}

/** Whether a wake phrase choice can be stored. */
export function wakeChoiceValid(draft: Pick<SetupDraft, 'wakeWord' | 'wakeWordCustom'>): boolean {
  return draft.wakeWord !== 'custom' || wakePhraseProblem(draft.wakeWordCustom) === null;
}

/** The fields `POST /onboard/complete` checks, and the step that sets each. */
export function stepForMissingField(field: string): SetupStep | null {
  switch (field) {
    case 'user_name':
    case 'timezone':
      return 'about-you';
    case 'assistant_name':
      return 'personality';
    case 'chat_model':
      return 'model';
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

/** A birthday as `YYYY-MM-DD`, or null for a date that cannot exist; it is held back, never rounded. */
export function birthdayOf(parts: { year: string; month: string; day: string }, thisYear: number): string | null {
  if (!parts.year || !parts.month || !parts.day) return null;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  if (!Number.isInteger(year) || year < thisYear - 120 || year > thisYear) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  const last = new Date(year, month, 0).getDate();
  if (!Number.isInteger(day) || day < 1 || day > last) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
