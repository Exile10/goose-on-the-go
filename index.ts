// The OS may start the app only to run the wake task, so it is defined while the bundle loads.
import 'expo-router/entry';

import { defineWakeTask } from './services/background-notifications';

defineWakeTask();
