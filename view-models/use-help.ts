/**
 * Help & Feedback's email. It reads the Pond's version once when the screen opens, so a report says
 * what the household runs; a Pond that cannot be reached is the commonest reason to write, so the
 * email is still written without it.
 */

import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Device from 'expo-device';

import { APP_VERSION, SUPPORT_EMAIL } from '@/constants/app';
import { mailtoUrl, supportBody, type SupportKind } from '@/models/help';
import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';
import type { TranslationKey } from '@/services/i18n';

/** Each kind of email's subject and opening line, named in full so the catalogue check sees them. */
const WORDING: Record<SupportKind, { subject: TranslationKey; intro: TranslationKey }> = {
  problem: { subject: 'help.problem.subject', intro: 'help.problem.intro' },
  feedback: { subject: 'help.feedback.subject', intro: 'help.feedback.intro' },
};

export interface UseHelp {
  supportEmail: string;
  /** True when the phone had no mail app to open, so the screen shows the address to write to. */
  mailFailed: boolean;
  actions: { write: (kind: SupportKind) => Promise<void> };
}

export function useHelp(): UseHelp {
  const { t } = useTranslation();
  const { hydrated } = useServer();
  const [pondVersion, setPondVersion] = useState<string | null>(null);
  const [mailFailed, setMailFailed] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    api
      .systemInfo()
      .then((info) => {
        if (live) setPondVersion(info.version ?? null);
      })
      .catch(() => {
        // Left as unknown in the email; the person may be writing because the Pond is unreachable.
      });
    return () => {
      live = false;
    };
  }, [hydrated]);

  const write = useCallback(
    async (kind: SupportKind) => {
      const details = [
        { label: t('help.details.app'), value: APP_VERSION },
        { label: t('help.details.phone'), value: Device.modelName ?? Platform.OS },
        { label: t('help.details.system'), value: `${Device.osName ?? Platform.OS} ${Device.osVersion ?? ''}`.trim() },
        { label: t('help.details.pond'), value: pondVersion ?? t('help.details.unknown') },
      ];
      const url = mailtoUrl(SUPPORT_EMAIL, t(WORDING[kind].subject), supportBody(t(WORDING[kind].intro), details));
      try {
        await Linking.openURL(url);
        setMailFailed(false);
      } catch {
        setMailFailed(true);
      }
    },
    [t, pondVersion],
  );

  return { supportEmail: SUPPORT_EMAIL, mailFailed, actions: { write } };
}
