# Handoff: the My Goose hub (2026-11-10)

All the code is written, merged into one `feat/my-goose-hub` branch per repo, and pushed.
**None of it is on `main`**, and **none of it has run on a device or against a real Pond.**
Jerry's design decisions are in auto-memory `my-goose-hub-revamp` and `scored-topic-map-prompts`. Don't ask them again.

| Repo | Branch | Head | Remotes |
| --- | --- | --- | --- |
| goose-in-a-pond | `feat/my-goose-hub` | `d5930cc2` | `jarida-io` and `origin` (the fork the nano pulls) |
| goose-on-the-go | `feat/my-goose-hub` | `c602f22` | `Jarida-Main` |

- **The contract:** `docs/architecture/my-goose-hub.md` in the Pond. The app's copy, `docs/MY-GOOSE-HUB.md`, is untracked.
- **Connectors:** `docs/CONNECTORS.md` and the manifests in `connectors/*.json`, in the Pond.
- **Pond worktree:** `goose-in-a-pond/.claude/worktrees/my-goose-hub`. The builder worktrees `my-goose-{mind,news,hooks,cart}` are merged; remove them only with Jerry's OK.

## Done
- [x] **Base:** migrations 0086–0088, the `/me/hub` probe, and `caller_member` in `pond-api/src/me.rs`.
- [x] **News** (0090)
  - A scored topic map per member, written in batches; private topics dropped.
  - Tiles and the digest written on the inference lane, from Brave searches plus page reads, with pictures.
  - Listen (WAV) and speak-on-speaker.
  - Read history and thumbs feedback.
- [x] **Cart, connectors, catalogue** (0092)
  - Watched links, checked every 5 minutes, plus "check now".
  - Connector manifests.
  - The webhook connector, with the public `POST /hooks/in/{token}`.
  - Mail and calendar events written to `hook_events`.
  - `/me/catalog`.
- [x] **Interests and ideas** (0089)
  - Interests CRUD, the tap-answer interview, the portrait.
  - Ideas: Goose acts or the member acts.
  - Prompt fixes:
    - a question asked once becomes an interest, not a trait;
    - consolidation's `supersede` archives the older memory, and each run is recorded in `consolidation_runs`;
    - the summary keeps only the latest instruction;
    - suggestion cards are rebuilt from the portrait.
- [x] **To-dos and hooks** (0091)
  - Hook kinds: time, repeat, place, event, connector.
  - A runner every 30 s.
  - Check-in pushes, at most 3 asks.
  - To-do offers made from dated mentions in chat.
  - Places and the geofence route.
  - MCP tools `add_todo`, `list_todos`, `complete_todo`.
- [x] **Merged Pond:** `cargo check -p pond-server --tests` is clean.
- [x] **App (9 commits):** the hub tab, a screen for each part, the interview at the end of setup, answering from the notification, and geofence reporting. `tsc` is clean, jest passes 2814 tests, and `npm run lint` is clean.

## Left, in order
1. **Pond gates on the merged branch.**
   - Build with `CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=/Users/jerry/.phub`. The long worktree path breaks the `espeak-rs-sys` build script; if it fails, `rm -rf ~/.phub/debug/build/espeak-rs-sys-*/out`.
   - Run `cargo test` for pond-core, pond-infra, pond-api, pond-mcp-server, pond-server and pond-adapters-goose. Then clippy with `-D warnings`, then `scripts/live-test.sh`.
   - **Known failure:** `prefix_oracle.rs::the_default_tool_prefix_is_unchanged`. The tool count goes 31 → 34 and the raw bytes grow by about 3.3 KB. Update the fixture.
   - `pond-api/tests/todo_routes.rs` has never been run.
   - Watch the disk: it filled up once, and each target directory takes 10–25 GB.
2. **PRs:** `feat/my-goose-hub` → `main` in both repos. Merge only after the gates and the device pass.
3. **Nano.** Deploying is approved once green: `bash scripts/jetson.sh deploy --branch feat/my-goose-hub`. A cold build takes 40–90 min. Then the one-time cleanup, archive only:
   1. Raise `memory_consolidation_batch_size`.
   2. `POST /api/v1/memory/consolidate`.
   3. Read `consolidation_runs`.
4. **A16:** rebuild the dev client with `npx expo prebuild --clean && npm run android` (background location, `expo-task-manager` and `expo-clipboard` are new). Run Metro on 8083 and `adb reverse tcp:8083 tcp:8083`.
5. **Device pass against the nano, with screenshots to Jerry.**
   - The hub, light and dark.
   - News: tiles, the digest, Listen, the speaker toggle, an interest page, the reader with thumbs and "...".
   - The interview.
   - To-dos: one per hook kind, a check-in answered from the notification, and an offer.
   - Cart: add a real link, then Check now.
   - A webhook fired with curl.
   - Ideas: both buttons.
   - The catalogue.
   - Afterwards, set the Developer toggles back to real.

## Gaps
- No idea has been researched against real Brave results.
- The interview prompt was tightened and never re-run.
- There is only the household time zone; no member has their own.
- The app assumed these parts of the contract: DELETE to dismiss an interest, a 120-minute snooze, KSh as the default currency, the "Saved stories" collection, and a 100 m minimum radius.
- `npx eslint view-models services models providers hooks` reports 32 errors. They predate this branch.
- Tell Jerry: the Home lead sentence overlaps My Goose's, and PR #823 is in another session.

## Evidence
The simulator screenshots, against the Developer mock and in light mode only, are in
`/private/tmp/claude-501/-Users-jerry-Documents-Jarida-goose-on-the-go/3cd562b8-5769-476e-a3e5-49b1bdbed99a/scratchpad/shots/`.
The prompt trials are in `.../scratchpad/mind/`.
