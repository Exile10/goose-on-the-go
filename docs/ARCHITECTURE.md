# Architecture — MVVM

Goose on The Go follows the **Model-View-ViewModel** pattern adapted for React Native with hooks.

## Layer Overview

```
┌─────────────────────────────────────┐
│          Views (Screens)            │
│  app/(tabs)/*.tsx  app/(stack)/*.tsx │
├─────────────────────────────────────┤
│        ViewModels (Hooks)           │
│        view-models/use-*.ts         │
├─────────────────────────────────────┤
│     Models (Types + Services)       │
│   models/*.ts   services/*.ts       │
└─────────────────────────────────────┘
```

### Views
Screen components in `app/` that import a single ViewModel hook. Views are **pure rendering** — they destructure `{ data, actions }` from the hook and render UI. No business logic, no direct API calls.

```tsx
export default function MemoryScreen() {
  const { data, actions } = useMemory();
  return (
    <FlatList
      data={data.items}
      renderItem={({ item }) => (
        <MemoryItem {...item} onDelete={() => actions.remove(item.id)} />
      )}
    />
  );
}
```

### ViewModels
Custom hooks in `view-models/` that own all state and side effects. Every ViewModel returns:

```ts
{
  data: T;           // The screen's data
  loading: boolean;  // Loading state
  error: string | null;
  actions: {...};    // Callbacks the view can invoke
}
```

### Models
TypeScript interfaces in `models/` defining the domain shapes. These are pure types — no logic. Mock data is co-located with its type file (e.g., `LLM_MODELS` in `models/model.ts`).

### Services
`services/api-client.ts` — the HTTP client for pond-server, and the only place
in the app that calls `fetch`. It attaches the bearer token, refreshes once on
401 (sharing a single refresh across concurrent 401s), and throws a typed
`ApiError` carrying the status and any `Retry-After`. Where the Pond names its
refusal in `{error}` (pairing's `channel_binding_mismatch`, enrollment's
`stale_identity`), `ApiError` carries it as `detail`, so a screen can act on why the
Pond refused rather than on the status alone. `pair()` runs CPace (2026-10-13): it
reads `/system/info` first and throws `PondOutdatedError` unless the Pond reports
`protocol: 3`, then `handshake/pake/init` and `handshake/pake/verify`, and keeps
no token until the Pond's confirmation tag verifies (`PondTrustError` otherwise).
With `credential: 'setup'` it runs the same exchange against a setup card's eleven
digits, to claim a Pond, and `requestSpokenCode()` asks a Pond to read a pairing
code aloud (2026-10-17; PINNED_HTTPS.md, "Setup cards and spoken codes").
`services/cpace.ts` — CPace (draft-irtf-cfrg-cpace-21, CPACE-RISTR255-SHA512) over
`@noble/curves` and `@noble/hashes`, both pinned exactly, and the pairing's channel
identifier, session id and confirmation tags. The draft half is held to the draft's
own vectors (`services/__tests__/vectors/`). Its randomness is a parameter, which
`api-client.ts` fills from `secure-random.ts`; noble's own `randomBytes` is never
used. See [PINNED_HTTPS.md](./PINNED_HTTPS.md) "Trust lifecycle".
A 403 whose `error` is `onboarding_required` is reported once through
`setOnboardingRequired`, which the setup gate listens on, and `ApiError` keeps a
refusal's parsed `body` for a route that answers more than a sentence, such as
`/onboard/complete`'s `missing_fields`.
Wire types live in `services/types.ts`, in the server's own snake_case —
deliberately separate from the display-shaped types in `models/`.
`services/notification-stream.ts` — the foreground SSE stream. Only a 401 means
its token is dead: it stops and the owner refreshes. A 403 is the Pond declining
to serve the stream yet (before onboarding, for one), so the stream retries with
its usual backoff, up to 30 s, and logs the reason. Treating a 403 as a dead token
looped refresh and a loud reconnect about ten times a second (2026-10-05).
`services/pond-images.ts` — the pictures the Pond serves (event snapshots), each read once over the
pinned transport as a `data:` URI and kept, forty at most, three read at a time; dropped on sign-out.
`services/storage.ts` — typed AsyncStorage wrapper, with key families
(`storageFamily`) for records that grow with use, one key per record.
`services/card-cache.ts` — the tool cards the phone was shown, by conversation
and call, because the Pond saves none. Conversations themselves are read from
the Pond each time; these cards are kept in plain storage, capped at 100
conversations, dropped with their conversation, and cleared on sign-out.
`services/discovery.ts` — finds Ponds over mDNS, so step 0 of the pairing wizard
can offer a hub rather than ask for its address. See "Finding the Pond" below.
`services/ble.ts` — the Pond's BLE setup service through `PondBle`, the local native module in
`plugins/pond-ble` (CoreBluetooth on iOS, BluetoothLeScanner and GATT on Android). The module only
scans, connects, writes with response and delivers notifications; it never bonds. See "The setup
channel" below.
`services/setup-channel/` — the setup channel itself: framing, sealing and the session that runs
`hello`, the CPace exchange and the sealed Wi-Fi requests. `services/setup-session.ts` holds the
open session and the claim's tokens between Find your Pond and the Wi-Fi step, in memory only.
`services/secure-random.ts` — platform CSPRNG bytes (`randomBytes`, from
expo-crypto), for anything an observer must not be able to predict.
`services/notifications-module.ts` — `expo-notifications`, or null in Expo Go,
where importing it throws on Android since SDK 53. The notification services read
the module from here and stop when it is null.
`services/dev-mode.ts` — the single `insecureDevMode` flag. Every plaintext
relaxation reads it and nothing else; see
[development.md](./development.md).

## Finding the Pond

pond-server advertises `_pond._tcp.local.`; `services/discovery.ts` browses for
it through `react-native-zeroconf`, and `view-models/use-discovery.ts` turns that
into the `{data, loading, error, actions}` shape the wizard renders.

Five things about this are load-bearing and easy to undo by accident.

**Only numeric addresses are kept.** A resolved service carries both a `host`
(`<name>.local`) and `addresses` (numeric). Android's resolver does no mDNS at
all, so the `.local` name is unreachable there however it arrives — typed,
scanned from the pairing QR, or discovered. A service that resolves without a
numeric address is therefore dropped rather than shown.

**The list dedupes on address and port, not on name.** mDNS records outlive the
process that registered them, so a restarted server leaves ghosts advertising
the same endpoint under incrementing instance names. Keying on the endpoint means
a restart replaces its own entry.

**A discovered Pond is probed with `/health` before the wizard advances**, for
the same reason: an advertisement is not a running server, and a ghost resolves
perfectly and answers nothing.

**An advertised pin is confirmed by choice, not by a yes.** A pin that arrives
with a discovered Pond is only a claim. `fingerprintChoices`
(`models/connection.ts`) offers three previews that differ only after the first
group, drawn once per pin, so a wrong pick cannot be retried against a fresh set.

The one exception is a pin that the exchange itself is about to prove (2026-10-17).
A Pond with no screen has nothing to pick a fingerprint against, so the pick is
skipped when the next exchange runs on a setup card's code (after a scanned card,
and for a Pond whose advertisement says `setup=1`) or on a code the Pond says
aloud. Both exchanges put the pin into the channel identifier, so a spoofed pin
can only fail them. `setup=1` is itself only a claim; a spoofed one skips the pick
for a claimed Pond, and the exchange that follows still fails under the wrong pin.
A six-digit code read off a screen keeps the pick (`pickBeforeExchange`).

**A setup card names its Pond by `id`.** The TXT record carries `id`, the four hex
digits printed on the Pond's setup card, and `setup=1` while nobody has claimed it.
`findPondBySetupId` browses for the card's id on the same 8 s clock as the search
below, lowercasing both sides because a card may print it in either case, and finds
a claimed Pond too: its own refusal ("ask whoever set it up") says more than "not
found". Nothing found opens the address form, with the reason above it.

The search ends on a clock (8 s), because mDNS has no "that is all" signal, and
browsing continues past the deadline so a hub switched on later still appears.
The deadline only changes what the screen says. Stopping the browse is not
optional — it holds a multicast lock on Android for as long as it runs.

Discovery is the default, not the only way in: multicast is filtered on plenty
of guest and office networks, so scanning the QR and typing an address both
remain on the same step.

Expo Go has no zeroconf native module. `startDiscovery` checks
`NativeModules.RNZeroconf` first and, when it is missing, reports
`onboarding.discoveryUnavailable` (enter the address instead) through its error
callback rather than throwing.

`types/react-native-zeroconf.d.ts` declares the library's browsing API, which
ships no types of its own. Field names there are taken from its Android NSD
implementation, which is the default backend.

## The setup channel (2026-10-17)

A brand-new Pond with no network is found and claimed over Bluetooth LE, told which Wi-Fi to join,
and then reached over HTTPS. The contract is goose-in-a-pond's
`docs/architecture/pond-setup-channel.md` (P5); this is the phone's half (P5d).

**Finding it.** A Pond advertises one service UUID, `185b51bd-e038-4b6c-99b0-4e2379dd<card id>`,
with the card's four hex digits in its last two bytes (`cardIdOf`). The UUID sits in the
advertisement itself; the local name `Pond <card id>` rides in the scan response, which some
adapters never send and iOS's passive background scans never ask for, so the name is only a
label. A Pond name naming another card drops the sighting. The GATT service the phone connects
to is always `…4e2379dd362c`. Android scans for the prefix with a masked filter. iOS has no masked
filter, so Find your Pond scans for everything in the foreground and keeps the prefix, and
`findPondById` scans for the one card's UUID. The name is read from the advertisement, never the
GAP name, which on a Mac is its computer name. Android scans with `BLUETOOTH_SCAN` marked
`neverForLocation`, so no location permission is asked for; iOS asks for Bluetooth the first time
the module touches it. A Pond seen on the network
as well is one row, and is claimed over HTTPS, which needs no Wi-Fi step.

**Choosing the transport.** `react-native-ble-plx` was assessed and passed over. It has no codegen
spec, so it runs only through the New Architecture interop layer. It has had one release in twenty
months, and it brings RxJava 2, RxAndroidBle and a plugin that adds location permissions.
`react-native-ble-manager` is the maintained alternative. The five calls this needs are a smaller
surface than either library, so the module follows pond-tls's pattern instead, and everything that
can be tested lives in TypeScript.

**The exchange.** `SetupChannel` (`services/setup-channel/session.ts`) runs over any ordered byte
link. Messages are length-prefixed JSON cut to `ATT_MTU - 3` (`framing.ts`).

- **hello** gives the pin, and `pond_id`, which must match the card id the advertised UUID
  carried, or the phone stops. It also says whether the Pond is `claimed`. A claimed Pond with no
  network still advertises, because the Pond advertises while unclaimed OR without a network. Such
  a Pond is given Wi-Fi again after a spoken code, from the same row.
- **The claim** is `pake_init` and `pake_verify`, the exchange `pair()` runs over HTTPS, with the
  same `respond()` and the pin from `hello` in the channel identifier. A substituted pin can only
  fail it.
- **The tokens** come back sealed. They are opened only after the Pond's `server_proof` verifies.
- **Sealing** (`sealing.ts`) is ChaCha20-Poly1305 under per-direction keys drawn with HKDF-SHA-512
  from CPace's ISK, salted with sid, with counter nonces. `respond()` hands ISK back only when asked
  (`keepIsk`), and the channel zeroes it once the keys are drawn.
- **Anything unreadable ends the session**: a frame that does not parse, a tag or counter that does
  not check, an answer to no question. A counter out of step cannot be put back.
- **Refusals.** Every refusal is `ok: false`. A refused `pake_verify` is returned as HTTPS returns
  it, `accepted: false` with its `rejection_reason`. Every other refusal arrives as `ApiError`
  carrying the code, so the pairing wizard's sentences apply unchanged. The channel's own codes
  (`too_many_attempts`, after a fourth `pake_init`, which also ends the session; `wrong_phase`;
  `unknown_type`; `invalid_request`; `internal_error`) have sentences of their own
  (`channelErrorKey`).

**Resuming as a paired device** (P5e). Over the setup channel only, a phone that holds a pairing
can run the same exchange with `"credential": "device"`. The password is the 64 lowercase hex
characters of SHA-256 over its current refresh token (`devicePassword`), and the label is
`goose-device-cpace-v1`. A confirmed run rotates the session, as `/handshake/refresh` does, so the
new pair is kept at once (`keepRotatedTokens`). Two places use it before asking for a spoken code.
One is the Wi-Fi step, when its session drops before the Pond has an address: the phone finds the
Pond by its card id (`findPondById`) and resumes on the claim's own tokens. The other is a claimed
Pond on Find your Pond whose `hello` pin is the pin this phone is paired with. A refusal
(`invalid_confirmation` for a dead token, `invalid_or_expired_refresh`, `device_cooling` with its
wait) falls back to "Have it say a code". `cpace-vectors.json`'s `device` run, including its
`raw_digest`, `uppercase_hash` and `setup_label` negatives, is checked byte for byte in
`pairing-exchange.test.ts`.

**The handover.** `wifi_join` answers with the Pond's address and HTTPS port. `adoptPairing` in
`ServerProvider` keeps the pairing there at once: the pin proven by the exchange, the tokens from
the sealed answer, the host name kept for rediscovery. Nothing is probed first. The phone may not
be on that network yet, and tokens held only in memory would leave a claimed Pond that nobody
holds. Then the Pond is reached over pinned HTTPS, and owner setup runs there.

**Tests.** `services/__tests__/support/setup-channel-pond.ts` plays the Pond's end, built from the
same primitives and following the agreed contract. HKDF and the AEAD are checked against Node's
OpenSSL. `setup-channel-vectors.test.ts` checks the keys, four sealed messages in session order,
and framing at ATT_MTU 23 against `vectors/setup-channel-vectors.json`. That file is a
byte-identical copy of goose-in-a-pond's `crates/pond-connect/tests/fixtures/setup-channel-vectors.json`,
and its ISK and sid chain to `cpace-vectors.json`. Everything native is owed a device test.

## Providers

`app/_layout.tsx` wraps the app in these, outermost first:

- **ThemeProvider** (`providers/theme-provider.tsx`) — Jarida color tokens resolved for light/dark mode. Access via `useTheme()`.
- **ServerProvider** (`providers/server-provider.tsx`) — Server connection state and the dev mock/real toggles. Access via `useServer()`.
- **NotificationsProvider** (`providers/notifications-provider.tsx`) — Push registration.
- **InkProvider** (`@jarida/ink/native`) — Theme context for the ink primitives (#17).

## Unpairing, including from a Pond that is gone

Unpair (the You tab, `view-models/use-unpair.ts`) always asks the Pond first, with
`POST /api/v1/handshake/revoke`, so the Pond forgets this phone whenever it can be reached. What
happens next depends on the answer:

| Answer | What the phone does |
|---|---|
| Released | Forgets the Pond (`forgetPairing` in `ServerProvider`) and lands on first run. |
| 401 or 403 | The Pond has already let this phone go: forgets it the same way, with nothing more to ask. |
| Any other `ApiError` | The Pond answered and did not release it. Offers Try again, or Remove from this phone. |
| No answer (network, timeout, a different machine at the address) | Offers the same two, explaining that the Pond may be off, away, reset or gone. |

Remove from this phone (`forgetLocally`) is never a silent fallback: it is offered in the app's own
dialog, which says the Pond will still list this phone until it is removed from the Pond's
dashboard. It clears exactly what a sign-out clears: the identity and both tokens in SecureStorage,
the saved addresses, the remote transport and the foreground service that carries it, the
remote-access lapse date, tool cards, owner setup's drafts and checklist, the camera pictures held
in memory, and the record of which push token was registered, so the next Pond paired in the same
process is sent it. The heartbeat and the notification stream stop with the identity. Until
2026-10-27 a failed revoke was a system alert saying to try again at home, and a phone whose Pond
had been reset or replaced stayed paired to it for good.

## Presence: telling the Pond this phone is still here

The Pond does not store whether a device is online. It derives `is_online` at read time from `last_seen` against a **five-minute** threshold, so a paired phone has to keep refreshing its own row, or it ages out and reports itself offline in its own device list while in use. `ServerProvider` does that with `POST /api/v1/devices/{id}/heartbeat`, where `{id}` is the install id sent as `client_id` at pairing. The Pond keys the device row on exactly that id.

| Rule | Why |
|---|---|
| Every **2 minutes** (`HEARTBEAT_MS`) | Inside the five-minute threshold with room for one dropped beat, and about 30 requests an hour against the Pond's per-IP budget. |
| First beat once the **connection manager has reached the Pond** | The paired identity loads before the base URL resolves. A beat sent then goes to the client's default address and is lost, which on a cold start left the card offline until the interval came round. |
| Stops only in a **known background** state | Backgrounding a React Native app suspends its networking, so claiming reachability then would be false. On an Android cold start AppState can still read `'unknown'`, and the app is on screen. |
| A missed beat is **dropped, not retried**, and logged | The next one is already scheduled, and a retry loop against a rate-limited Pond is the failure the interval avoids. It is logged because a beat that always fails looks exactly like one that never fires. |

With a remembered route (2026-10-05), "reached" can mean a route a previous `ConnectionManager` reached in the same process: `configure` publishes it at once, so the first beat can go there before the quiet re-check that `environment` starts has answered.

The conditions live in `services/heartbeat.ts` (`canBeat`) and are unit tested there; the provider only wires them to its state. The cold-start behaviour was verified on a device, starting from a row that had aged out: the card read online 38 seconds after launch, before the interval could fire.

The desktop app has the same problem and the same fix, on the Pond side (goose-in-a-pond#388).

## Navigation

Uses Expo Router v6 with file-based routing:

- **`(tabs)/`** — Bottom tab navigator (4 tabs: Home, Chat, Devices, You)
- **`(stack)/`** — Stack navigator for the You-tab sub-screens, plus Add Device, Connect Desktop and the dev-only Developer screen
- **`modal.tsx`** — Modal presentation route

See [NAVIGATION.md](./NAVIGATION.md) for detailed rationale.

## Component Library

Primitives come from **`@jarida/ink/native`** (`InkButton`, `InkInput`, `InkSwitch`, `InkProvider`, etc. — issue #17). Two in-house primitives remain in `components/ui/`, re-exported from its barrel: `GIcon` (pending the icon-registry work in #19) and `GKeyboardView` (no ink equivalent).

- **`components/ui/`** — The two surviving in-house primitives (`GIcon`, `GKeyboardView`)
- **`components/patterns/`** — Composite components (ChatBubble, ServerStatus, etc.), composed from ink primitives
- **`components/layout/`** — Screen wrappers (ScreenScrollView, ScreenFlatList)

See [COMPONENT-GUIDE.md](./COMPONENT-GUIDE.md) for how to add/modify components.

## Developer Mode

`app/(stack)/developer.tsx`, reached from the You tab's "Developer" section, is a
dev-only screen (`if (!__DEV__) return <Redirect .../>`) that lets each
migratable screen be flipped independently between its mock data and the real
`PondApiClient` (issue #21). `MIGRATION_SCREENS` and `isScreenReal`/`setScreenMode`
live on `ServerProvider` (`providers/server-provider.tsx`); mock and real code
paths coexist per screen, so nothing needs to be deleted to test either one.
It also has a "Pond server URL" field and a Test connection button that probes
`/health`. The screen isn't linked from the You-tab menu in production builds.

This screen is not insecure development mode (`services/dev-mode.ts`,
[development.md](./development.md)). That is a build-time switch for Expo Go,
`EXPO_PUBLIC_POND_INSECURE_DEV=1` in a development bundle, which allows plaintext
Pond origins on the LAN and raises a Settings issue, with a dot on the You tab, while it is on. This screen
only flips each screen between mock and real data, and changes nothing about how
the Pond is reached.

## Performance

- All styles use `StyleSheet.create()`
- List items use `React.memo()`
- Lists use `FlatList` (virtualized), never `ScrollView` + `.map()`
- Animations use `react-native-reanimated` (UI thread)
- React Compiler is enabled (`reactCompiler: true` in app.json)
