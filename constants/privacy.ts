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

/** Sections under one heading: where the data is handled. */
export interface PrivacyGroup {
  id: string;
  headingKey: TranslationKey;
  sections: PrivacySection[];
}

/**
 * The summary, in the order the privacy policy tells it: what happens on this phone, on the Pond,
 * and what reaches beyond the home. Each section says, in short, what its part of the policy says.
 */
export const PRIVACY_GROUPS: PrivacyGroup[] = [
  {
    id: 'phone',
    headingKey: 'privacy.phoneHeading',
    sections: [
      {
        id: 'phone',
        icon: 'key',
        titleKey: 'privacy.phoneTitle',
        bodyKey: 'privacy.phoneBody',
      },
      {
        id: 'voice',
        icon: 'mic',
        titleKey: 'privacy.voiceTitle',
        bodyKey: 'privacy.voiceBody',
      },
      {
        id: 'camera',
        icon: 'camera',
        titleKey: 'privacy.cameraTitle',
        bodyKey: 'privacy.cameraBody',
      },
      {
        id: 'location',
        icon: 'pin',
        titleKey: 'privacy.locationTitle',
        bodyKey: 'privacy.locationBody',
      },
      {
        id: 'bluetooth',
        icon: 'bluetooth',
        titleKey: 'privacy.bluetoothTitle',
        bodyKey: 'privacy.bluetoothBody',
      },
    ],
  },
  {
    id: 'pond',
    headingKey: 'privacy.pondHeading',
    sections: [
      {
        id: 'local',
        icon: 'home',
        titleKey: 'privacy.localTitle',
        bodyKey: 'privacy.localBody',
      },
      {
        id: 'storage',
        icon: 'lock',
        titleKey: 'privacy.storageTitle',
        bodyKey: 'privacy.storageBody',
      },
      {
        id: 'faces',
        icon: 'face',
        titleKey: 'privacy.facesTitle',
        bodyKey: 'privacy.facesBody',
      },
    ],
  },
  {
    id: 'beyond',
    headingKey: 'privacy.beyondHeading',
    sections: [
      {
        id: 'network',
        icon: 'globe',
        titleKey: 'privacy.networkTitle',
        bodyKey: 'privacy.networkBody',
      },
      {
        id: 'notifications',
        icon: 'bell',
        titleKey: 'privacy.notificationsTitle',
        bodyKey: 'privacy.notificationsBody',
      },
      {
        id: 'remote',
        icon: 'wifi',
        titleKey: 'privacy.remoteTitle',
        bodyKey: 'privacy.remoteBody',
      },
      {
        id: 'never',
        icon: 'eye-off',
        titleKey: 'privacy.neverTitle',
        bodyKey: 'privacy.neverBody',
      },
    ],
  },
];

/**
 * Only the choices this app, the phone or the Pond actually offer. The five rows before these were
 * buttons with no handler, including an "opt out of analytics" for analytics that do not exist.
 */
export const DATA_RIGHTS: readonly { key: TranslationKey; icon: IconName }[] = [
  { key: 'privacy.rightUnpair', icon: 'link' },
  { key: 'privacy.rightUnreachable', icon: 'trash' },
  { key: 'privacy.rightRemote', icon: 'wifi' },
  { key: 'privacy.rightPermissions', icon: 'sliders' },
  { key: 'privacy.rightRemoveMember', icon: 'users' },
  { key: 'privacy.rightYourData', icon: 'server' },
];

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
] as const satisfies readonly {
  id: string;
  icon: IconName;
  titleKey: TranslationKey;
  hintKey: TranslationKey;
  route: { pathname: string; params: Record<string, string> };
}[];
