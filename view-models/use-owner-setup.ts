/**
 * Owner setup: pond-desktop's onboarding wizard on the phone, for a Pond with no screen, trimmed to
 * two screens and a model screen only when the Pond has none. Each step is saved as it is left and
 * recorded with the Pond, so a setup quit part way resumes where it was.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getLocales } from 'expo-localization';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import { confirm, reject } from '@/services/haptics';
import i18n, { type TranslationKey } from '@/services/i18n';
import { storageFamily } from '@/services/storage';
import type { OnboardStatus, PondSettings, SystemInfo } from '@/services/types';
import {
  SETUP_STEPS,
  canContinue,
  defaultDraft,
  deviceZone,
  draftFromPond,
  finishPatch,
  firstStepFor,
  profilePrefs,
  resumeIndex,
  settingsPatch,
  setupLanguageFor,
  stepRecords,
  writesProfile,
  type SetupDraft,
  type SetupStep,
} from '@/models/owner-setup';
import { describeApiError } from './describe-error';
import { openSetupChecklist } from './use-setup-checklist';
import { markGettingReady, markSetupDone } from './use-setup-gate';

export type SetupPhase = 'loading' | 'failed' | 'wizard' | 'finished' | 'alreadyDone' | 'unpaired';

interface Saved {
  draft: SetupDraft;
  ownerId: string | null;
}

const drafts = storageFamily('setupDrafts');

/** The draft's starting point: this phone's zone and, when the desktop offers it, its language. */
function phoneDraft(): SetupDraft {
  let tags: string[] = [];
  try {
    tags = getLocales().map((l) => l.languageTag);
  } catch {
    // No locale module (a test, or the web): English, as the desktop starts.
  }
  return defaultDraft(deviceZone(), setupLanguageFor(tags));
}

function missingKey(field: string): TranslationKey {
  switch (field) {
    case 'user_name':
      return 'setup.missing.userName';
    case 'assistant_name':
      return 'setup.missing.assistantName';
    case 'timezone':
      return 'setup.missing.timezone';
    default:
      return 'setup.missing.other';
  }
}

/** The model step says it itself; every other missing field is named over the step it sends back to. */
function namedMissing(fields: readonly string[]): string {
  return fields.filter((f) => f !== 'chat_model').map((f) => i18n.t(missingKey(f))).join(' ');
}

// P4 answers GET /settings to a paired token before setup; an older Pond refuses it with a 403,
// and an empty PUT, which writes nothing, answers the same record.
async function readRecord(): Promise<PondSettings | null> {
  try {
    return await api.getSettings();
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 403) return null;
    return api.updateSettings({}).catch(() => null);
  }
}

function saveMessage(e: unknown): string {
  // A 422 names what the Pond would not take, such as a wake phrase it cannot listen for.
  if (e instanceof ApiError && e.status === 422 && e.detail) return e.detail;
  return describeApiError(e) ?? i18n.t('setup.saveFailed');
}

/** What the step a skip leaves behind is set to: the defaults, so nothing it requires is left empty. */
function skipped(step: SetupStep, draft: SetupDraft): SetupDraft {
  const base = defaultDraft(draft.timezone);
  return step === 'personality'
    ? { ...draft, promptStyle: base.promptStyle, personality: base.personality, assistantName: base.assistantName }
    : draft;
}

export interface UseOwnerSetup {
  phase: SetupPhase;
  step: SetupStep;
  index: number;
  draft: SetupDraft;
  saving: boolean;
  error: string | null;
  /** Why the step on screen was returned to, after the Pond refused to finish. */
  notice: string | null;
  /** The Pond refused to finish because it has no chat model; the model step chooses one. */
  noChatModel: boolean;
  system: SystemInfo | null;
  canContinue: boolean;
  place: { busy: boolean; note: string | null; tone: 'neutral' | 'danger' };
  actions: {
    patch: (change: Partial<SetupDraft>) => void;
    next: () => Promise<void>;
    skip: () => Promise<void>;
    back: () => void;
    /** Resolves true once the Pond has finished setup. */
    finish: () => Promise<boolean>;
    reload: () => void;
    /** Ask the Pond where this home is, from the zone and anything typed. Saves nothing until Continue. */
    detectPlace: () => Promise<void>;
  };
}

export function useOwnerSetup(): UseOwnerSetup {
  const { hydrated, paired, profileId } = useServer();
  const [phase, setPhase] = useState<SetupPhase>('loading');
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<SetupDraft>(phoneDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noChatModel, setNoChatModel] = useState(false);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [place, setPlace] = useState<UseOwnerSetup['place']>({ busy: false, note: null, tone: 'neutral' });
  // Read in the actions without making them change identity on every keystroke.
  const owner = useRef<{ id: string | null }>({ id: null });
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!hydrated || !paired || !profileId) return;
    let cancelled = false;
    void (async () => {
      setPhase('loading');
      let status: OnboardStatus;
      try {
        status = await api.onboardStatus();
      } catch {
        if (!cancelled) setPhase('failed');
        return;
      }
      if (cancelled) return;
      if (status.onboarded) {
        markSetupDone(profileId);
        setPhase('alreadyDone');
        return;
      }
      const resumeAt = resumeIndex(status.current_step);
      const [settings, saved, info] = await Promise.all([
        readRecord(),
        drafts.getJSON<Saved>(profileId).catch((): Saved | null => null),
        api.systemInfo().catch((): SystemInfo | null => null),
      ]);
      if (cancelled) return;
      const base = saved?.draft ? { ...phoneDraft(), ...saved.draft } : phoneDraft();
      setDraft(draftFromPond(base, settings, resumeAt));
      owner.current = { id: settings?.primary_profile_id ?? saved?.ownerId ?? null };
      setSystem(info);
      setIndex(resumeAt);
      setPhase('wizard');
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, paired, profileId, attempt]);

  const keep = useCallback(
    (next: SetupDraft) => {
      if (!profileId) return;
      void drafts.setJSON<Saved>(profileId, { draft: next, ownerId: owner.current.id }).catch(() => {});
    },
    [profileId],
  );

  /** The owner's profile, made once: the Pond makes a new member on every POST. */
  const ensureOwner = useCallback(async (name: string): Promise<string> => {
    if (owner.current.id) return owner.current.id;
    const created = await api.createProfile(name);
    await api.updateSettings({ primary_profile_id: created.id });
    owner.current = { ...owner.current, id: created.id };
    return created.id;
  }, []);

  const persist = useCallback(
    async (step: SetupStep, d: SetupDraft) => {
      const patch = settingsPatch(step, d);
      if (patch) await api.updateSettings(patch);
      if (writesProfile(step)) {
        const id = await ensureOwner(d.userName.trim());
        await api.setProfilePrefs(id, profilePrefs(d));
      }
      // Progress is only a bookmark; a Pond that will not record it has still saved the step.
      for (const record of stepRecords(step)) {
        await api.recordOnboardStep(record).catch((e) => {
          console.warn('[setup] the step was saved but not recorded', e instanceof ApiError ? e.status : 'network');
        });
      }
      keep(d);
    },
    [ensureOwner, keep],
  );

  const advanceFrom = useCallback(
    async (d: SetupDraft) => {
      const step = SETUP_STEPS[index];
      if (!canContinue(step, d) || saving) return;
      setSaving(true);
      setError(null);
      try {
        await persist(step, d);
        setNotice(null);
        setIndex((i) => Math.min(i + 1, SETUP_STEPS.length - 1));
      } catch (e) {
        void reject();
        setError(saveMessage(e));
      } finally {
        setSaving(false);
      }
    },
    [index, persist, saving],
  );

  const next = useCallback(() => advanceFrom(draftRef.current), [advanceFrom]);

  const finish = useCallback(async () => {
    if (saving) return false;
    const d = draftRef.current;
    const step = SETUP_STEPS[index];
    if (!canContinue(step, d)) return false;
    setSaving(true);
    setError(null);
    try {
      await persist(step, d);
      await api.updateSettings(finishPatch(d));
      const result = await api.completeOnboarding();
      if (result.completed) {
        void confirm();
        if (profileId) {
          markSetupDone(profileId);
          // Home says whether Goose can answer yet, and what is left to do, in place of two screens.
          markGettingReady(profileId, true);
          void openSetupChecklist(profileId);
          void drafts.remove([profileId]).catch(() => {});
        }
        setPhase('finished');
        return true;
      }
      const back = firstStepFor(result.missing);
      const onlyModel = result.missing.every((f) => f === 'chat_model');
      setNoChatModel(result.missing.includes('chat_model'));
      if (!onlyModel) void reject();
      setNotice(onlyModel ? null : namedMissing(result.missing));
      if (back) setIndex(SETUP_STEPS.indexOf(back));
      return false;
    } catch (e) {
      void reject();
      setError(saveMessage(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [index, persist, profileId, saving]);

  // Skipping How Goose talks keeps its defaults and finishes, since it is the last thing asked.
  const skip = useCallback(async () => {
    const step = SETUP_STEPS[index];
    const d = skipped(step, draftRef.current);
    setDraft(d);
    draftRef.current = d;
    await (step === 'personality' ? finish() : advanceFrom(d));
  }, [advanceFrom, finish, index]);

  const patch = useCallback((change: Partial<SetupDraft>) => setDraft((d) => ({ ...d, ...change })), []);
  const back = useCallback(() => {
    setError(null);
    setIndex((i) => Math.max(i - 1, 0));
  }, []);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const detectPlace = useCallback(async () => {
    const typed = draftRef.current.locationName.trim();
    setPlace({ busy: true, note: null, tone: 'neutral' });
    try {
      const at = await api.detectLocation({ system_zone: deviceZone(), typed_name: typed || undefined });
      setDraft((d) => ({
        ...d,
        locationName: at.name || d.locationName,
        timezone: at.timezone || d.timezone,
        latitude: at.latitude,
        longitude: at.longitude,
        // Weather on only with somewhere to forecast, or it is on and has nothing to show.
        enableWeather: at.has_coordinates || Boolean(at.name),
      }));
      const note = at.note ?? (at.certain ? i18n.t('setup.locale.found', { name: at.name }) : i18n.t('setup.locale.guessed', { name: at.name }));
      setPlace({ busy: false, note, tone: 'neutral' });
    } catch {
      setPlace({ busy: false, note: i18n.t('setup.locale.detectFailed'), tone: 'danger' });
    }
  }, []);

  const step = SETUP_STEPS[index];
  return {
    phase: hydrated && !paired ? 'unpaired' : phase,
    step,
    index,
    draft,
    saving,
    error,
    notice,
    noChatModel,
    system,
    canContinue: canContinue(step, draft),
    place,
    actions: { patch, next, skip, back, finish, reload, detectPlace },
  };
}
