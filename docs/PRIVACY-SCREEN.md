# The privacy screen, and the evidence behind it

`app/(stack)/privacy.tsx` tells a household what happens to its data. Every statement it makes was checked against the Pond's source (#73), and several replaced claims that were not true. This file keeps the evidence next to the claim, so that changing one means checking the other. The copy itself lives in `services/i18n/locales/en.json` under `privacy.*`, and the structure in `constants/privacy.ts`.

**Change a statement only with the same kind of evidence: a file in the Pond, not a belief about it.**

## What the screen says, and why it is true

| Section | Statement | Evidence (goose-in-a-pond) |
|---|---|---|
| Where your data lives | Kept on the Pond; there is no account with us and no server of ours holding it. The models the Pond ships with run on the Pond. | No hosted-model endpoint in the Pond's own crates. Mesh inference is a compile feature outside the default `["goose-agent", "local-inference"]` (`crates/pond-server/Cargo.toml`). The account claim matches #57's verified `docs/PRIVACY.md`. |
| How it is stored | API keys are encrypted on disk; everything else is not, so protect the device. | Keys: XChaCha20-Poly1305, `crates/pond-infra/src/secret_crypto.rs` and `file_secret_repository.rs`. That file warns the key sits beside the ciphertext, so encryption "does not protect a stolen device either". Everything else is plain SQLite; the workspace has no SQLCipher. |
| What reaches the internet | Weather from Open-Meteo, encyclopedia lookups from Wikipedia, Spotify if connected; with a key, Wolfram\|Alpha for calculations and Brave for web search, which sends the question to Brave and reads the top result pages from their sites; with nearby places turned on, each search also sends the town, never the exact location, and the section names the town while the Pond reports it on; every outbound call recorded; stricter modes exist. | `NetworkMode::Open` is "what every install has today", and `Allowlist` and `Offline` exist (`crates/pond-core/src/shared/services/egress.rs`). Weather: `crates/pond-adapters-weather/src/open_meteo.rs`. Wikipedia: `fetch_article_summary` calls `en.wikipedia.org` (`crates/pond-mcp-server/src/knowledge.rs`). Wolfram\|Alpha: `WOLFRAM_QUERY_BASE`, only with an AppID (`crates/pond-mcp-server/src/wolfram.rs`). Brave: the Brave request and `fetch_pages` reading the top three results through a client that connects only to public addresses (`crates/pond-mcp-server/src/web_search.rs`, `crates/pond-net/src/public_only.rs`). Since jarida-io/goose-in-a-pond#692, Brave's LLM Context answers first and `fetch_pages` runs only when it falls back (`docs/architecture/small-model-tools.md` §8.10.4). Nearby places: `web_search_local_results` is off by default (`crates/pond-core/src/user_data/domain/settings.rs`); `local_town` keeps only the place name's text before its first comma (`crates/pond-core/src/mcp/domain/web_search.rs`); `town_header` sends it as `X-Loc-City` only while the setting is on, and no coordinate header exists (`crates/pond-mcp-server/src/web_search.rs`); `GET /api/v1/web-search` reports `local_results {enabled, town}` (`crates/pond-api/src/web_search.rs`), which `view-models/use-privacy.ts` reads for the town sentence. Music: `extensions/music`. |
| Voice | Transcribed on the Pond by default; the recording is not kept; the transcript stays as the conversation; the wake word is detected on the Pond. | Whisper defaults to `http://127.0.0.1:9000` (`crates/pond-core/src/user_data/domain/settings.rs`). `/transcribe` writes nothing. The wake-word detector is in `crates/pond-voice`. |
| Faces | A numerical template, never the photo; deleted with the member. | `crates/pond-infra/migrations/system/0013_face_embeddings.sql`: "No raw image bytes are stored — only the opaque float vector", with `ON DELETE CASCADE` from `profiles`. |

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

## The data rights shown

Only the two this app can actually exercise: **signing out**, which releases this phone's access to the Pond including remote access, and **removing a household member** under Users, which deletes their face data through the cascade above. They are plain statements, not buttons.

## The full documents

After the summary, the screen links the full privacy policy, the terms of use and every
open-source license this app ships (`PRIVACY_DOCUMENTS` in `constants/privacy.ts`). Where each
comes from, and when to regenerate it, is in [LICENSES.md](LICENSES.md). The short list of three
packages that used to stand here is gone: the generated list is complete, and checked against the
installed packages by its own test.
