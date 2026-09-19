/**
 * Jest environment setup.
 *
 * Expo installs `fetch` on `globalThis` as a lazy getter that initializes its
 * native module bridge the first time anything reads it. That bridge does not
 * exist in a Node test environment, so the read logs a warning — and because
 * it surfaces after teardown, Jest escalates it to a suite failure even when
 * every test passed.
 *
 * Nothing here exercises Expo's fetch implementation: tests either stub
 * `fetch` outright or mock the network layer above it. So replace the lazy
 * getter with Node's own `fetch` (built in since Node 18) before any test can
 * trigger it.
 */
Object.defineProperty(globalThis, 'fetch', {
  value: globalThis.fetch,
  configurable: true,
  writable: true,
});

/**
 * AsyncStorage is a native module with no Node implementation, so importing it
 * throws in tests. The view-models reach it transitively — they read
 * `hydrated` off ServerProvider, which persists the server URL — so the mock
 * has to be installed globally rather than per-suite.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
