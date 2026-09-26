/**
 * What the privacy screen says, as catalogue keys. The copy lives in `services/i18n.ts`.
 *
 * Every statement behind these keys was checked against the Pond's source (#73), and several
 * replace claims that were not true: AES-256 encryption the Pond does not do, integrations with
 * Uber and Glovo that do not exist, voice biometrics that do not exist, and a "voice history"
 * setting that does not exist. Change the copy only with the same kind of evidence.
 */
import type { IconName } from './icons';

export interface PrivacySection {
  id: string;
  icon: IconName;
  titleKey: string;
  bodyKey: string;
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

/**
 * Open-source components this app ships, with the licence each package declares. Checked against
 * the installed packages in a test, so an entry cannot outlive the dependency it names.
 */
export const APP_LICENSES = [
  { name: 'React Native', pkg: 'react-native', license: 'MIT' },
  { name: 'Expo', pkg: 'expo', license: 'MIT' },
  { name: 'react-native-svg', pkg: 'react-native-svg', license: 'MIT' },
];
