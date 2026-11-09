/**
 * What the privacy screen says, as catalogue keys. The copy lives in `services/i18n/locales/en.json`.
 *
 * Every statement behind these keys was checked against the Pond's source (#73), and several
 * replace claims that were not true: AES-256 encryption the Pond does not do, integrations with
 * Uber and Glovo that do not exist, voice biometrics that do not exist, and a "voice history"
 * setting that does not exist. Change the copy only with the same kind of evidence.
 */
import type { IconName } from './icons';

import type { TranslationKey } from '@/services/i18n';

export interface PrivacySection {
  id: string;
  icon: IconName;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
}

export const PRIVACY_SECTIONS: PrivacySection[] = [
  { id: 'local', icon: 'home', titleKey: 'privacy.localTitle', bodyKey: 'privacy.localBody' },
  { id: 'storage', icon: 'lock', titleKey: 'privacy.storageTitle', bodyKey: 'privacy.storageBody' },
  { id: 'network', icon: 'globe', titleKey: 'privacy.networkTitle', bodyKey: 'privacy.networkBody' },
  { id: 'voice', icon: 'mic', titleKey: 'privacy.voiceTitle', bodyKey: 'privacy.voiceBody' },
  { id: 'faces', icon: 'shield', titleKey: 'privacy.facesTitle', bodyKey: 'privacy.facesBody' },
];

/**
 * Only the rights this app can actually exercise. The five rows before this were buttons with no
 * handler, including an "opt out of analytics" for analytics that do not exist.
 */
export const DATA_RIGHT_KEYS = ['privacy.rightSignOut', 'privacy.rightRemoveMember'] as const;

/** The full documents, after the summary: their route and their copy. */
export const PRIVACY_DOCUMENTS = [
  {
    id: 'policy',
    icon: 'shield',
    route: { pathname: '/(stack)/legal', params: { doc: 'privacy' } },
    titleKey: 'privacy.documentPolicy',
    hintKey: 'privacy.documentPolicyHint',
  },
  {
    id: 'terms',
    icon: 'file',
    route: { pathname: '/(stack)/legal', params: { doc: 'terms' } },
    titleKey: 'privacy.documentTerms',
    hintKey: 'privacy.documentTermsHint',
  },
  {
    id: 'licenses',
    icon: 'package',
    route: { pathname: '/(stack)/open-source', params: {} },
    titleKey: 'privacy.documentLicenses',
    hintKey: 'privacy.documentLicensesHint',
  },
] as const satisfies readonly { id: string; icon: IconName; titleKey: TranslationKey; hintKey: TranslationKey; route: { pathname: string; params: Record<string, string> } }[];
