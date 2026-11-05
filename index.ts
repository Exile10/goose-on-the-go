// The push wake-up task must exist before anything else runs, including in a headless start
// that never mounts a screen. See services/background-notifications.ts.
// The OS may start the app only to run the wake task, so it is defined while the bundle loads.
import './services/background-notifications';
import 'expo-router/entry';
