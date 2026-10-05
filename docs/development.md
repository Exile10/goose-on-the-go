# Developing the app without a release build

Written 2026-10-05. Two ways to iterate on the JavaScript without compiling a
release APK for every change. Both are development-only, and a release build
ignores both switches.

| | Development build | Expo Go |
|---|---|---|
| Native code | This app's own, including PondTls | Expo Go's; no PondTls, no mDNS |
| Pond connection | Pinned HTTPS, as in release | Plaintext HTTP to a debug Pond |
| Switch | `POND_DEV_METRO_LAN=1` at prebuild (Android) | `EXPO_PUBLIC_POND_INSECURE_DEV=1` for Metro, `POND_DEV_INSECURE_LAN=1` on the Pond |
| Rebuild native when | Native code or config plugins change | Never |
| What it exposes | Metro's JavaScript bundle over Wi-Fi | Every Pond request, token and pairing |

Prefer the development build. Expo Go is for quick UI work against a throwaway Pond.

## Development build (expo-dev-client)

`expo-dev-client` is a dependency, so `npx expo start` serves a development build
by default (pass `--go` for Expo Go, below).

Build and install once, on a phone or emulator:

```bash
POND_DEV_METRO_LAN=1 npx expo prebuild --platform android --clean
npx expo run:android
```

After that, `npx expo start` and open the project from the dev client's launcher;
JavaScript reloads over Wi-Fi from Metro. Rebuild only when native code, a config
plugin, or `app.json` changes.

Why the variable: the Android network security config the `plugins/with-pond-tls.js`
plugin writes permits cleartext only to `localhost`, `127.0.0.1` and `::1`, so
without it Metro is reachable only through `adb reverse tcp:8081 tcp:8081` over USB.
With `POND_DEV_METRO_LAN=1` set when prebuild runs, the `debug` and
`debugOptimized` variants permit cleartext to any host. The `main` config, which
release uses, is written without reading the variable and stays cleartext-off.
Prebuild prints a warning when the variable is set.

What that exposes: Metro serves the bundle unauthenticated and unencrypted, so
anyone on the network can read the JavaScript and, by answering in Metro's place,
run their own in the app. Plain-HTTP requests from the app are also no longer
refused by the OS in that build. Pond requests are unaffected: the app marks every
Pond request, and PondTls refuses a marked request that is not pinned HTTPS
(`PondTlsTest.kt`), so the Pond connection is pinned exactly as in release.

iOS development builds already reach Metro on the local network
(`NSAllowsLocalNetworking`, `plugins/with-pond-tls-ios.js`) and need no switch.

## Expo Go (insecure development mode)

Expo Go cannot load PondTls, so it cannot pin the Pond's key and every HTTPS Pond
request fails closed with "Secure Pond connections require an Android or iOS
development or release build." For Expo Go only, both ends can agree to talk
plaintext.

On the development machine, run a **debug** Pond with the plaintext listener:

```bash
POND_DEV_INSECURE_LAN=1 cargo run -p pond-server -- serve
```

It serves the companion API over HTTP on port 4080 (`POND_DEV_INSECURE_LAN_PORT`
to change it), prints the address, and warns in its log at startup and every ten
minutes. A release Pond binary ignores the variable. See the Pond's
`docs/auth-network-posture.md`, "Development switches".

Then start Metro for Expo Go with the app's switch:

```bash
EXPO_PUBLIC_POND_INSECURE_DEV=1 npx expo start --go
```

In the app the pairing wizard opens on address entry (nothing advertises the
plaintext listener, and Expo Go has no mDNS module). Type
`http://<the Pond's LAN address>:4080`, then the six-digit code as usual. A
persistent "Insecure development connection" banner stays at the top of every
screen while the mode is on; it cannot be dismissed.

How it is gated: `services/dev-mode.ts` exports `insecureDevMode`, which is
`__DEV__ && process.env.EXPO_PUBLIC_POND_INSECURE_DEV === '1'`, and every
relaxation reads it and nothing else. `__DEV__` is false in every release bundle,
whatever the environment says. Even when it is on, each relaxation applies only to
an `http://` origin on a LAN address (loopback, `.local`, a bare host name, or a
private IPv4 address); an HTTPS Pond is still pinned where PondTls exists, and is
still refused where it does not.

What changes for a plaintext origin:

- `models/connection.ts` `normalizePondUrl` accepts it; saved profiles keep it as a
  local address. Remote addresses stay HTTPS-only.
- `services/pond-trust.ts` pins nothing for it and lets requests to it through.
- `services/api-client.ts` and the notification stream send it as ordinary
  requests, without the `X-Pond-Transport` marker (PondTls would refuse it).
- `pair()` sends no channel binding and so checks no server proof: plaintext has
  no TLS key for either to name. The pairing keeps the pin the Pond reports in
  `/system/info` only so the saved pairing has its usual shape; nothing is ever
  verified against it, so the wizard does not ask the user to confirm it.
- Remote access is unavailable (`remote.unsupported`).

What it exposes: everything. Anyone on the network can read every request and
response, including the session and refresh tokens, which are also valid on the
Pond's HTTPS listener; can recover the six-digit pairing code offline from one
captured pairing; and can impersonate the Pond to the app or the app to the Pond.
Use it on a network you control, against a Pond that holds nothing you mind
exposing, and pair again over HTTPS before trusting that Pond or that phone again.

## Tests

`services/__tests__/dev-mode.test.ts` loads the modules fresh under each
combination of `__DEV__` and the variable, and checks that every relaxation is off
unless both are set. The HTTPS suites (`pond-trust`, `https-requests`,
`https-pairing`, `api-client`) run with the variable unset and are unchanged.
