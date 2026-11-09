// A report's options, kept or watched from its page: Save keeps one as a listing card in the
// member's collection, and Watch price keeps it and has the Pond watch its page.

import { useCallback, useState } from 'react';

import type { ReportOption } from '@/models/web-watches';
import { ApiError, api } from '@/services/api-client';
import i18n from '@/services/i18n';

export type OptionState = { saving?: boolean; savedId?: string; watched?: boolean; error?: string };

/** The card an option keeps as: its facts in the body, so nothing the step wrote is lost. */
export function optionCard(option: ReportOption, collection: string | null) {
  const lines = [
    option.why ? option.why : null,
    ...option.fields.map(([label, value]) => `- ${label}: ${value}`),
  ].filter((l): l is string => l !== null);
  return {
    kind: 'listing' as const,
    title: option.title,
    price: option.price,
    link: option.link,
    body: lines.join('\n'),
    collection: collection ?? undefined,
    sources: option.sources,
  };
}

export function useReportOptions(collection: string | null) {
  const [states, setStates] = useState<Record<number, OptionState>>({});
  const set = (i: number, s: OptionState) => setStates((all) => ({ ...all, [i]: { ...all[i], ...s } }));

  const save = useCallback(
    async (i: number, option: ReportOption, watch: boolean) => {
      set(i, { saving: true, error: undefined });
      try {
        const savedId = states[i]?.savedId ?? (await api.saveItem(optionCard(option, collection))).id;
        set(i, { savedId });
        if (watch && option.link) {
          await api.watchSavedItem(savedId);
          set(i, { watched: true });
        }
      } catch (e) {
        set(i, {
          error: e instanceof ApiError ? i18n.t('saved.errors.status', { status: e.status }) : i18n.t('saved.errors.unreachable'),
        });
      } finally {
        set(i, { saving: false });
      }
    },
    [collection, states],
  );

  return { states, actions: { save } };
}
