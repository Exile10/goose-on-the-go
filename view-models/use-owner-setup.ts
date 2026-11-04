/**
 * Owner setup: pond-desktop's onboarding wizard on the phone, for a Pond with no screen, trimmed to
 * two screens and a model screen only when the Pond has none. Each step is saved as it is left and
 * recorded with the Pond, so a setup quit part way resumes where it was.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Device from 'expo-device';
import { getLocales } from 'expo-localization';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import { confirm, reject } from '@/services/haptics';
import i18n, { type TranslationKey } from '@/services/i18n';
import { getInstallId } from '@/services/install-id';
import { canKeepAdminKey, keepAdminKey } from '@/services/kept-admin-key';
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
  setupNote,
  stepRecords,
  writesProfile,
  type SetupDraft,
  type SetupStep,
} from '@/models/owner-setup';
import { genericPhoneName } from '@/models/ble-setup';
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

/**
 * A phone paired as plain "iPhone" becomes "Amina's iPhone" once setup knows who Amina is. Only after
 * setup, since the Pond guards its device routes until then; and only a name nobody has changed since.
 * The host name is sent back as it was, for a Pond that replaces every field; the room is left out,
 * which keeps it.
 */
async function nameThisPhone(owner: string): Promise<void> {
  const generic = genericPhoneName(Device.deviceName, Device.modelName);
  if (!generic || !owner) return;
  const id = await getInstallId();
  const mine = (await api.listDevices()).find((d) => d.id === id);
  if (!mine || mine.name !== generic) return;
  await api.updateDevice(id, { name: i18n.t('setup.phoneOf', { name: owner, device: generic }), hostname: mine.hostname });
}

/**
 * The Assistant notes typed during setup, which the Pond keeps only once setup is done. Setup has no
 * screen left by then to say it failed on, so a dropped connection is tried again; a refusal is final.
 */
async function saveSetupNote(draft: SetupDraft): Promise<void> {
  const note = setupNote(draft);
  if (!note) return;
  for (let attempt = 1; ; attempt++) {
    try {
      await api.savePromptExtra(note);
      return;
    } catch (e) {
      const refused = e instanceof ApiError && e.status < 500;
      if (refused || attempt >= 3) {
        console.warn('[setup] the Assistant notes were not saved', e instanceof ApiError ? e.status : 'network');
        return;
      }
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
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

/**
 * The key to My Pond that setup's last call gave the phone that claimed the Pond. A phone that cannot
 * keep it drops it: the member can enroll with the admin card later. Never logged, never in AsyncStorage.
 */
async function keepSetupKey(pin: string | null, key: string | undefined): Promise<boolean> {
  if (!pin || !key || !canKeepAdminKey()) return false;
  try {
    await keepAdminKey(pin, key, i18n.t('myPond.key.savePrompt'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Setup ends in the owner's interview, so Goose asks about them while they are still holding the phone.
 * Starting it writes the first question; a failure leaves it to Home's offer.
 */
async function openingInterview(profileId: string): Promise<UseOwnerSetup['interview']> {
  try {
    const { sessionId } = await api.startInterview(profileId);
    return sessionId ? { profileId, sessionId } : null;
  } catch {
    console.warn('[setup] the interview did not start; Home offers it');
    return null;
  }
}

/** What the step a skip leaves behind is set to: the defaults, so nothing it requires is left empty. */
function skipped(step: SetupStep, draft: SetupDraft): SetupDraft {
  const base = defaultDraft(draft.timezone);
  return step === 'personality'
    ? { ...draft, promptStyle: base.promptStyle, personality: base.personality, notes: base.notes, assistantName: base.assistantName }
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
  /** The owner's setup interview, started as setup finished, for the screen to open in its place. */
  interview: { profileId: string; sessionId: string } | null;
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
  const { hydrated, paired, profileId, pairedPin } = useServer();
  const [phase, setPhase] = useState<SetupPhase>('loading');
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<SetupDraft>(phoneDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noChatModel, setNoChatModel] = useState(false);
  const [interview, setInterview] = useState<UseOwnerSetup['interview']>(null);
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
        // Android asks for the fingerprint here, while setup is still on screen.
        const keptAdminKey = await keepSetupKey(pairedPin ?? null, result.adminKey);
        void confirm();
        if (profileId) {
          markSetupDone(profileId);
          // Home says whether Goose can answer yet, and what is left to do, in place of two screens.
          markGettingReady(profileId, true, keptAdminKey);
          void openSetupChecklist(profileId);
          void saveSetupNote(d);
          void nameThisPhone(d.preferredName.trim() || d.userName.trim().split(/\s+/)[0] || '').catch(() => {
            console.warn('[setup] this phone keeps its own name on the Pond');
          });
          void drafts.remove([profileId]).catch(() => {});
        }
        if (result.interview) setInterview(await openingInterview(result.interview.profileId));
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
  }, [index, pairedPin, persist, profileId, saving]);

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
    interview,
    system,
    canContinue: canContinue(step, draft),
    place,
    actions: { patch, next, skip, back, finish, reload, detectPlace },
  };
}
