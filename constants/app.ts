/**
 * Facts about this build, read from the manifest rather than typed twice.
 *
 * `app.json`'s `version` is the one a release bumps; a literal here goes stale
 * the first time someone forgets, and a version string that lies is worse than
 * none at all.
 */

import Constants from 'expo-constants';

export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';
