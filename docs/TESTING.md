# Testing

```bash
npm test           # run the suite once
npm run test:watch # re-run on change
npx tsc --noEmit   # typecheck (tests included)
npm run lint
```

Tests live in `__tests__/` beside the code they cover, named `*.test.ts`.

## What is worth testing here

This is a client for a rate-limited server on someone's home network, so the
bugs that hurt are the ones that make the app talk *too much*, not too little.
The suite exists mainly to pin down request behaviour: when we retry, how long
we wait, and when we stop.

The incident that prompted this suite makes the point. A push-token rotation
listener called a function that re-emitted to the listener itself, and the two
drove each other in an unbounded loop, spending the Pond's whole per-IP
rate-limit budget in seconds. Every request from the phone then returned 429,
including `handshake/init`, so pairing failed too: the app had denied itself
the recovery path.

Nothing about that was visible in a type error or a lint rule. When adding
network-adjacent code, prefer a test that asserts *how many* calls happen over
one that only asserts the happy path.

`services/__tests__/api-client.test.ts` is the worked example: it pins which
statuses are retryable and how `Retry-After` is parsed, including the
HTTP-date form that is deliberately not supported.

A regression test that passes against the buggy code is worthless. When you
add one, confirm it fails before you apply the fix.

## Setup notes

Two pieces of configuration are load-bearing and non-obvious:

- **`jest.setup.js` replaces the `fetch` global.** Expo installs `fetch` as a
  lazy getter that initializes its native bridge on first read. That bridge
  does not exist under Node, and the resulting warning surfaces *after*
  teardown, which Jest escalates into a suite failure even when every test
  passed. The setup file swaps in Node's own `fetch` before anything can
  trigger it.
- **`moduleNameMapper` redirects `expo-modules-core`, to two paths.**
  `jest-expo`'s preset cannot resolve it by name, and *where* npm puts it is not
  stable: it nests it under `expo/node_modules` in some resolutions and hoists it
  to the top level in others. The mapping lists both, and jest tries them in
  order — nested first, so that when there are two copies the tests use the one
  `expo` itself loads rather than a second version that could drift.

  A single path looks fine until the day it does not. Re-resolving the lockfile
  hoisted the package, the nested path stopped existing, and **every suite failed
  to run with zero tests** — a config error rather than a test failure, so the
  output blames the mapping and not the change that moved the package.

The preset is `jest-expo`, matched to the Expo SDK (`jest-expo@56` for SDK 56).
Upgrading the SDK means upgrading `jest-expo` in step — a mismatch fails at
`@react-native/jest-preset`, which is pinned to the React Native minor.

Current tests are pure logic with Expo modules mocked. Component tests will
need `@testing-library/react-native`, which is not installed yet.
