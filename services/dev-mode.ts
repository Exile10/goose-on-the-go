/**
 * The one switch that lets this app talk to a Pond over plaintext HTTP.
 *
 * Expo Go has no PondTls native module, so it cannot pin the Pond's key and every
 * HTTPS Pond request would fail closed. For iterating on JavaScript in Expo Go only,
 * a development bundle started with `EXPO_PUBLIC_POND_INSECURE_DEV=1` may reach a
 * debug Pond's plaintext listener (`POND_DEV_INSECURE_LAN=1` on the Pond).
 *
 * The risk is total for that connection: nothing is encrypted or pinned, so anyone
 * on the network can read the pairing exchange, recover the six-digit code from it,
 * read and replay the bearer and refresh tokens, and impersonate either end. Use it
 * only on a network you control, against a Pond with nothing you mind exposing.
 *
 * It is `false` in every release bundle: `__DEV__` is false there whatever the
 * environment says. Every relaxation reads this constant and nothing else, so
 * searching for `insecureDevMode` finds all of them. Each one is narrower than the
 * flag: it applies to `http://` origins on a LAN address, and an `https://` Pond is
 * still pinned in a build that has PondTls. See docs/development.md.
 */
export const insecureDevMode: boolean =
  __DEV__ && process.env.EXPO_PUBLIC_POND_INSECURE_DEV === '1';

if (insecureDevMode) {
  console.warn('[dev-mode] insecure development mode: plaintext, unpinned Pond connections are allowed on the LAN');
}
