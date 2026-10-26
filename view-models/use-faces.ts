/**
 * The household's faces: who the pond knows by sight, and the ways to teach it or make it forget.
 *
 * `GET /faces` lists every household member, those with no samples included, which is also why it
 * is where names come from: the events screen and the automation form both show a person by the
 * name this gives. A Pond without the overview, or one with no face model that lists nobody, is
 * asked for its profiles instead, so a face that matched somebody is still named.
 *
 * Samples are taken from the pond's own camera, which sees a person in the light and from the
 * angle recognition will, or from a photo on the phone. Neither keeps anything here: the photo is
 * sent to the pond and the pond keeps the face data.
 *
 * Real Pond only, like Devices: there is no Developer toggle and no sample data behind it.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { useServer } from '@/providers/server-provider';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';
import { AttachError, pickAttachments } from '@/services/media';
import type { FaceOverview, FacePerson } from '@/services/types';
import { knownByFace, orderPeople } from '@/models/faces';
import { describeApiError, refusalReason } from './describe-error';
import { useLive } from './use-live';

/** Who is known by face changes when somebody enrols, which is on this phone or on the desktop. */
export const FACES_MS = 60_000;

export interface UseFaces {
  data: {
    /** The pond has a face model, so samples can be taken and faces recognised. */
    available: boolean;
    defaultThreshold: number;
    /** Everyone in the household, the pond's known faces first. */
    people: FacePerson[];
    /** How many of them the pond knows by face. */
    known: number;
  };
  loading: boolean;
  error: string | null;
  /** The first read failed: who the pond knows is unknown, not nobody. */
  failed: boolean;
  /** A person's name from their profile id, or null for one the household no longer has. */
  nameOf: (profileId: string) => string | null;
  actions: {
    refresh: () => Promise<void>;
    /** Resolves to why the pond refused, or null once it has forgotten the face. */
    forget: (person: FacePerson) => Promise<string | null>;
    /** `null` goes back to the pond's own strictness. Resolves to why the pond refused, or null once saved. */
    setStrictness: (person: FacePerson, threshold: number | null) => Promise<string | null>;
  };
}

const NONE: FaceOverview = { available: false, default_threshold: 0, people: [] };

/** The household as the profiles list it, for a pond that cannot say who it knows by face. */
async function peopleFromProfiles(): Promise<FacePerson[]> {
  const profiles = await api.listProfiles();
  return profiles.map((p) => ({
    profile_id: p.id,
    name: p.display_name,
    enrollments: 0,
    threshold: null,
    last_enrolled_at: null,
  }));
}

export function useFaces(): UseFaces {
  const { hydrated } = useServer();
  const [overview, setOverview] = useState<FaceOverview>(NONE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const loaded = useRef(false);

  const load = useCallback(async (loud: boolean) => {
    if (loud) {
      setLoading(true);
      setError(null);
    }
    try {
      let next: FaceOverview;
      try {
        next = await api.listFaces();
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 404) throw e;
        next = { ...NONE, people: await peopleFromProfiles() };
      }
      if (next.people.length === 0 && !next.available) {
        // A pond with no face model may list nobody, and its events can still name who they saw.
        next = { ...next, people: await peopleFromProfiles().catch(() => []) };
      }
      setOverview(next);
      loaded.current = true;
      setError(null);
      setFailed(false);
    } catch (e) {
      if (loud || !loaded.current) setError(describeApiError(e));
      else console.warn('[faces] refresh failed; showing the last result', e instanceof ApiError ? e.status : 'network');
      if (!loaded.current) setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => load(true), [load]);

  useLive(() => load(false), FACES_MS, hydrated);

  const people = useMemo(() => orderPeople(overview.people), [overview.people]);
  const names = useMemo(() => new Map(overview.people.map((p) => [p.profile_id, p.name])), [overview.people]);
  const nameOf = useCallback((profileId: string) => names.get(profileId) ?? null, [names]);

  const forget = useCallback(
    async (person: FacePerson) => {
      try {
        await api.forgetFace(person.profile_id);
      } catch (e) {
        console.warn('[faces] forget refused', e instanceof ApiError ? e.status : 'network');
        return describeApiError(e) ?? i18n.t('faces.forget.failed');
      }
      await load(false);
      return null;
    },
    [load],
  );

  const setStrictness = useCallback(
    async (person: FacePerson, threshold: number | null) => {
      try {
        if (threshold === null) await api.clearFaceThreshold(person.profile_id);
        else await api.setFaceThreshold(person.profile_id, threshold);
      } catch (e) {
        console.warn('[faces] strictness refused', e instanceof ApiError ? e.status : 'network');
        return describeApiError(e) ?? i18n.t('faces.strictness.failed');
      }
      await load(false);
      return null;
    },
    [load],
  );

  return {
    data: {
      available: overview.available,
      defaultThreshold: overview.default_threshold,
      people,
      known: knownByFace(overview.people),
    },
    loading,
    error,
    failed,
    nameOf,
    actions: { refresh, forget, setStrictness },
  };
}

// ── Taking a sample ───────────────────────────────────────────

/**
 * Why a sample was refused, as a sentence that says what to do. The pond names its reason for a
 * camera sample; a photo it cannot use is simply a 422.
 */
export function describeFaceError(e: unknown, via: 'camera' | 'photo'): string {
  if (e instanceof ApiError) {
    const reason = refusalReason(e);
    if (e.status === 403 && reason === 'cameras_disabled') return i18n.t('faces.error.camerasOff');
    if (e.status === 409 && reason === 'no_frame') return i18n.t('faces.error.noFrame');
    if (e.status === 404) return i18n.t('faces.error.unknownPerson');
    if (e.status === 503) return i18n.t('faces.error.unavailable');
    if (e.status === 422) return i18n.t(via === 'camera' ? 'faces.error.noFace' : 'faces.error.badPhoto');
    const shared = describeApiError(e);
    if (shared) return shared;
  }
  return i18n.t(via === 'camera' ? 'faces.error.failed' : 'faces.error.photoFailed');
}

export interface FaceNotice {
  tone: 'success' | 'danger';
  text: string;
  /** Which way of adding a sample it is about, so it can sit under that one. */
  via: 'camera' | 'photo';
}

export interface UseFaceEnrolment {
  /** What is on its way to the pond, so the buttons hold still. */
  busy: 'camera' | 'photo' | null;
  /** What the last attempt came to. */
  notice: FaceNotice | null;
  actions: {
    /** A sample from the pond's own camera, the one the person is standing in front of. */
    fromCamera: (person: FacePerson, cameraId: string | null) => Promise<void>;
    /** A sample from a photo on this phone, taken now or chosen. */
    fromPhoto: (person: FacePerson, source: 'camera' | 'photos') => Promise<void>;
    clear: () => void;
  };
}

/** @param onAdded Runs once the pond has a new sample, so the list can read the new count. */
export function useFaceEnrolment(onAdded: () => Promise<void>): UseFaceEnrolment {
  const [busy, setBusy] = useState<'camera' | 'photo' | null>(null);
  const [notice, setNotice] = useState<FaceNotice | null>(null);
  const working = useRef(false);

  const added = useCallback(
    async (person: FacePerson, via: FaceNotice['via']) => {
      setNotice({
        tone: 'success',
        text: i18n.t('faces.sheet.added', { name: person.name, count: person.enrollments + 1 }),
        via,
      });
      await onAdded();
    },
    [onAdded],
  );

  const fromCamera = useCallback(
    async (person: FacePerson, cameraId: string | null) => {
      if (working.current) return;
      working.current = true;
      setBusy('camera');
      setNotice(null);
      try {
        await api.registerFaceFromCamera(person.profile_id, cameraId ?? undefined);
        await added(person, 'camera');
      } catch (e) {
        console.warn('[faces] camera sample refused', e instanceof ApiError ? `${e.status} ${refusalReason(e) ?? ''}` : 'network');
        setNotice({ tone: 'danger', text: describeFaceError(e, 'camera'), via: 'camera' });
      } finally {
        working.current = false;
        setBusy(null);
      }
    },
    [added],
  );

  const fromPhoto = useCallback(
    async (person: FacePerson, source: 'camera' | 'photos') => {
      if (working.current) return;
      working.current = true;
      setBusy('photo');
      setNotice(null);
      try {
        const [photo] = await pickAttachments(source, 1);
        // Backing out of the picker is not a failure and says nothing.
        if (!photo) return;
        await api.registerFacePhoto(person.profile_id, photo.uri);
        await added(person, 'photo');
      } catch (e) {
        if (e instanceof AttachError) {
          setNotice({ tone: 'danger', text: i18n.t(e.key), via: 'photo' });
        } else {
          console.warn('[faces] photo sample refused', e instanceof ApiError ? e.status : 'network');
          setNotice({ tone: 'danger', text: describeFaceError(e, 'photo'), via: 'photo' });
        }
      } finally {
        working.current = false;
        setBusy(null);
      }
    },
    [added],
  );

  const clear = useCallback(() => setNotice(null), []);

  return { busy, notice, actions: { fromCamera, fromPhoto, clear } };
}
