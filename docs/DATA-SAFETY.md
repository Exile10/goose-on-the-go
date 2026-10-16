# Data safety — the inputs behind the store declarations

This is the working record behind the Play Data safety form and the Apple privacy
nutrition labels. It exists so that the next release answers those forms from evidence
rather than from memory, and so that a reviewer can check an answer against the line of
code that justifies it.

Every claim below cites the file it came from. When the code moves, this file is wrong
until somebody moves it too. Treat a citation that no longer resolves as a defect.

**Scope.** This describes the client in this repository. It does not describe what the
Pond retains, and it cannot describe what the coordinator retains — that is operational
configuration outside this repo, and the open questions are collected at the end.

---

## What the app stores on the device

### Secret material — Keychain (iOS) / EncryptedSharedPreferences (Android)

Via `expo-secure-store`, in `services/secure-storage.ts:26-33`:

| Key | What it is |
|---|---|
| `goose.pondIdentity` | The paired Pond's pinned identity, used to refuse an impostor |
| `goose.sessionToken` | Bearer token for the Pond's API |
| `goose.refreshToken` | Used once on a 401 to re-obtain a session token |
| `goose.installId` | Stable per-install UUID, sent as `client_id` in every handshake |

`installId` deserves a note for the forms, because "persistent identifier" is a category
reviewers look at closely. It is generated on device (`services/install-id.ts`), never
derived from hardware, never sent anywhere but the paired Pond, and is resettable. Its
purpose is that re-pairing updates the same device row rather than accumulating duplicates.

### Non-secret preferences — AsyncStorage

`services/storage.ts:10-19`:

`@goose/server-url`, `@goose/connection-profile`, `@goose/last-screen`, `@goose/settings`,
`@goose/dev-screen-modes`, `@goose/remote-offer-dismissed`.

The connection profile (`models/connection.ts:2-9`) holds the Pond's host, port, its
local URLs, an optional remote URL, and whether remote access is off or embedded along
with the coordinator's control URL. These are addresses of a household server, not
credentials; no token has been written here since `services/secure-storage.ts` took over.

One migration detail that belongs in the record: builds predating secure storage wrote a
plaintext bearer token to `@goose/token`. Removing the key from the code would not remove
the value from a device that already had one, so `purgeLegacyStorage()`
(`services/storage.ts:27-43`) deletes it on upgrade.

### Embedded network node — app-private files

Once remote access is turned on, the embedded node keeps a directory per pairing under
`pond-network/` in the app's private storage: `noBackupFilesDir` on Android, and
Application Support on iOS, where `PondNetwork.stage`
(`plugins/pond-tls/ios/PondNetwork.swift`) marks the directory excluded from backup. It
holds the node's private machine key and node key and, where the coordinator grants it,
a cached network map: the household's peers, their tailnet addresses and the access
rules. The map holds no private keys. None of these files leave the device; the
coordinator learns only the public keys listed below.

When remote access goes off, including when this phone signs out or the Pond forgets the
pairing, `forgetNetworkMap` in `PondNetwork` (`plugins/pond-tls/PondNetwork.kt`,
`plugins/pond-tls/ios/PondNetwork.swift`) erases the map through the Pond library's
`Mobile.disable`. The node's keys stay while the pairing does.

The app keeps one pairing's node directory at a time. Activating a profile erases every
other directory under `pond-network/` through the Pond library's `Mobile.prune`, called
from `pruneSupersededIdentities` in `PondNetwork` (`plugins/pond-tls/PondNetwork.kt`,
`plugins/pond-tls/ios/PondNetwork.swift`), so keys from replaced or forgotten pairings do
not accumulate. A forgotten pairing activates with no profile and keeps none. The library
refuses a directory whose node is still running, and a failure is logged.

---

## What leaves the device, and to whom

### 1. The Pond — the household server

Everything the app does functionally goes here, over pinned HTTPS, authenticated. Pairing
is a CPace password-authenticated key exchange on the local network
(`services/cpace.ts`, 2026-10-13); the six-digit code itself is never sent. This includes the push
token registration below and the remote-access enrollment below.

For the forms, this is the important framing and it is worth stating precisely: the Pond
is the user's own hardware. Data reaching it has not left the household.

### 2. The coordinator — only after the user opts in to remote access

Remote access is opt-in and declinable, and the app is usable without it.

When enabled, the embedded node contacts the coordinator named by the Pond's own
`/api/v1/remote-access/configuration` response (`services/remote-access.ts:77-84`). The
coordinator therefore observes:

- the node's **node key** and **machine key**, established by the embedded node;
- the **tailnet address** assigned to this device — the app validates it falls in
  `100.64.0.0/10`, and the transport recognises `fd7a:115c:a1e0:` for IPv6
  (`remote` in `PondNetwork`, `plugins/pond-tls/PondNetwork.kt` and
  `plugins/pond-tls/ios/PondNetwork.swift`). The same check refuses Tailscale's own
  service address (`100.100.100.100`, `fd7a:115c:a1e0::53`) as a target: it is the
  node's resolver and local API, never a Pond;
- **connection and disconnection times**, inherent to maintaining a control connection.

What it does not observe is the content: traffic between this device and the Pond is
encrypted end to end, and the coordinator's role is to introduce the two, not to carry
their conversation. Where a direct path cannot be established, a relay carries ciphertext
and sees the metadata inherent to relaying it.

Note the direction of the enrollment write, because it is easy to describe backwards: the
app sends `{authUrl, nodeKey, machineKey}` to **the Pond**, not to the coordinator
(`services/remote-access.ts:104`), and the Pond approves the node. Approval is a local
act, which is the point of the design.

A phone whose remote access lapsed, because the Pond did not see it on the home network
for 30 days, has its enrollment revoked, and the coordinator will not enrol that machine
key again. When the Pond reports this (`stale_identity`), the app erases the embedded
node's private node and machine keys from the device and enrols a node with new ones
(2026-10-12, see `docs/PINNED_HTTPS.md`). The coordinator then holds the new public keys;
the old ones stay with it only as the revoked record. A lapsed pairing's keys are never
reused.

### 3. Google FCM and Apple APNs

`services/push-token.ts:1-19` is explicit about the shape, and it is the strongest privacy
claim in the product, so the declaration should make it rather than bury it.

The phone obtains its native device token and registers it **with the Pond**
(`POST /api/v1/devices/{installId}/push-token`). The Pond's own relay then talks to FCM v1
and APNs directly. The wake pings are **content-free**: the phone wakes and pulls the real
content from the Pond over its own authenticated channel.

So Google and Apple see a device token and the fact that a ping occurred. They do not see
notification text, because there is none to see.

### 4. Nobody else

Verified against the dependency list rather than asserted: there is no analytics SDK, no
crash reporter, no advertising or attribution SDK, and no tracking library of any kind in
`package.json`. There is no location permission, no contacts access, and no advertising
identifier.

`expo-device` is present but is used only to establish whether the code is running on
physical hardware before attempting push registration; it transmits nothing.

---

## Camera

`expo-camera`, declared in `app.json` with a purpose string that already says what it is
for. Two uses, both QR codes: the Pond's pairing code, and a Matter device's setup code.

Decoding happens on device. No image is stored, and no image is transmitted. For Apple's
label this is camera access without data collection, which is a category the form supports
and which should be selected deliberately rather than by defaulting to "collected".

---

## Draft answers

### Google Play — Data safety

| Question | Answer | Basis |
|---|---|---|
| Does your app collect or share any of the required user data types? | See below; no data is shared with third parties for advertising or analytics | no such SDK exists in the tree |
| Device or other IDs | Collected, not shared. Sent only to the user's own Pond | `install-id.ts`, `push-token.ts` |
| App activity, personal info, location, contacts, photos, files | Not collected | no such permission or code path |
| Is data encrypted in transit? | Yes — pinned HTTPS locally, encrypted tunnel remotely | `services/api-client.ts`, `PondNetwork.kt` |
| Can users request data deletion? | Yes — signing out releases this phone's access, and the Pond is the user's own hardware | `profile.signOutWarning` in `services/i18n/locales/en.json` |

### Apple — privacy nutrition labels

- **Data not collected** for every category except the identifier below.
- **Identifiers → Device ID**: used for App Functionality only; not linked to an identity,
  not used for tracking.
- **Tracking**: none. No ATT prompt is required, and none should be added.

---

## Open inputs — not answerable from this repository

These are the questions the forms will ask that the client's source cannot settle. They
need an answer from whoever operates the infrastructure before the listing goes live, and
recording a guess here would be worse than recording the gap.

1. **Coordinator retention.** How long are node keys, machine keys, tailnet addresses and
   connection logs kept, and what is the deletion path when a user signs out? The client
   can say what it sends; only the operator can say what is kept. The phone erases its
   own superseded node keys (2026-10-05, see above); whether the coordinator deletes the
   corresponding nodes is still open.
2. **Relay operation.** Which relays can carry this traffic, who runs them, and what do
   their logs retain?
3. **Jurisdiction and controller.** Which legal entity is the data controller for the
   coordinator, and in which countries does it operate? Both forms ask.
4. **The hosted policy URL.** Both stores require a stable, publicly reachable URL. It does
   not exist yet, which is also why the app does not yet link to one.
5. **Support and deletion contact.** The address a user writes to, which must be real.

---

## Why the wording matters here more than usual

Goose In A Pond is sold as privacy-first and local by default, and that claim is doing real
work in the product. A declaration that is vague about what the coordinator sees does not
protect that claim; it undermines it, because the honest answer is genuinely good. The
coordinator learns that a device exists and how to reach it. It does not learn what was
said, and the notification path was built specifically so that Google and Apple could not
learn it either.

That is a strong position. It is worth stating precisely rather than defensively.
