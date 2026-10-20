// The push wake-up task must exist before anything else runs, including in a headless start
// that never mounts a screen. See services/background-notifications.ts.
import './services/background-notifications';
import 'expo-router/entry';
