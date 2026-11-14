// What the Pond remembers about the member, with the member's own hand on it: add a fact, reword
// one, file it under another word, delete it, and bring back what a re-sort set aside
// (pond docs/architecture/my-goose-hub.md, part 0a).

import { useCallback, useEffect, useRef, useState } from 'react';

import { EMPTY_ABOUT, type AboutFact, type AboutHeading, type AboutProfile, type ArchivedFact } from '@/models/about';
import { api } from '@/services/api-client';
import { confirm, reject } from '@/services/haptics';
import i18n from '@/services/i18n';
import { showSnackbar } from '@/services/snackbar';
import { describeApiError, logFailure } from './describe-error';
import { hubAction, useHubRead } from './hub-read';

/** While the Pond is still sorting older memories the profile changes by itself; otherwise rarely. */
export const ABOUT_SORTING_MS = 60_000;
export const ABOUT_MS = 5 * 60_000;

/** `busy` while a new fact is on its way, since it has no id of its own yet. */
export const NEW_FACT = 'new';

export interface AboutData {
  profile: AboutProfile;
  /** How many memories a re-sort set aside. */
  setAside: number;
}

const NOTHING: AboutData = { profile: EMPTY_ABOUT, setAside: 0 };

// The Pond counts `to_file` as the shown facts with no word, so the phone can keep it true.
function counted(profile: AboutProfile, headings: AboutHeading[]): AboutProfile {
  return { ...profile, headings, toFile: headings.reduce((n, h) => n + h.facts.filter((f) => f.about === null).length, 0) };
}

/** The profile without the fact. A heading left with nothing goes: the Pond sends none without a fact. */
export function withoutFact(profile: AboutProfile, id: string): AboutProfile {
  return counted(
    profile,
    profile.headings.flatMap((h) => {
      const facts = h.facts.filter((f) => f.id !== id);
      return facts.length ? [{ ...h, facts }] : [];
    }),
  );
}

/**
 * The profile with the fact where the Pond files it: in place while its heading is unchanged, else
 * at the foot of its word's heading. `closing` drops the member's other facts under a
 * one-at-a-time word, which is what adding one does on the Pond.
 */
export function withFact(profile: AboutProfile, fact: AboutFact, closing = false): AboutProfile {
  const word = profile.words.find((w) => w.about === fact.about);
  const from = profile.headings.find((h) => h.facts.some((f) => f.id === fact.id));
  const target = word?.heading || from?.heading;
  if (!target) return profile;
  const closed = (f: AboutFact) => closing && word?.oneAtATime === true && !f.shared && f.about === fact.about && f.id !== fact.id;

  if (from?.heading === target) {
    const facts = from.facts.filter((f) => !closed(f)).map((f) => (f.id === fact.id ? fact : f));
    return counted(
      profile,
      profile.headings.map((h) => (h === from ? { ...h, facts } : h)),
    );
  }

  const rest = withoutFact(profile, fact.id).headings;
  const at = rest.findIndex((h) => h.heading === target);
  if (at >= 0) {
    return counted(
      profile,
      rest.map((h, i) => (i === at ? { ...h, facts: [...h.facts.filter((f) => !closed(f)), fact] } : h)),
    );
  }

  // Headings come in profile order, which is the order the words list them in.
  const order = [...new Set(profile.words.map((w) => w.heading))];
  const rank = (heading: string) => (order.includes(heading) ? order.indexOf(heading) : order.length);
  const before = rest.findIndex((h) => rank(h.heading) > rank(target));
  const made: AboutHeading = { segment: '', heading: target, facts: [fact] };
  return counted(profile, before < 0 ? [...rest, made] : [...rest.slice(0, before), made, ...rest.slice(before)]);
}

export function useAbout() {
  // The count is a footnote: a read of it that fails keeps the last one and still shows the profile.
  const lastSetAside = useRef(0);
  const about = useHubRead<AboutData>(
    'about',
    async () => {
      const [profile, setAside] = await Promise.all([
        api.about(),
        api.archivedAbout().then(
          (facts) => facts.length,
          (e: unknown) => {
            logFailure('about', 'set-aside count failed', e);
            return null;
          },
        ),
      ]);
      if (setAside !== null) lastSetAside.current = setAside;
      return { profile, setAside: lastSetAside.current };
    },
    NOTHING,
    (d) => (d.profile.toFile > 0 ? ABOUT_SORTING_MS : ABOUT_MS),
  );
  const { data, setData } = about;
  const latest = useRef(data);
  useEffect(() => {
    latest.current = data;
  });
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * Show the change now, send it, and put the profile back if the Pond refuses. Resolves with why
   * it was refused, for the sheet still open over the list, or null once it is done.
   */
  const attempt = useCallback(
    async <T>(
      id: string,
      shown: (profile: AboutProfile) => AboutProfile,
      send: () => Promise<T>,
      settled: (profile: AboutProfile, answer: T) => AboutProfile,
      said: string,
    ): Promise<string | null> => {
      const before = latest.current.profile;
      setBusy(id);
      setData((d) => ({ ...d, profile: shown(d.profile) }));
      try {
        const answer = await send();
        setData((d) => ({ ...d, profile: settled(d.profile, answer) }));
        void confirm();
        showSnackbar({ message: said, tone: 'success' });
        return null;
      } catch (e) {
        logFailure('about', 'action failed', e);
        setData((d) => ({ ...d, profile: before }));
        void reject();
        return describeApiError(e) ?? i18n.t('goose.errors.action');
      } finally {
        setBusy(null);
      }
    },
    [setData],
  );

  const add = useCallback(
    (content: string, word: string) => {
      const sentence = content.trim();
      const placeholder: AboutFact = { id: `${NEW_FACT}-${Date.now().toString(36)}`, content: sentence, about: word, sensitive: false, shared: false, createdAt: null, expiresAt: null };
      return attempt(
        NEW_FACT,
        (p) => withFact(p, placeholder, true),
        () => api.addAboutFact(sentence, word),
        (p, fact) => withFact(withoutFact(p, placeholder.id), fact, true),
        i18n.t('goose.about.saved'),
      );
    },
    [attempt],
  );

  /** Sends only what changed: new words, another word to file it under, or both. */
  const edit = useCallback(
    (fact: AboutFact, change: { content?: string; about?: string | null }) => {
      const sentence = change.content?.trim();
      const patch = {
        ...(sentence && sentence !== fact.content ? { content: sentence } : {}),
        ...(change.about && change.about !== fact.about ? { about: change.about } : {}),
      };
      if (!patch.content && !patch.about) return Promise.resolve<string | null>(null);
      return attempt(
        fact.id,
        (p) => withFact(p, { ...fact, ...patch }),
        () => api.editAboutFact(fact.id, patch),
        (p, saved) => withFact(p, saved),
        i18n.t('goose.about.saved'),
      );
    },
    [attempt],
  );

  const remove = useCallback(
    (fact: AboutFact) =>
      attempt(
        fact.id,
        (p) => withoutFact(p, fact.id),
        () => api.deleteAboutFact(fact.id),
        (p) => withoutFact(p, fact.id),
        i18n.t('goose.about.deleted'),
      ),
    [attempt],
  );

  return { ...about, profile: data.profile, setAside: data.setAside, busy, actions: { reload: about.reload, add, edit, remove } };
}

export type UseAbout = ReturnType<typeof useAbout>;

export const ARCHIVED_MS = 5 * 60_000;

/** What a re-sort set aside, each with its reason, to bring back. */
export function useArchivedAbout() {
  const archived = useHubRead<ArchivedFact[]>('about-archived', () => api.archivedAbout(), [], ARCHIVED_MS);
  const { data, setData } = archived;
  const latest = useRef(data);
  useEffect(() => {
    latest.current = data;
  });

  const restore = useCallback(
    async (fact: ArchivedFact) => {
      const at = latest.current.findIndex((f) => f.id === fact.id);
      if (at < 0) return;
      setData((all) => all.filter((f) => f.id !== fact.id));
      const back = await hubAction('about-archived', () => api.restoreAboutFact(fact.id));
      if (!back) {
        setData((all) => (all.some((f) => f.id === fact.id) ? all : [...all.slice(0, at), fact, ...all.slice(at)]));
        return;
      }
      void confirm();
      showSnackbar({ message: i18n.t('goose.about.restored'), tone: 'success' });
    },
    [setData],
  );

  return { ...archived, actions: { reload: archived.reload, restore } };
}

export type UseArchivedAbout = ReturnType<typeof useArchivedAbout>;
