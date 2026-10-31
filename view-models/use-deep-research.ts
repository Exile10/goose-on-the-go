// Deep research from the composer: whether the Pond offers it, asked once per Pond, and the composer's
// research mode, which lasts one message and never outlives the conversation it was chosen in. How much
// it writes is the person's pick, kept for as long as the composer is up.

import { useCallback, useEffect, useState } from 'react';

import { researchOffer, type ResearchOffer } from '@/models/long-tasks';
import { useServer } from '@/providers/server-provider';
import { ApiError } from '@/services/api-client';
import type { TranslationKey } from '@/services/i18n';
import type { AnswerShape } from '@/services/types';
import { useLongTasksSource } from './use-long-task';

/** The Pond's refusal of a research turn before it saved anything, by the `reason` it names. */
export function researchRefusal(e: unknown): 'off' | 'unidentified' | null {
  if (!(e instanceof ApiError)) return null;
  const reason = (e.body as { reason?: unknown } | null)?.reason;
  if (e.status === 409 && reason === 'deep_research_off') return 'off';
  if (e.status === 403 && reason === 'deep_research_unidentified') return 'unidentified';
  return null;
}

/** Whether the menu offers research. Asked when the dock mounts and when the Pond changes, never per render. */
export function useResearchOffer(): ResearchOffer {
  const { hydrated, profileId } = useServer();
  const source = useLongTasksSource();
  const [offer, setOffer] = useState<ResearchOffer>('hidden');

  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    void (async () => {
      try {
        const answer = await source.researchAvailability();
        if (live) setOffer(researchOffer(answer));
      } catch (e) {
        // A Pond without the route (404) or one that did not answer: nothing is offered that may not work.
        if (!(e instanceof ApiError && e.status === 404)) console.warn('[research] availability check failed');
        if (live) setOffer('hidden');
      }
    })();
    return () => {
      live = false;
    };
  }, [hydrated, profileId, source]);

  return offer;
}

export interface ResearchItem {
  shown: boolean;
  disabled: boolean;
  /** Why it cannot be chosen now, under its name. */
  noteKey: TranslationKey | null;
}

/** The menu's research row: hidden, greyed with why, or ready. A question with pictures cannot be research. */
export function researchItem(offer: ResearchOffer, attachments: number): ResearchItem {
  if (offer === 'hidden') return { shown: false, disabled: true, noteKey: null };
  if (offer === 'unidentified') return { shown: true, disabled: true, noteKey: 'chat.research.unidentified' };
  if (attachments > 0) return { shown: true, disabled: true, noteKey: 'chat.research.noAttachments' };
  return { shown: true, disabled: false, noteKey: null };
}

/** The composer's choices of how much research writes, in the order it offers them. */
export const RESEARCH_ANSWERS: readonly AnswerShape[] = ['auto', 'short', 'report'];

export function researchAnswerWords(answer: AnswerShape): { labelKey: TranslationKey; hintKey: TranslationKey } {
  switch (answer) {
    case 'short':
      return { labelKey: 'chat.research.answer.short', hintKey: 'chat.research.answer.shortHint' };
    case 'report':
      return { labelKey: 'chat.research.answer.report', hintKey: 'chat.research.answer.reportHint' };
    case 'auto':
      return { labelKey: 'chat.research.answer.auto', hintKey: 'chat.research.answer.autoHint' };
  }
}

export interface ResearchMode {
  on: boolean;
  /** How much the research writes. Outlasts the message and the conversation, so a pick is made once. */
  answer: AnswerShape;
  choose: (answer: AnswerShape) => void;
  /** Turns it on; refused while pictures or files wait to be sent, which research cannot take. */
  start: (attachments: number) => boolean;
  /** The chip's remove. */
  clear: () => void;
  /** Called as the message goes: whether it was research, and the mode is over either way. */
  take: () => boolean;
}

/** The composer's research mode. `conversation` changing (another one opened, or a new one) ends it. */
export function useResearchMode(conversation: string | null): ResearchMode {
  const [on, setOn] = useState(false);
  const [answer, choose] = useState<AnswerShape>('auto');
  const [seen, setSeen] = useState(conversation);
  if (seen !== conversation) {
    setSeen(conversation);
    setOn(false);
  }

  const start = useCallback((attachments: number) => {
    if (attachments > 0) return false;
    setOn(true);
    return true;
  }, []);
  const clear = useCallback(() => setOn(false), []);
  const take = useCallback(() => {
    setOn(false);
    return on;
  }, [on]);

  return { on, answer, choose, start, clear, take };
}
