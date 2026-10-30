# Pinned HTTPS and roaming

## Compatibility and branch dependencies

This milestone targets native Android and iOS builds. Expo Go and browsers do not
provide the required native trust module. Existing HTTP-only profiles require a
fresh QR scan on the Pond's LAN. Outside insecure development mode
([development.md](development.md)), there is no insecure pin discovery fallback: a
pin advertised on the network is only offered for the user to pick out against the
Pond's own screen (see "Trust lifecycle").

For development without a release build, see [development.md](development.md):
a development build keeps every Pond connection pinned, and Expo Go can use an
explicitly insecure, development-only plaintext mode (2026-10-05) that release
bundles cannot enable.

Both fork and upstream remotes were fetched on 2026-09-19. The branch was
rebased onto upstream main `aee8e4d`, which contains W1 and the earlier integration
work; the remaining keyboard adjustment is `e7f374d`. Pond was rebased onto
upstream main `d0bccd41`, including W1. Both fork main revisions are ancestors of
these bases. Pre-rebase branches and working changes remain in local backup
branches and named stashes until delivery is complete.

## Trust lifecycle

`models/pairing.ts` validates v2 HTTPS QR payloads. `ServerProvider` stages the
public-key pin through `PondTls` before contacting local candidates. Discovery
can also offer the pin the Pond advertises beside its mDNS service, but that is
a claim, not trust (2026-09-30). The wizard shows its preview beside two decoys
that share the first group of four, and only picking the one on the Pond's own
screen continues. A wrong pick or "None of these match" ends discovery for that
step, after which only a typed fingerprint or a QR scan can continue. Decoys and
order come from expo-crypto (`services/secure-random.ts`). Initialization and
verification must be local; the Pond independently checks the actual TCP source
subnet. Manual pairing asks for the HTTPS address, six-digit code, and full
public-key pin shown locally on the Pond.

Pairing is CPace (2026-10-13). Every pairing from the phone, whether the pin came from a QR, a typed fingerprint
or mDNS, runs CPace (draft-irtf-cfrg-cpace-21, suite CPACE-RISTR255-SHA512) with
the six-digit code as the password (goose-in-a-pond#508), or, to claim a Pond that
has never been set up, its setup card's eleven digits ("Setup cards and spoken
codes" below). There is no other pairing path, no fallback and no negotiation. `PondApiClient.pair()` reads
`/system/info` first, and a Pond that does not report `protocol: 3` stops the
wizard with `pairingErrors.pondOutdated` before anything is sent.

The exchange fits the two existing round trips. The Pond is the CPace initiator
and the phone the responder:

1. `POST /api/v1/handshake/pake/init` with `client_id`, `channel_binding` (the
   pin) and a 32-byte `client_nonce`. The Pond commits to its newest active code
   and answers with a 32-byte `challenge` and its share.
2. The phone derives the generator from the code, the channel identifier
   (label, the pin, the client id) and sid (`challenge || client_nonce`), and
   sends its own share and confirmation tag to `POST /api/v1/handshake/pake/verify`.
3. The Pond checks that tag, consumes the code and answers with tokens and its own
   confirmation tag in `server_proof`. The phone keeps no token until that tag
   verifies, in constant time; a missing or wrong tag is a `PondTrustError`.
   So is a share that does not decode, an identity share, or an unexpected suite
   in step 1, and then nothing derived from the code is sent at all.

`services/cpace.ts` holds the exchange. Its draft half is held to the draft's
Appendix A.1 and B.3 vectors, and the whole run, on the wire included, to one fixed
exchange the Pond generates. Both files in `services/__tests__/vectors/` are
byte-identical copies of the Pond's `crates/pond-infra/tests/fixtures/`, so a
change to either side fails the other's tests until the copies are refreshed.
Shares are base64 and tags lowercase hex. Randomness comes from expo-crypto
through `services/secure-random.ts`; the noble libraries are pinned exactly.

What it changes: before, whoever terminated the phone's TLS received an HMAC keyed
by the code and could recover all six digits offline in about a second. Under
CPace nothing on the wire can be tested against a guessed code offline, so each
guess costs a live exchange with the Pond, one guess per attempt.

What the pin still does: it authenticates the Pond's TLS key, so tokens and every
later request still travel only to that key, and it is the channel binding. The
Pond always puts its own pin in the channel identifier and the phone puts the pin
it connected under, so a phone pinned to any other key runs a different generator
and the pairing fails. A wrong pin therefore fails visibly, but it is still not
safe to keep, which is why the pick-from-three check above stays. The
`channel_binding` sent in step 1 is only an early diagnostic: the Pond refuses
with `channel_binding_mismatch` when it is not its own pin, `ApiError.detail`
carries that code, and the wizard shows the `connection.trust` message for it
rather than the off-LAN `pairing.lan`.

The failure budget: online guessing is the only attack left, so the Pond retires
a code after 10 failed confirmations against it, whatever addresses they came
from, which bounds an attacker at 10 in 10^6 per code. A retired code is reported
as `code_retired` and the wizard shows `pairingErrors.codeRetired`, which asks for
a new code from the Pond's dashboard; `pairingErrors.badCode` warns of the limit.
Each challenge is single use and lives 60 seconds, as before.

In insecure development mode the plaintext listener runs the same exchange. The
pin there is the one the Pond reported for itself, so it binds nothing, but the
code is still never sent in a form that can be tested offline, and the Pond's
confirmation is still required.

`paired-profile.ts` writes the new non-secret address record while preserving the
old one, then atomically commits pin and credentials together in SecureStore.
Failed secure commits leave the old profile loadable. A saved profile's ID ties
its credentials to its address record. Cancellation invalidates in-flight
staging and restores the saved profile. A commit already in progress finishes
before cancellation or sign-out is handled.

The Expo config plugin installs the OkHttp factory before React Native and Expo
initialize and copies the Kotlin module and native tests during prebuild. Both
Expo fetch and RN XHR obtain clients through this factory. The native request
interceptor checks the expected SPKI pin against the authenticated TLS session
before HTTP headers/body are sent, including reused connections. Certificate
validity and standard hostname checks remain mandatory. Configured Pond
redirects are rejected before OkHttp can follow them. Unrelated connections use
platform trust validation. Clearing/changing trust cancels dispatchers and evicts
connection pools, including resources shared by copied clients.

On iOS, the plugin installs `PondURLProtocol` through both React Native's and
Expo fetch's session configuration hooks before either networking stack starts.
The protocol intercepts only configured Pond origins and explicitly marked Pond
requests. It uses an ephemeral session per request, validates the pinned SPKI,
certificate validity and the hostname through Security.framework, and rejects
redirects. Trust changes cancel active requests. Unrelated traffic retains the
platform's normal URLSession validation. Native source files, bridge registration,
and Xcode source membership are regenerated by Expo prebuild; no manual edits to
the generated `ios/` directory are required.

### Setup cards and spoken codes (2026-10-17)

A Pond with no screen is claimed with the card printed for it at install
(goose-in-a-pond, `docs/architecture/pond-networking.md`, "Claiming a pond" and
"Wire contract over the LAN (P3)"). The card's QR is
`pond://setup?v=1&code=<11 digits>&id=<4 hex>`. `models/setup-card.ts` parses it and
refuses exactly what the Pond's `setup_card.rs` refuses: another scheme or host, a
path, port, user or fragment, any repeated parameter, another version, a code that
is not eleven bare digits with a valid Luhn check digit, and an id that is not four
hex digits. Unknown parameters are ignored. The tests run the parser under Node's
URL and under whatwg-url-minimum, the URL Expo installs on a phone.

The exchange is pairing's, opened with `"credential": "setup"` in `pake/init`. The
password is the eleven ASCII digits without dashes, and the channel identifier is
`lv_cat("goose-setup-cpace-v1", pin, client_id)`, so a setup code and a pairing code
never share a generator. Session id, shares, tags, `verify` and the check on the
Pond's confirmation are unchanged. A pairing init names no credential: absent means
pairing, so it is still byte for byte the request the Pond's vectors pin, and a Pond
older than the field reads what it always has. The Pond has no setup vector yet;
`pairing-exchange.test.ts` holds the setup label to the pairing construction.

A typed setup code is checked against its Luhn digit as it is typed, and a typo is
named before anything is sent. A scanned card is found by the `id` the Pond
advertises; the card carries no pin, and the pin comes from that advertisement.

There is no pick-from-three before a setup exchange. A completed setup exchange is
bound to the Pond's real pin through the channel identifier, so a spoofed pin can
only fail it, never succeed; and a Pond with no screen has no fingerprint to pick
against. The same skip applies to a Pond that advertises `setup=1`, which is
unauthenticated: a spoofed `setup=1` on a claimed Pond skips the pick, and the
exchange that follows still fails under the wrong pin.

A spoken code skips the pick too, whatever `setup=1` says. Every pairing exchange is
CPace with the pin in the channel identifier, so a completed spoken-code pairing
proves the pin exactly as a setup exchange does, and a second household member
adding a phone to a claimed Pond with no screen has nothing to pick against. The
pick view offers "My Pond has no screen: have it say a code", which stages the
advertised pin unpicked and asks the Pond to speak. A six-digit code read off a
dashboard or a terminal keeps the pick: that household has a screen. So when a
pin was staged unpicked (a card, `setup=1`, or the spoken path) and a six-digit
code is entered without the Pond having said one, the wizard sends the user back
to the pick first, keeps the code, and goes on to naming once the right
fingerprint is chosen. `pickBeforeExchange` in `models/connection.ts` is that rule,
and is unit tested.

The refusals a setup run adds:

| Answer | Meaning | What the phone does |
|---|---|---|
| `409 setup_code_unavailable` at `init` | The Pond is claimed, or has no code | Says to ask whoever set it up, or to have the Pond say a code; retry opens the six-digit entry |
| `429 setup_code_cooling`, `retry_after` | Wrong guesses are being slowed | Counts the wait down on the failure screen, retry held until it ends |
| `accepted: false`, `setup_code_unavailable` at `verify` | Another phone claimed it in between | Says so; retry opens the six-digit entry |
| `accepted: false`, `invalid_confirmation` | Wrong setup code | Its own sentence: a setup code is slowed, never retired |

`ApiError.retryAfterSecs` reads `Retry-After` first and the body's `retry_after`
when the header is missing.

The spoken code is the way in without a card, and the way a second phone joins a
Pond with no screen. `POST /api/v1/handshake/spoken-code`, no body and no token, goes
only to the staged Pond, after the same Wi-Fi or Ethernet check pairing has. `202`
means the Pond is reading a six-digit pairing code aloud; the answer never carries
the code. The code step then takes six digits and pairing continues as it always
has, with credential `pairing`. `429 spoken_code_limited` is counted down from its
wait, `403 spoken_codes_disabled` says the household turned it off, and
`503 announcer_unavailable` says the Pond cannot make a sound. A tap while a request
is in flight sends nothing, because each request is a code said aloud in the house.

None of this has run on a device or against a real Pond yet. A device run has to
check: scanning a printed card, the typo message, the cooling countdown, the spoken
code from request to pairing (including from the pick view of a Pond with no
screen), a dashboard code after an unpicked pin going back to the pick, and a
claimed Pond's message.

### Over Bluetooth, then HTTPS (2026-10-17)

A Pond with no network is claimed over its BLE setup channel (goose-in-a-pond
`docs/architecture/pond-setup-channel.md`; ARCHITECTURE.md, "The setup channel").

- **The pin.** There is no TLS on that link, so the pin the phone binds is the one `hello`
  reports. The exchange that follows is the same CPace run with that pin in the channel
  identifier, so a relay that substitutes its own pin fails confirmation. A completed exchange
  therefore proves the pin exactly as a completed HTTPS setup exchange does.
- **The tokens** arrive sealed under a key drawn from that exchange. The phone opens them only
  after the Pond's `server_proof` verifies.
- **The handover.** After `wifi_join` answers with an address, the pairing is committed at
  `https://<address>:<port>` under that proven pin, before anything is reached
  (`adoptPairing`). From then on the Pond is pinned HTTPS like any other. The address came over
  the sealed channel, and a substituted address would fail the pin.

Owed on a device: the scan finding the Pond by the card id in its advertised service UUID, the claim, a Wi-Fi join with a wrong and then a right password, the handover with
the phone on the same network, and the "connect this phone" state from cellular.

## Recovery

One connection manager handles endpoint selection for the provider, REST and SSE.
Wi-Fi prefers local candidates; cellular uses tailnet. On Wi-Fi every saved local
address is probed at once, and the tailnet joins after a 250 ms head start, or as
soon as every local address has failed; mDNS discovery runs alongside the tailnet
rather than ahead of it. A local answer wins whenever it comes first. Until
2026-10-05 the order was strictly sequential, so away from home a Wi-Fi network
held remote access up for each saved address's three-second probe timeout, then
for discovery.

Foreground resume and network changes restart selection. When the phone already
has a working route, it stays on screen while it is re-checked; only a failed
check changes the state. A saved pairing starts as `reconnecting`, never
`unpaired`, and the last working route outlives the provider: Android recreates
the activity on a return to the app, and React builds a new manager with it, which
used to show `unpaired`, then `reconnecting`, on every return. The remembered
route is used only while the profile still names it, and forgotten when the Pond
refuses the phone. The banner waits 1.5 s before reporting `reconnecting`, and
says nothing until the saved pairing has loaded, because it pushes every screen
down.

A route that was working and then fails gets one more pass a second later, inside
the same recovery, before the failure is announced; the read that asked for it is
retried against whatever that pass finds. On cellular the tailnet path drops for
about a second now and then, and each drop used to show `disconnected` and fail a
refresh. A network event that reports no connection at all is ignored: Android
sends one between Wi-Fi and cellular, probing then could only fail, and the
network that follows raises its own event.

A probe of the tailnet address waits, for up to ten seconds, until this phone's own
node reports `Running`. On a cold start the node takes seconds to come up and every
earlier probe failed at once, which reported "Pond unavailable" for twelve seconds
on the A57 and set off a backoff that delayed the connection further once the node
was ready. The wait keeps the state `reconnecting` and probes the moment the node is
up; a node that does not start within the budget is reported as unavailable. Home's
Pond card says it is looking for the Pond while a reconnect is in progress,
rather than "Pond unreachable" beside a banner saying it is reconnecting.

Failures use coalesced, bounded recovery with stale-generation rejection and no
background probes. NetInfo uses native reachability, never an external internet
check or SSID collection. While connected remotely on Wi-Fi, six bounded LAN
rechecks can return to a local endpoint after a temporary outage without requiring
another network event.

Reads retry once after successful recovery. Ambiguous writes and refresh-token
rotations are not replayed. SSE reconnects using the newly selected endpoint and
shares a bounded notification-ID cache across stream instances. Connection and
trust failures use bundled i18next messages.

## Verification

Run `npm test -- --runInBand`, `npx tsc --noEmit`, and `npm run lint`. Regenerate
Android with `npx expo prebuild --platform android --no-install`, then run
`./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleRelease` from
`android/`. Tests include two independent factory clients, incorrect pins,
certificate renewal with the same key, expiry, hostname mismatch, redirects,
plaintext, cleared trust, and unrelated self-signed traffic.

For this SDK 56 application, run
`npx expo prebuild --platform ios --no-install --template expo-template-bare-minimum@56.0.36`, install CocoaPods
dependencies, and build the generated workspace with a full Xcode installation.
`python3 tests/native-ios/run.py` independently compiles the shared Apple transport
core on macOS and exercises it against a real local TLS server. It covers SPKI
extraction against OpenSSL, key-preserving renewal, expiry, malformed DER,
independent fetch/XHR session configurations, SSE, hostname mismatch, wrong pins,
redirects, plaintext, cleared trust and unrelated traffic. It asserts that rejected
requests and redirect destinations receive no HTTP headers. This core test is not
an iOS app build or a physical-device test.

After rebasing on 2026-09-19, all 140 JavaScript tests, TypeScript, and lint
(zero errors, 19 pre-existing warnings) pass. Android development/release builds
and all nine native TLS tests also pass after the rebase. The Apple transport
core passes under Xcode 27.0 (27A266a).

On 2026-09-20, the separate iOS simulator app passed all 17 integration checks.
It exercises the installed Expo fetch and React Native XHR implementations,
notification streaming and deduplication, wrong pins on both transports and SSE,
real expired certificates, hostname mismatch, redirects, plaintext refusal,
cleared trust, atomic SecureStore persistence, background/foreground resume, and
persistence after process restart. It also pairs with a real scratch Pond,
refreshes the token, reads authenticated REST, and receives live SSE. The fixture
completes onboarding through the normal loopback API; it does not bypass auth or
the onboarding guard. The fixture servers assert that rejected requests never
reach HTTP and that redirect destinations receive no request.

Run this from the Mac with a booted simulator and installed Pods:

```sh
python3 tests/native-ios/app_integration.py --device <simulator-UDID> --derived-data <build-directory>
```

The runner builds a separate `io.jarida.gooseonthego.transporttests` bundle using
an alternate JS entry. Xcode ad-hoc simulator signing supplies isolated Keychain
entitlements. This never uses production app data or device signing keys.

The same runner supports a USB-connected Android device with Java 17 and the
Android SDK's `adb` on `PATH`:

```sh
JAVA_HOME=$(/usr/libexec/java_home -v 17) python3 tests/native-ios/app_integration.py --platform android --device <adb-serial> --pond-lan
```

`--pond-lan` sends real pairing, REST, refresh, and SSE requests directly to the
scratch Pond's advertised LAN address. The phone must share that LAN with the
Mac. Only the certificate-failure fixtures use temporary USB port forwarding.
Omitting the option forwards the scratch Pond through USB too; that mode does
not establish direct-LAN pairing or any cellular/VPN behavior.

The test-only Gradle initializer builds a Release APK with the separate
`io.jarida.gooseonthego.transporttests` application ID and the existing debug
signing configuration. The runner verifies the packaged ID before installation,
clears only that test app's data, and tests a second process launch without
clearing it. Production app data and signing keys are untouched. Only this run's
USB mappings are removed during cleanup. The generated Release APK is a test
artifact; rebuild without the initializer before distributing the normal app.

On 2026-09-20, all 17 checks also passed on a physical Samsung Galaxy A57
(SM-A576B, Android 16) using that isolated Release APK. Real pairing,
authenticated REST, refresh, and SSE connected directly over home Wi-Fi to the
Mac's scratch Pond. The USB fixtures verified both native HTTP clients and SSE,
incorrect pins before HTTP, expired certificates, hostname mismatch, redirects,
plaintext refusal, cleared trust, notification deduplication, foreground resume,
and SecureStore persistence across process restart. Fixture assertions confirmed
that rejected requests and redirect destinations received no HTTP request.
The production package's version and installation timestamps were unchanged;
the test APK contained no generated Firebase app ID, API key, or sender ID.
Temporary forwarding and scratch servers were removed successfully afterward.

The physical run used a freshly compiled Pond W2 server. All 140 JavaScript tests
and typechecking also passed; lint retained the same 19 existing warnings.
This evidence does not cover the Jetson runtime, cellular/VPN transitions,
another Wi-Fi network, or physical iPhone behavior. Full UI re-pairing and
cancellation remain distinct from the native/API harness checks.

### Xcode 27 compatibility

The config plugin aligns dependency resource-bundle targets with the app's iOS
16.4 minimum. SDK 56 needed `scripts/patch-expo-jsi.cjs` after npm install to fix
its nullable C callback construction. SDK 57 fixed the same construction upstream,
passing a typed optional setter that stays nil for read-only host objects, so the
patch was retired with the upgrade.

The first runtime launch exposed incompatible precompiled ExpoCamera/Core Swift
symbols even though compilation passed. `EXPO_USE_PRECOMPILED_MODULES=false`
now builds the installed Expo sources together; React Native's supported prebuilt
core remains in use. No linker checks are suppressed.

The SDK 56 template also lacked the [scene lifecycle required by iOS 27](https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle),
so this plugin once carried its own `PondSceneDelegate`. SDK 57.0.23 ships
`ExpoAppSceneDelegate` behind expo-build-properties' `ios.enableSceneSupport`,
and the app now uses that instead: it creates the window, forwards lifecycle
events, warm and cold links, user activities and quick actions to every
`ExpoAppDelegate` subscriber. Keeping both fails prebuild, because each declares
`UIApplicationSceneManifest` and each rewrites the AppDelegate's window startup.
This plugin now only installs TLS before React Native initialization.

Final Debug/simulator and unsigned Release/iphoneos builds both pass with these
compatibility changes. Device Release compilation does not establish physical
roaming or App Store signing readiness. A separate simulator build of the normal
Expo Router entry also launches and renders the home screen with no saved
profile. The connection banner respects the safe area and routes unpaired
users to local pairing.

The upstream developer screen retains its per-screen backend controls. Its Pond
connection editor now opens local pairing; it cannot switch a saved identity to
an arbitrary origin without the pairing flow. Data hooks remain gated on
completion of native trust hydration.

Physical iPhone roaming is explicitly deferred because no iPhone is available.
The remaining device acceptance matrix covers Android and, when available, iOS:
home LAN, cellular with VPN, another Wi-Fi, then home LAN. Repeat after restarting
the app/server and changing the LAN address. Verify both REST and SSE fail on an
incorrect pin, and show a useful unavailable state with VPN off. Unit tests and
APKs alone cannot establish that matrix.

No production signing keys or database migrations change in this milestone.
TLS does not complete the separate W3 authorization-hardening work.


## Embedded-network continuation (2026-09-20)

The `feature/embedded-tailnet` branch adds explicit remote-access opt-in, native
per-profile node restoration and an authenticated local CONNECT transport. Local-only
profiles do not start the node or probe tailnet addresses. Enrollment administration
credentials remain on the Goose service; the phone never receives them.

Measured on this branch: 151 app tests and typecheck pass; lint has zero errors and
19 existing warnings. The ARM64 iOS simulator Debug and unsigned iOS device Release
builds pass. The connected Galaxy A57 and existing iPhone simulator both pass the
isolated native Expo fetch, RN XHR/SSE, pin/validity/hostname/redirect/plaintext,
secure persistence, foreground and scratch-Pond integration suites. These suites
exercise LAN/loopback transport with the embedded library linked; they do not yet
prove embedded proxy activation or cellular roaming.

Run `npm run build:network` (or `scripts/build-embedded-network.sh android|ios|all`)
against the adjacent Pond checkout (override `POND_SOURCE_ROOT` if necessary). Go and
gomobile versions come from that checkout's `native/pondnet/go.mod`; the script builds
its pinned gobind rather than depending on a globally installed version. It finds the
Android SDK and the newest complete NDK itself, and checks every prerequisite before
compiling anything. It skips a platform whose inputs are unchanged since its last build,
recorded under the gitignored `native/pondnet/.build/` (`--force` overrides that).
It refuses to start while another build is writing `native/pondnet`, and swaps a
library into place only once it is complete. A cold Android build compiles Tailscale
for four ABIs and is slow, so the script reports its elapsed time every 30 seconds.
Regenerate through Expo prebuild afterward. Keep iOS Debug and Release builds serialized: React Native
replaces shared prebuilt frameworks under `ios/Pods`, even when DerivedData differs.

Logout now requires the Pond's positive revocation acknowledgment before clearing
local credentials. Failed revocation remains available for an explicit retry.
Secure token writes are serialized before profile commits to prevent an older
refresh from overwriting the newly selected profile revision.

Remaining: end-to-end embedded proxy tests on both platforms, iOS 16.4 proxy
failure behavior, enrollment recovery after ambiguous writes/revocation, public
infrastructure and real cellular roaming. No additional simulator was created;
physical iPhone acceptance remains deferred. The paired Pond's deployment and
verification ledgers are `deploy/remote-access/README.md` and
`docs/embedded-remote-access-verification.md` in the Pond repository.

### The cached network map is erased when remote access goes off (2026-10-05)

When remote access goes off for a profile -- "keep local only", or a pairing the Pond
forgot -- the native layer erases the network map the node cached for it. The
coordinator lets phones cache their map so a cold start can reach the Pond before the
control login finishes; the map lists the household's peers, their addresses and the
access rules, and holds no private keys. Both paths reach `PondNetwork.activate` with no
coordinator, which stops the node and calls `forgetNetworkMap`; that hands the profile's
directory to the Pond library's `Mobile.disable`, which erases the map and keeps the
node's keys. A map that cannot be erased is logged. The measurements above predate this
change and do not cover it. See the Pond's `docs/remote-access.md`.


### Embedded transport continuation (2026-09-20)

Failed native activation now stops the partially initialized node on both platforms.
Failed allowlist replacement preserves the preceding configuration. The Go mobile
proxy uses the userspace WireGuard TCP stack directly: tsnet's general-purpose
`Server.Dial` may use system routing for unknown peers and is unsuitable here.
The real Headscale isolation/forced-DERP/restore/revocation suite passes with the
strict dialer, and both native libraries were rebuilt.

Run these additional client checks from GOTG with the pinned Go toolchain on PATH:

```sh
python3 tests/native-ios/run_proxy.py
bash tests/native-android/run_proxy.sh
```

The Apple test links the production native transport with a test-only node-lifecycle
binding; Android substitutes only the native proxy endpoint. Both use the real Go
CONNECT proxy against isolated TLS listeners. Correct pins, hostname/expiry checks,
redirect/plaintext rejection, unavailable-proxy refusal, and withholding proxy
credentials from Pond HTTP pass. These checks do not prove a complete mobile node
connected through Headscale. Apple core results are from macOS, not iOS 16.4.

The existing iPhone simulator passes 19 first-run and three restart app checks,
including the real Go binding's failed-start cleanup and disabled remote fetch/XHR.
The connected Galaxy A57 passes the 19 first-run checks. Its restart test was
interrupted when the test task was removed and requires a rerun. The production
phone package is preserved.

The Android binding build now covers `armeabi-v7a`, `arm64-v8a`, `x86`, and `x86_64`,
matching the app's advertised architectures. Expo prebuild installs an ABI check
before native builds, preventing an incomplete AAR from silently shipping.
Full Headscale/mobile enrollment recovery, iOS 16.4 runtime validation, physical
cellular roaming and physical iPhone acceptance remain open.

Normal iOS Debug simulator and unsigned Release device builds also pass with the
updated transport. The ABI gate was exercised against the actual old and rebuilt
AARs: the two-architecture archive was rejected, and the complete archive passed.

Normal Android Debug and Release builds pass with the ABI gate installed. Inspection
of both APKs confirms an embedded library for each of the four architectures. All
13 native TLS/proxy tests pass with zero skips. These normal artifacts were built
only; they were not installed over the production phone app.

## Embedded identity and enrollment recovery (2026-09-20)

Remote activation now binds every configuration, enrollment and address request to
its selected LAN endpoint. Roaming of the shared API client cannot redirect those
requests to the remote path. These requests do not automatically retry or rotate
credentials after a failure; the Pond still checks the actual peer interface.

The native helper reports its public machine key before registration. Locally
signed enrollment includes this key and the exact pending authorization ID, allowing
the enrollment service to reconcile a lost registration response without replaying
the write. Private machine keys remain in native storage. Damaged identity state
fails before network startup; a persistence failure remains visible until repair
and restart. Valid existing state retains its keys.

All 154 app tests and typechecking pass; lint has zero errors and 19 existing
warnings. The Galaxy A57 completed the isolated 19-check initial phase and all
three restart checks over direct LAN. This does not establish public cellular
roaming or a fully enrolled mobile path through Headscale. The same-key node restart,
real Headscale response-loss recovery, household isolation and forced relay tests
pass separately in the Pond repository. Explicit recovery of revoked device
identities and full mobile embedded enrollment remain acceptance work.

The existing iPhone simulator also passed the 19 initial and three restart checks
with the rebuilt library. Normal iOS Debug simulator and unsigned Release device
builds pass, as do Android Debug/Release builds and all 13 native TLS/proxy tests
with zero skips. Both Android APKs contain all four required Go-library ABIs.

### Recovery review shows the machine key (2026-09-30)

While a recovery request waits for approval, the phone shows the request id and
`mkey:` with the first sixteen hex digits of its new machine key
(`machineKeyPreview` in `services/remote-access.ts`), grouped in fours as the
Pond's review shows them. Approve the request only when the Pond shows this
phone's name and the same key. The measurements above predate this.

### Superseded node identities are erased (2026-10-05)

Each pairing's node runs in its own directory under `pond-network/`
(`noBackupFilesDir` on Android, Application Support on iOS), named after the
pairing's profile, and that directory holds the node's private machine and node
keys. A new pairing used to leave the previous directory behind: the Galaxy A57
held 33 of them on 2026-10-05, each with keys. `PondNetwork.activate` on both
platforms now calls the Pond library's `Mobile.prune` with the active profile once
its node has started, or with no coordinator once it has stopped. Every other
directory is erased. A forgotten pairing activates with an empty profile and keeps
none. A failed start prunes nothing, so it never costs the identity it was meant
to use. The library refuses a directory whose node lock is held, reports the count
and any failure in the event log, and the plugin logs the failure too. The
behaviour and its tests are in goose-in-a-pond `native/pondnet/mobile/prune.go`;
this app needs a `pondnet.aar` and `Pondnet.xcframework` built from a Pond that has
it, or the call fails to link.

### A lapsed phone enrols again with fresh keys (2026-10-12)

When a phone is not seen on the home network for 30 days, the Pond revokes its
tailnet enrollment. The coordinator keeps the revoked machine key as a tombstone,
so that a late registration under it can still be deleted, and it refuses to enrol
that key again. A phone that was not re-paired kept presenting the same key, so it
could never get remote access back (goose-in-a-pond#476).

The Pond now answers that enrollment with `409 {"error":"stale_identity"}` when its
revoked or failed record holds the phone's current machine key. `requestLocal`
carries the body's `error` into `ApiError.detail`, and `enableRemoteAccess`
(`services/remote-access.ts`) matches it there. It then calls the native
`resetIdentity` (`PondNetwork` in `plugins/pond-tls/PondNetwork.kt` and
`plugins/pond-tls/ios/PondNetwork.swift`), which stops the node, forgets the
active profile and erases every node directory under `pond-network/` through the
Pond library's `Mobile.prune(base, "")`. It starts a node, which makes new
WireGuard and tailnet keys, and submits the enrollment once more under the new
machine key, which replaces the revoked record through the Pond's normal path.

The new key is enrolled with the same checks as before: the phone must still be on
the home network with a valid bearer token. The 409 is a refusal, not an ambiguous
failure, and the second write carries a different key, so this is not a replay of
the first. A second `stale_identity` stops and shows `remote.identityStale`; there
is no third attempt. Every other 409 is reported as before and erases nothing. The
user sees no new screen, only the existing enrolling state for a little longer.
Each lapse and return retires the old record against the household's bounded
retirement budget, which the Pond already charges for a replacement.

This needs the Pond's `stale_identity` answer, and a `pondnet.aar` and
`Pondnet.xcframework` built from a Pond with `native/pondnet/mobile/prune.go`, or
`resetIdentity` fails to link. The jest suite covers one reset and one resubmit,
the refused second attempt, and other 409 reasons. The native method was not run on
a device here. The device test is to lapse a phone, or have its Pond record revoked
under the same key, then enable remote access and confirm it comes back.


## Current embedded validation and platform fixes (2026-09-20)

The full mobile application now enrolls through real local Headscale and reaches
its scratch Pond over the Goose DERP relay on Android and iOS. Peer status confirms
relay use without a direct route. The suite covers native Expo fetch and RN XHR/SSE,
authenticated REST and refresh, LAN-only pairing, forged forwarding identity,
incorrect pins, certificate renewal with the same key, expiry, hostname mismatch,
redirects, plaintext, native shutdown, local re-pairing and approved replacement.
The existing iOS 27 simulator also passes coordinator/relay outage recovery and
full app-process restart with the persisted network identity and credentials.
The Android emulator passes these transport and recovery checks; the final
infrastructure-restore/process-restart run is recorded in the Pond verification ledger.

Android's sandbox requires a native NetworkInterface provider for the embedded Go
node; it cannot enumerate interfaces through netlink. ConnectivityManager forwards
network changes without collecting SSIDs. Native logging uses the private profile
directory, while upstream remote log upload remains disabled.

The embedded Android library is linked with 16 KB ELF alignment. The build script
checks every 64-bit library in its AAR; the app integration harness checks every
64-bit library in the APK before installation. A dedicated API 37 ARM64 emulator
with 16 KB pages exposed the original 4 KB libgojni.so alignment. The rebuilt test
APK passes all 31 native-library checks and runs without compatibility mode.

SDK 56 Expo fetch enqueued its native call before publishing the STARTED response
state. Immediate policy rejection could arrive while INITIALIZED and be dropped,
leaving the JavaScript promise pending. `scripts/patch-expo-fetch.cjs` applies an
idempotent, source-checked postinstall fix that publishes STARTED before enqueue.
It fails visibly if upstream source changes. The before-fix emulator log records
`currentState[0]` rejection and a bounded test failure; the corrected app repeats
immediate plaintext rejection 20 times. The patch changes callback ordering only.

On iOS, scoped ATS exceptions for 100.64.0.0/10 and fd7a:115c:a1e0::/48 permit
request-scoped verification of the self-signed Pond certificate. PondURLProtocol
intercepts every request to those ranges, including unmarked/unconfigured requests,
and requires HTTPS, saved SPKI, valid dates and the expected hostname. Unrelated
traffic retains platform validation. Native CONNECT tests also verify that proxy
credentials never reach Pond HTTP. The deployment minimum remains iOS 16.4; its
older runtime proxy path is not established by iOS 27 simulator results.
Tailscale's own service address (100.100.100.100, fd7a:115c:a1e0::53) lies inside
those ranges but is never a Pond: since 2026-09-30 the remote-target check,
`PondNetwork.remote`, refuses it on both platforms, so it is never configured as a
proxy target.

Fixtures compile an isolated CA through a temporary Go overlay, keep administration
credentials in private scratch files, and restore normal libraries in cleanup.
Never ship a fixture library or the isolated transport-test entrypoint. Normal app
builds include dependency notices. Production package identity, all four Android
ABIs, native/ZIP alignment, notices and absence of fixture bundle content are checked
before preparing the phone update. The physical phone update waits for its return.
Public cellular roaming and physical iPhone acceptance remain pending.

### Completed simulator and package verification (2026-09-20)

The existing iOS 27 simulator passes all 39 expanded app assertions, including
full Headscale/enrollment/Caddy backup restoration, coordinator/relay outage,
local replacement approval, and application process restart with retained machine
identity and authenticated REST/SSE (`/tmp/gotg-final-ios-fresh-restore.log`). The
restore fixture validates SQLite integrity and mounts fresh restored directories;
reusing a Docker Desktop host volume path reproduced stale-file startup failures.

Android API 37 emulator coverage passes the same 39 assertions
(`/tmp/gotg-final-android-restore.log`). Normal development and release builds and
13 native unit tests pass. Both APKs contain 62 checked 64-bit native libraries with
16 KB ELF alignment; ZIP alignment, normal package identity, included notices and
absence of release fixture content were verified. The release artifact in ignored
`dist/embedded-remote-access/goose-on-the-go-release.apk` is signed with the existing
personal Android debug certificate, not a Play production-distribution key.
Installation on the physical Galaxy A57 waits for its return.

The final JavaScript suite passes 157 tests across 18 suites, typechecking passes,
and lint has zero errors with 19 existing warnings. Physical iPhone, iOS 16.4 runtime,
and public cellular roaming remain unverified; no additional iOS simulator was
created and no public infrastructure was purchased or deployed.

The final Android rerun with fresh restored volumes also passes all 39 assertions
(`/tmp/gotg-final-android-fresh-restore.log`). Both fixture runners restored the
normal native libraries after testing. The validated Jetson server/helper are now
installed: local dashboard HTTP is loopback-only on 8080 and companion HTTPS is
on 4443. Mac-to-Jetson LAN verification passes with the saved certificate public
key; the previous plaintext LAN endpoint is refused. Public coordination remains
unconfigured until the separate infrastructure deployment.

### Physical Android completion and normal app installation (2026-09-20)

The connected Galaxy A57 passes all 39 final app assertions with direct LAN
pairing to a scratch Pond (`/tmp/gotg-final-physical-android-rerun.log`, exit zero).
Coverage includes Expo fetch and RN XHR/SSE pin enforcement, dates/hostname,
renewal, redirects, plaintext refusal, embedded forced DERP, LAN-only pairing,
remote refresh, outage recovery, infrastructure restore, locally approved
replacement, and retained identity/authenticated REST/SSE after process restart.
The first attempt ended when Android killed the background test process for low
memory; only the complete foreground rerun counts as acceptance. Coordinator and
fixture traffic use USB forwarding, so this does not establish cellular roaming.

The saved normal release APK was installed in place after matching the existing
signing certificate. The old APK was backed up; the app ID, data directory inodes,
first-install timestamp and granted permissions were preserved. The production
package was neither cleared nor uninstalled. Its existing personal Android debug
certificate is unchanged; this is not a Play distribution signing claim.

The legacy HTTP profile correctly required a new local pairing. The normal app
paired with the production Jetson over HTTPS using a public-key fingerprint
obtained directly through authenticated SSH and a locally issued one-time code.
It shows `Connected locally`, reconnects after full process restart, and loads
the Devices screen without a transport error. Remote activation presents local
approval feedback because production coordination is not yet configured. The app
is left local-only, with the Jetson production service active.

Public coordination/relay deployment is still required for the real Wi-Fi/cellular
roaming matrix. Physical iPhone and iOS 16.4 runtime acceptance remain pending.

### Unconfigured remote-access feedback (2026-09-20)

An empty coordinator address now produces a localized infrastructure-setup message
before any embedded node starts. Configured-but-disabled remote access retains its
local-approval message. The screen displays failures once and hides recovery while
infrastructure is absent. A regression test first reproduced the incorrect approval
message, then passed with the fix. All 158 app tests, typechecking, lint (zero errors,
19 existing warnings), and the normal Android release build pass. The Galaxy A57
received the signature-matched update in place with pairing preserved; its live
screen shows exactly one setup message and no misleading approval/recovery prompt.
Public cellular roaming remains blocked by infrastructure deployment.

Physical pairing paths were exercised on Galaxy A57: manual HTTPS URL/public pin/
one-time code, LAN discovery that prefills the address while still requiring a
trusted pin, and the real camera scanner with user-assisted QR positioning. The
QR path completes and retains pairing after app restart. The repaired Jetson
Matter controller accepts Google's MVD; phone control reaches its virtual light,
and Devices refresh reads changes made in MVD. External device-state changes do
not yet automatically update the grid. No pairing reset was performed.

## Does remote access survive the screen going off? (2026-09-22)

This section exists because the document previously neither claimed nor disclaimed it, and
somebody relying on remote access to check their home while away needs to know which it is.

**The honest answer today: on Android, yes while the foreground service is running; on iOS,
no, and we do not yet know for how long it lasts.**

### What was observed

On a Galaxy A57 (SM-A576B), with the app backgrounded deliberately:

- The coordinator marked the phone's node offline **within about forty-five seconds**.
- The **app process stayed alive** throughout, logging under the same pid, and was still
  alive thirteen minutes later.
- The node's resolver failures changed character at the moment of backgrounding: from
  `operation was canceled` (a losing racer after another dial won, which is healthy) to
  `i/o timeout`, 88 of them in that minute.
- Once the device became active again, resolution recovered on its own.

So what Doze withdraws here is **network access, not the process**. That matters, because
issue #50 is worded the other way -- "nothing keeps the embedded node alive" -- and a fix
aimed at process lifetime would have addressed nothing.

### What was done about it

`PondNetworkService` is a foreground service whose lifetime is exactly the node's: started
when `stage()` brings a node up, stopped in `stopTransport()`. A profile that never enables
remote access never starts a node, so a local-only user never sees the notification.

The notification reports what the connection is actually doing -- connected, or reconnecting
-- and opens the app when tapped, because a permanent notification reading "Goose is
running" would be a cost with no return.

### The service type, and what happens when Android refuses it (2026-10-23)

The service was first declared `dataSync`. Android 15 caps that type at six hours in any 24,
and on 2026-10-22 the A57 crashed three times because of it: twice in the background with
`ForegroundServiceDidNotStopInTimeException` once the allowance ran out, and once on launch
with `ForegroundServiceStartNotAllowedException: Time limit already exhausted`. The stack
traces put that last one in `startForeground()` inside `onStartCommand`, not in
`PondNetworkService.start`, so the existing try there could never have caught it.

It is now `connectedDevice` (`FOREGROUND_SERVICE_CONNECTED_DEVICE`). Android defines that
type as interaction with an external device over Bluetooth, NFC, USB or a network
connection, and the Pond is exactly that: the user's own hub, reached over a tunnel the
phone holds open. It has no daily cap. Its Android 14 runtime prerequisite is met by
`CHANGE_WIFI_MULTICAST_STATE`, already declared for local discovery. `remoteMessaging`
was the alternative; Android scopes it to carrying text messages between devices, which is
what the presence service on #155 does and not what a network tunnel does. `dataSync` and
`mediaProcessing` are the capped types and must not come back for this service.

A refusal no longer crashes the app, whatever its cause:

- `startForeground()` refused (background start, exhausted allowance, missing prerequisite):
  logged as `kind=foreground_service_refused`, the service stops itself, and the node keeps
  running, because it lives in the app process rather than the service.
- `onTimeout(int, int)` (Android 15, any capped type): logged as
  `kind=foreground_service_timeout`, and the service stops itself before the platform's
  grace period ends.
- `PondNetwork.status()` then carries `"background": "unavailable"`, and the remote-access
  screen says that remote access will pause while the app is in the background. The next
  status read, which the app makes when it returns to the foreground, tries the service
  again.

### What this rests on, and what would falsify it

**The controlled measurement in `docs/remote-access-measurement.md` has not been run.** The
service was built on the single observation above, which was not a controlled run: USB
debugging held the app in the active standby bucket (`am get-standby-bucket` reported 10
after ten minutes backgrounded), so the phone was never fully in the state being measured.

The reasoning is that a foreground service is the supported way to keep network access
during Doze, and network access is what was lost. That is a reasonable inference and it is
not yet evidence. The three runs in the measurement document are still owed, unplugged, and
they are what turns this section from a claim into a guarantee.

It would be falsified if the node still drops when backgrounded with the service running. In
that case the cause is something other than Doze's network restrictions, and the persistent
notification is a cost the user is paying for nothing -- it should be removed rather than
kept for reassurance.

### iOS

iOS has no equivalent mechanism for this, and no `UIBackgroundModes` declaration that would
keep the node running. The app now declares `remote-notification`, so the Pond's silent push
can wake it for a few seconds to fetch an alert (#164, `docs/DATA-SAFETY.md`). That gives no
lasting network time, and a cold start for a push does not start the node. Remote access there
should be assumed not to survive backgrounding until measured. Implying parity would be the
dishonest option.

### A separate fragility, not the cause

`native/pondnet/mobile/dns.go` dials every resolver over TCP only, discarding the transport
Go asks for. The comment there states the assumption -- "a home router commonly answers DNS
over TCP" -- and on the test network that is false: the gateway answers UDP and times out on
TCP. It is not what caused the drop above, since resolution demonstrably worked while the
app was foreground, but it removes the margin: an app given a narrow window of network
access spends it on a transport the router refuses. That is a Pond-side fix and is not
covered here.
