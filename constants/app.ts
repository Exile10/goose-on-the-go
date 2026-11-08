/**
 * Facts about this build, read from the manifest rather than typed twice.
 *
 * `app.json`'s `version` is the one a release bumps; a literal here goes stale
 * the first time someone forgets, and a version string that lies is worse than
 * none at all.
 */

import Constants from 'expo-constants';

export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';

/**
 * Where Help & Feedback's emails go. A build can point them elsewhere with
 * `EXPO_PUBLIC_SUPPORT_EMAIL`; Expo writes the value in when it bundles the app.
 */
// eslint-disable-next-line i18next/no-literal-string -- an email address, not copy
export const SUPPORT_EMAIL: string = process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'support@jarida.io';
