# The privacy screen, and the evidence behind it

`app/(stack)/privacy.tsx` tells a household what happens to its data. Every statement it makes was checked against the Pond's source (#73), and several replaced claims that were not true. This file keeps the evidence next to the claim, so that changing one means checking the other. The copy itself lives in `services/i18n/locales/en.json` under `privacy.*`, and the structure in `constants/privacy.ts`.

**Change a statement only with the same kind of evidence: a file in the Pond, not a belief about it.**

## What the screen says, and why it is true

| Section | Statement | Evidence (goose-in-a-pond) |
|---|---|---|
| Where your data lives (On your Pond) | Kept on the Pond; there is no account with us and no server of ours holding it. The models the Pond ships with run on the Pond. | No hosted-model endpoint in the Pond's own crates. Mesh inference is a compile feature outside the default `["goose-agent", "local-inference"]` (`crates/pond-server/Cargo.toml`). The account claim matches #57's verified `docs/PRIVACY.md`. |
| How it is protected | Keys for other services are encrypted on disk; everything else is not, so protect the device; the phone pins the Pond's identity on first pairing. | Keys: XChaCha20-Poly1305, `crates/pond-infra/src/secret_crypto.rs` and `file_secret_repository.rs`. That file warns the key sits beside the ciphertext, so encryption "does not protect a stolen device either". Everything else is plain SQLite; the workspace has no SQLCipher. |
| What your Pond reaches on the internet | Weather from Open-Meteo, encyclopedia lookups from Wikipedia, Spotify if connected; with a key, Wolfram\|Alpha for calculations and Brave for web search, which sends the question to Brave and reads the top result pages from their sites; with nearby places turned on, each search also sends the town, never the exact location, and the section names the town while the Pond reports it on; every outbound call recorded; stricter modes exist. | `NetworkMode::Open` is "what every install has today", and `Allowlist` and `Offline` exist (`crates/pond-core/src/shared/services/egress.rs`). Weather: `crates/pond-adapters-weather/src/open_meteo.rs`. Wikipedia: `fetch_article_summary` calls `en.wikipedia.org` (`crates/pond-mcp-server/src/knowledge.rs`). Wolfram\|Alpha: `WOLFRAM_QUERY_BASE`, only with an AppID (`crates/pond-mcp-server/src/wolfram.rs`). Brave: the Brave request and `fetch_pages` reading the top three results through a client that connects only to public addresses (`crates/pond-mcp-server/src/web_search.rs`, `crates/pond-net/src/public_only.rs`). Since jarida-io/goose-in-a-pond#692, Brave's LLM Context answers first and `fetch_pages` runs only when it falls back (`docs/architecture/small-model-tools.md` §8.10.4). Nearby places: `web_search_local_results` is off by default (`crates/pond-core/src/user_data/domain/settings.rs`); `local_town` keeps only the place name's text before its first comma (`crates/pond-core/src/mcp/domain/web_search.rs`); `town_header` sends it as `X-Loc-City` only while the setting is on, and no coordinate header exists (`crates/pond-mcp-server/src/web_search.rs`); `GET /api/v1/web-search` reports `local_results {enabled, town}` (`crates/pond-api/src/web_search.rs`), which `view-models/use-privacy.ts` reads for the town sentence. Music: `extensions/music`. |
| Voice and the wake word | Speech is recorded only while speaking, sent to the Pond and deleted from the phone; the Pond keeps no recording; listening for the wake word is off by default, shown in a notification, and only while unlocked; "Hey Goose" is recognised on the phone, any other phrase by the Pond, which keeps neither recording nor words. | Whisper defaults to `http://127.0.0.1:9000` (`crates/pond-core/src/user_data/domain/settings.rs`) and `/transcribe` writes nothing. On the phone: `services/phone-wake.ts`, `plugins/pond-wake/PondWake.kt` (foreground service, screen-on and unlocked only), `native/pondear` (the "Hey Goose" detector). Other phrases: `POST /api/v1/voice/wake/check` (`crates/pond-api/src/wake_check.rs`), which answers `{heard, phrase}` and stores nothing. |
| Faces | A numerical template made on the Pond, never the photo; used to recognise household members on its own cameras; deleted with the member. | `crates/pond-infra/migrations/system/0013_face_embeddings.sql`: "No raw image bytes are stored — only the opaque float vector", with `ON DELETE CASCADE` from `profiles`. |
| What this phone keeps (On this phone) | The Pond's keys in the Keychain or encrypted storage, never in a backup; a random install identifier; preferences; nothing goes anywhere but the Pond. | `services/storage.ts` (expo-secure-store: the Keychain on iOS, encrypted storage on Android); the install identifier is the `device_id` the phone sends when it pairs (`services/api-client.ts`). The full statement is "What stays on your phone" in [PRIVACY.md](PRIVACY.md). |
| Camera, photos and files | QR codes are read on the phone with no picture kept; photos are picked one by one, shrunk and re-encoded before sending, which drops their location. | `expo-camera` barcode scanning; `expo-image-picker` with the system picker; re-encoding before upload in `services/media.ts`. PRIVACY.md, "Camera, photos and files". |
| Your location | Read only while open, for three things: a ride's pickup point to Uber through the Pond; where home is, from the home network only, to about 110 m; and, if turned on, the place name with each message. | `services/home-location.ts` and `PUT /api/v1/location/device` (`crates/pond-api/src/home_location.rs`: LAN only, three decimal places); `services/phone-place.ts` (name only, five-minute cache). PRIVACY.md, "Your location". |
| Bluetooth | Only during setup of a new Pond; the Wi-Fi password goes encrypted and is not kept; `neverForLocation`. | The BLE setup flow and the `neverForLocation` flag on `BLUETOOTH_SCAN` (`plugins/with-pond-ble.js`). PRIVACY.md, "Bluetooth". |
| Notifications | Pushes are empty; the phone fetches the content from the Pond. | The Pond's FCM wake payload carries no text; `services/local-notifications.ts` fetches the notification. PRIVACY.md, "Notifications". |
| Remote access | Off by default, approved on the Pond from the home network; the coordination service learns keys, address and connection times, not content; end to end encrypted. | `services/remote-access.ts`; PRIVACY.md, "Remote access, if you choose it". |
| What this app never does | No analytics, crash reporting, advertising, tracking or contacts; ML Kit and Firebase Cloud Messaging named, with what Google says they send. | The release dependency list in `assets/legal/open-source.json`; PRIVACY.md, "What we do not do". |

## Claims that were removed, and why

| Removed claim | Why |
|---|---|
| Data stored "with AES-256 encryption" | Wrong algorithm for keys, and the rest is not encrypted at all. |
| "MCP integrations (Uber, Glovo, Spotify)" | Uber and Glovo appear nowhere in the Pond. |
| API keys "never leave your device" | A key is sent to the service it belongs to. |
| Recordings kept "unless you enable voice history" | No such setting exists. |
| "Face **and voice** biometric templates" | There are no voice biometrics. |
| Templates "cannot be reverse-engineered into images" | Published work reconstructs faces from ArcFace-style embeddings, so "cannot" is not a claim to make. |
| Five "data rights": export, delete all memories, revoke access, opt out of analytics, export history | Each was a button with no handler. "Opt out of analytics" also implied analytics that #57 verified do not exist. |
| "Piper TTS, MIT" in the licences | The Pond uses Kokoro now. The list names only what this app ships. |

## The choices shown

Only what the app, the phone or the Pond actually offers, each saying where it is done:
**unpairing** this phone (the Unpair button at the bottom of the You tab), which releases its
access to the Pond including remote access; **removing a Pond that cannot be reached** from this
phone only; keeping **remote access** off; turning off **wake-word listening** or **telling Goose
where this phone is**, and withdrawing permissions in the phone's settings; **removing a household
member** under Users, which deletes their face template through the cascade above; and deleting
the rest **on the Pond**, since no copy is held anywhere else. They are statements, not buttons.

The release action is called unpairing everywhere the household reads it, as the button is: the
screen, the policy, the terms and the Data safety answers. A test fails if "sign out" comes back.

## The full documents

After the summary, the screen links the full privacy policy, the terms of use and every
open-source license this app ships (`PRIVACY_DOCUMENTS` in `constants/privacy.ts`). Where each
comes from, and when to regenerate it, is in [LICENSES.md](LICENSES.md). The short list of three
packages that used to stand here is gone: the generated list is complete, and checked against the
installed packages by its own test.
