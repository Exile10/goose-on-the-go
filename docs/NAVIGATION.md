# Navigation Architecture — Goose On The Go v2

## Design Inspiration
- **Alexa**: Floating mic FAB, shortcut carousel, full-screen listening ring
- **Google Home**: Device grid with color-coded toggles, room groupings, "Ask" bar
- **Claude Mobile**: Clean threaded chat, conversation list, generous whitespace

## Bottom Tabs (4)

Ink's `InkBottomBar`, floating over the screens rather than beside them, and
leaving on scroll. Labels come from `tabs.*` in the catalogue; icon names are
registry keys, so `device` is singular.

| Tab | Screen | Icon | Purpose |
|-----|--------|------|---------|
| Home | Dashboard | home | Greeting, status, devices, shortcuts, recent |
| Chat | Conversations wall → conversation | chat | Every conversation the Pond holds; open one or start one |
| Devices | Device Grid | device | Room-grouped smart home control |
| You | Profile Hub | profile | Settings, integrations, data |

The bar is absolutely positioned, so a tab screen's own list has to clear it —
`paddingBottom: useBottomBarInset()`, never a hardcoded spacer. Which stage the
bar is in lives in `providers/chrome-provider.tsx`; see
[`VIEW-LAYER.md`](VIEW-LAYER.md#the-bar-leaving) for the last stage, where the
bar contracts to one control, and the patch that makes that work more than
once.

The Chat tab opens on the wall of conversations, `app/(tabs)/chat/index.tsx`,
as pond-desktop's Chat does. A conversation is `app/conversation.tsx`, a
root-stack screen pushed over the tabs rather than inside one — so it has the
whole screen and no bar under its composer — by a card with `?session=<id>`,
or by the compose button with no id for a new conversation. Back returns to
the wall; the root layout's `anchor: '(tabs)'` keeps the tabs under a
conversation opened cold. Link to `/conversation`, not `/(tabs)/chat`, when
the intent is a conversation, and pass `title` beside `session` when the
linking screen knows it: the conversation's bar shows it on the first frame.
Without one the screen reads the Pond's list for it, because the Pond has no
route for a single conversation (`/sessions/{id}` answers only PATCH and
DELETE).

A root-stack screen is outside `ChromeProvider`, so its hooks answer their
defaults: no bar height to clear and no shared stage. The conversation clears
the home indicator with `useSafeAreaInsets()` and drives its title bar with its
own `NavbarBehaviour`.

## Sub-Screens (stack navigation from the Profile hub)

The hub is `PROFILE_NAV` in `constants/navigation.ts`, rendered by the You tab
as iPhone Settings lays its root out, drawn in Ink: groups without headings, each
row an icon on a coloured tile, its label, how it stands (`summary`, worked out by
`summarize` in `view-models/use-settings-extras.ts`) and a chevron. The raised card
at the top leads to `ACCOUNT_ROUTE`, You and your household. Labels are
`TranslationKey`s, never text.

| Group | Rows |
|-------|------|
| Connection | Remote access, Internet, Web search |
| Goose | Assistant, Voice, Thinking, Models, Memory, Tools, Extensions |
| Home | Your home, People, Cameras and smart home, Rooms and Ponds |
| Notices and privacy | Announcements, Privacy |
| Records | Memories, Conversations, Activity, Schedule |
| This phone | Appearance, and Haptic feedback as a switch on the row |
| Advanced | Advanced |
| Developer | Developer mode (dev builds only, #21) |

### Settings pages

The Pond's settings live on sixteen `settings-*` pages, each a thin route over
`SettingsPageScreen` (`components/settings/settings-page.tsx`), which draws the
page `constants/settings-pages.ts` describes. That catalogue is lifted from
pond-desktop's `src/settings/catalogue.ts`; fields nothing on the Pond reads are
left out, as the desktop hides them. Every field is read with `GET` and written
with a partial `PUT /api/v1/settings` through `view-models/use-pond-settings.ts`,
one shared store, so a change on a page shows on the menu behind it. A change is
sent alone, the moment it is made: the Pond marks every key it is sent as the
household's choice for good. Its answer replaces the record, and a refusal puts
the old value back with the Pond's reason under the row. A setting the Pond
reads only at start says that a change waits for a restart.

Two kinds of page are not catalogue pages: Time zone (`settings-timezone`,
searchable) is a picker, and the Models pages below have their own screens. The
speaking voice has a catalogue page of its own, Speaking voice
(`settings-speaking`), reached from Voice: pond-desktop's voice picker and the
sound quality, which would otherwise be most of the Voice page. Choosing a voice
saves it, has the engine switch to it, and then plays the next of seven lines in
it, the same line for every voice in turn.

### What needs attention

Anything a household should know about is an issue in
`constants/settings-issues.ts`: a tone, an icon, a row line, a page of facts and
sections, an optional action, and an `active(ctx)` test. `useSettingsIssues()`
lists the ones that apply, most serious first; Settings shows them above the
account card, the You tab carries a dot while there is one, and each opens
`settings-issue?id=…`, which renders it through `IssuePage`. A new issue is a
catalogue entry and, if it needs more than the phone already holds, a field on
`IssueContext`; it is never a new screen. Settings is behind the Developer
toggle (`settings`, real by default); on mock it works on the Pond's own defaults.

### Models

`/(stack)/models` is a storage page over `view-models/use-model-library.ts`:
which model does each job, what is downloading (read every 1.5 s while a
download moves), the Pond's recommendations, what is on the Pond, and the disk
and memory it costs. A job opens `settings-model-role`, a model opens
`settings-model` (use, picture support, download, delete), and Get more opens
`settings-model-catalog` and `settings-model-search` (Hugging Face, through the
Pond). Activation names the model's own category (`pond_category`, such as
`tts_kokoro`) and its role; the Pond refuses one without a role.

Conversations is the rename-and-delete list of what the Pond holds. The Chat
tab's wall is the way into a conversation; this is the way to tidy them, and it
opens a row in `app/conversation.tsx` like the wall does.

Web search sets, checks and removes the Pond's Brave Search key, over
`/api/v1/web-search` (goose-in-a-pond's `docs/architecture/small-model-tools.md`,
sections 8.4 and 8.5; pond-desktop shows the same content). The key field is
masked and write-only: the Pond never returns the key, so the only copy this app
holds is what has been typed, and it is emptied once the Pond has it. A key
Brave refuses is a 422 and stays in the field to be corrected. The privacy line
is always on screen. The screen is behind the Developer toggle (`webSearch`,
real by default): on mock, typing `invalid`, `quota` or `offline` as the key
reaches the refused, spent and unchecked states without a Pond.

Secrets (Settings, Tools, beside Extensions and Web search) lists, adds,
replaces and deletes the keys the Pond holds for outside services, over
`GET /api/v1/secrets`, `PUT /api/v1/secrets/{key}` and
`DELETE /api/v1/secrets/{key}` (pond-api `routes.rs`, `list_secrets_handler`
and its neighbours). The routes need a paired session and nothing more, so any
paired phone may use them; none is host-only. The exception is members' Uber
sign-ins (`UBER_` and anything after it): the listing leaves them out and the
other routes answer 403 `secret_reserved`, which the screen says in words. The
Pond lists names only. Known keys show the catalogue's friendly name
(`models/secrets.ts`), others their own. The value field is masked and
write-only, and is emptied the moment it is submitted, whatever the answer. Add
will not overwrite a stored key; Replace is the way to change one. A save names
any extension that could not restart to use the new value.

Five more stack screens aren't in the hub:

- **Pond Pairing** (`/(stack)/pond-pairing`) — from the pairing gate below, first
  run, Switch Pond, Your home and the connection banner.
- **Switch Pond** (`/(stack)/switch-pond`) — from Home's Pond card; the Ponds on
  this network, the one in use marked. A pick opens the wizard at that Pond through
  `offerPairingStart`, as the welcome screen does; until 2026-10-17 it went in a
  route param the wizard never read, and the wizard opened on its own search.
- **Add a device** (`/(stack)/commission-device`) — from the Devices tab and Home.
- **Wake word** (`/(stack)/wake-word`) — from Home's "Finish setting up" card after owner setup: the phrase and its calibration, saved through the shared settings store.
- **Connect Desktop** (`/(stack)/connect-desktop`) — the QR scanner opened from
  Pond Pairing. It reads the pairing QR and a Pond's printed setup card
  (`pond://setup`), and hands either back through `services/pairing-handoff.ts`.
  It has no header at all; the viewfinder carries its own dismiss.

Every other stack screen gets its header, and its back control, from
`app/(stack)/_layout.tsx`: these screens are pushed through the root stack, so
the nested navigator has one entry in its own history and would draw no back
button of its own. The header reads `useTheme()` directly, because a navigator
header is the one surface `useThemedStyles` cannot reach.

## Every route has to lead somewhere

expo-router resolves routes at runtime, so a menu row pointing at a deleted screen passes `tsc` and fails only when someone taps it, on an unmatched-route screen. `constants/__tests__/navigation.test.ts` holds three rules:

- every profile menu row in `constants/navigation.ts` reaches a screen file, and every catalogue settings page is reached from a menu row or a page link;
- every screen `app/(stack)/_layout.tsx` registers exists;
- every screen file in `app/(stack)` is registered.

The third is this app's rule, not expo-router's. The stack sets `headerShown: true`, and a screen the layout does not register gets its route name as its header. That is how Remote Access shipped headed `remote-access`, lowercase and untranslated, until the guard caught it. So a new screen needs its `<Stack.Screen name="..." options={{ title: t('screens....') }} />` line, and removing a screen means removing its file, its registration and its menu row together.

Backup and Restore were removed rather than wired (#64): the Pond exposes no backup API, and a screen reporting a backup that never ran is worse than no screen. Biometrics went for the same reason: it showed face recognition as enrolled from a hardcoded state and "enrolled" voice recognition on a two-second timer, with no call to the Pond -- which has no voice biometrics at all. Photos and Videos and Upload for Analysis went too: they showed analyses of household photos that never ran, and the Pond exposes no image analysis. Their hub group, Media and data, went with them rather than stay as an empty heading.

## Voice

There is no separate listening overlay. Voice mode belongs to the conversation:
the composer's speak control swaps `ChatDock` for `VoiceDock`, in the same place,
and the orb in it is `VoiceOrb`.

## First run

Find your Pond (`app/(onboarding)/welcome.tsx`), then Wi-Fi for a Pond found over Bluetooth, then owner setup for a Pond nobody has set up, then Home. For a new Pond on Bluetooth with a chat model already on it, that is three screens before Home, plus the scanner. On 2026-10-17 the same path took thirteen. Each removed screen, and where its information went, is in the table under "Owner setup" below.

**Find your Pond** is the welcome screen.

- **Ponds nearby.** It lists Ponds heard over Bluetooth (`view-models/use-nearby-ponds.ts`) and those seen on this network advertising `setup=1`, one row per card id (`models/nearby-pond.ts`). Picking one heard over Bluetooth connects first, because only `hello` says whose it is. A new Pond takes its card's code. Someone's Pond that has lost its network (it moved house, or the router changed) offers only "Have it say a code", then the Wi-Fi screen. If its pin is the one this phone is paired with, the phone first resumes on its own refresh token, with no code. That is how a Pond is given Wi-Fi again, with no screen of its own.
- **Scan the setup card** is the main button. A scanned card picks the Pond whose advertised service UUID carries its id, and claims it the moment that Pond is heard. There is nothing more to tap.
- **A Pond picked without a card** opens its claim under its own row (`components/setup/nearby-ponds.tsx`): the card's eleven digits with their Luhn check, "Scan the setup card", and "Have it say a code". Claiming, a wrong code, the cooling wait and "already claimed" are all said on that row.
- **The phone's name** is its own (expo-device's name, else its model), shown as "This phone joins as …" with Change. Nothing asks for it. iOS 16 and later report plain "iPhone", so once setup knows the owner, a phone still under such a generic name is renamed, e.g. "Amina's iPhone" (`PUT /devices/{id}`, sending its host name and room back as they were).
- **Claiming** goes over the network when the Pond is on it, as the HTTPS setup exchange (no Wi-Fi step then), and otherwise over Bluetooth (`view-models/pond-claim.ts`).
- **"Join a Pond that's already set up"** stays below. It lists the claimed Ponds and Enter an address, and opens the pairing wizard as before. The wizard has no Name step any more: its code step shows the phone's name with Change, and pairing starts once the code is in.

A choice reaches the wizard through `offerPairingStart` in `services/pairing-handoff.ts`, not route params, so a `gooseonthego://` link cannot open the wizard with an address and pin already filled. There is no restore path, because there is no backup to restore from.

**Wi-Fi** (`app/(onboarding)/pond-wifi.tsx`, `view-models/use-pond-wifi.ts`) follows a claim over Bluetooth.

- **Its list** is the Pond's own `wifi_scan`: known networks first, then strongest. The phone's own network is never read.
- **A network** opens under its row, with a masked password field the phone never saves, then Join. iOS still shows its Passwords key above the keyboard on any masked field; nothing asks it to save one. Progress and every `wifi_join` refusal show there.
- **Keeping the session open.** A `status` request every 45 s keeps the Bluetooth session inside the Pond's 120 s idle limit while someone types.
- **Already online.** A Pond already on a network (Ethernet, or a network it knew) passes through without a choice.
- **The handover.** Once the Pond has an address, the pairing is kept at once (`adoptPairing`), then the Pond is reached over HTTPS. A phone not on that network sees one state, "Connect this phone to <ssid>", which checks again on every network change and on Check again.
- **Lost.** A Bluetooth session lost before then (a dropped link, a refused write, the Pond's 10-minute cap) offers Reconnect. The phone finds the Pond by its card id and resumes as the paired device on the claim's own refresh token, with no code. If that fails, Find your Pond and a spoken code are the way back in.

A Pond that advertises itself unclaimed (`setup=1`), a scanned card, and a spoken code all skip the fingerprint pick, because each exchange proves the pin (ARCHITECTURE.md, "Finding the Pond"). Over Bluetooth the pick never appears: the pin comes from `hello`, and the exchange binds it.

## Owner setup (2026-10-17)

`app/(onboarding)/owner-setup.tsx` is pond-desktop's onboarding wizard for a Pond with no screen, trimmed for a phone:

- **About you**: name, preferred name, birthday and speech. Under "Where you are", the language and time zone are prefilled from the phone and editable, and a place, detected or typed, sets the weather.
- **How Goose talks**: style, personality, name and voice, all preselected. Its Finish completes setup. A voice can be heard on the Pond's own speaker through P4's `POST /voice/sample` (goose-in-a-pond#579).
- **Goose's model**, only when the Pond refuses to finish without a chat model.

`models/owner-setup.ts` holds the steps, the backend steps each records (About you records Basics and Location), and the keys each writes, copied from the desktop's `onboarding.constants.ts` and `useOnboardingPersist.ts`. The screen renders `view-models/use-owner-setup.ts`, and the steps are in `components/setup/`.

What the removed screens held, and where it is now:

| Removed | Now |
|---|---|
| Wizard: Find, Code, Name, Pairing (new Pond) | Find your Pond: inline search, code, claim and errors; the phone's own name |
| Setup: Welcome | The Pond's name on Find your Pond and Home's Pond card; the progress meter; Switch Pond on Home |
| Setup: Language and location | Prefilled from the phone on About you; also in Settings (Your home, Time zone) |
| Setup: Wake word | Home's "Finish setting up" card, which opens `/(stack)/wake-word` (phrase and calibration); also Settings > Listening |
| Setup: All set | Memory stays on (sent with Finish) and is in Settings > Memory; "Look over your choices" on Home opens Settings |
| Setup: Ready | Home's getting-ready card, shown after every setup until Goose can answer |

- **How it is reached.** Pairing that succeeds asks `/onboard/status` and opens setup instead of Home when the Pond is not done. On launch, `view-models/use-setup-gate.ts` asks once per pairing, and the tab layout redirects while the answer is `needed`. Until the Pond answers, Home shows, so an unreachable Pond never holds the app on a blank screen. Any request the Pond refuses with 403 `onboarding_required` sets the gate too, which replaced the quiet retry that used to be the only thing that happened.
- **Each step is saved as it is left**, then recorded with `POST /onboard/step/{name}`. A Pond that will not record a step has still saved it. Setup reopens on the screen after the furthest one recorded. A Pond with Basics recorded but not Location was left halfway by an older build, so it reopens on About you.
- **What the Pond will not answer until setup is done** shapes the rest.
  - The record is read with `GET /settings`, which a paired token may use before setup from goose-in-a-pond#579 (P4) on. An older Pond refuses it with a 403, and then an empty `PUT`, which writes nothing, answers the same record.
  - `GET /profiles` is refused and `PATCH /profiles/{id}` replaces the whole preference map, so the draft is kept on the phone (`storageFamily('setupDrafts')`, by pairing) and every PATCH sends the whole map.
  - Before P4 the voices offered are the installed ones `/voice/tts/apply` reports plus Kokoro's graded catalogue. The picker is Settings' own (`VoicePickerView`). Its play button asks the Pond to speak, and on a Pond without the route the picker says that samples come after setup.
- **Calibration is recorded on the phone.** `/voice/calibrate` takes an uploaded WAV and the sentence read; the Pond does not listen itself. The wake word screen records the five sentences pond-voice's `calibration_prompts` builds, one take each, and starts each run by clearing the old one.
- **Finishing.** Finish sends `agent_memory_inject` and `POST /onboard/complete`. A 400 names `missing_fields`: setup goes back to the earliest step that sets one, and says which. `chat_model` alone opens the model step, quietly.
- **The model step** (`components/setup/model-step.tsx`, `view-models/use-setup-model.ts`) reads the Pond's models, which P4 opens to a paired token before setup.
  - It offers the chat model already chosen or on the Pond, else the Pond's own suggestion, with its size.
  - It asks before downloading (`askToDownload`, shared with Models).
  - Once the model is on the Pond or its download is moving, it gives it the chat job (`POST /models/{category}/{name}/activate {"role":"chat"}`, which P4 accepts without waiting for the file) and finishes by itself, once per model. Home's getting-ready card then shows the download until Goose can answer.
  - The Pond ignores a failed write of `chat_model`, so a finish that still refuses shows Try again, rather than spinning or asking again on every read.
  - A Pond that refuses `/models` gets the old notice.
- **After finishing**, setup leaves for Home. Home's `PondGettingReady` shows whether the chat model is downloading, warming or ready, and the "Finish setting up" card (`components/patterns/finish-setup.tsx`, kept per pairing in `storageFamily('setupChecklist')`) holds the wake word and a look over the defaults. Only the phone that set the Pond up sees that card.
- **The phone's owner is shown as the Pond reports it** (`/devices/self`). A claim binds the phone to nobody, since a new Pond has no members yet, and nothing attributes it afterwards.

## Pairing gate (2026-09-21)

Nothing in this app works without a paired Pond, so an app without one reaches
none of it: `app/(tabs)/_layout.tsx` redirects whenever no identity is stored —
to the welcome screen on first run, or to `/(stack)/pond-pairing` once that
screen has been seen and dismissed. A fresh install and a phone that has just
signed out land in the same place.

The guard is keyed on the **stored identity**, not on the connection state, and
the distinction is load-bearing. `ConnectionManager.configure` publishes
`upgrade` or `unpaired` only when it is given no saved profile, which pairing
itself does while it stages a new one. A saved profile starts as `reconnecting`,
or as the route a previous manager found in this process (2026-10-05). Either
way the state is a placeholder until the first probe answers, so a guard
watching it would misroute in the middle of setup, such as enabling remote
access, which reconfigures the manager. The guard also waits for `hydrated`, or
every cold start bounces through pairing before discovering it is already paired.

Pairing leaves for Home the moment it succeeds, replacing rather than pushing, so
a finished wizard is not left in the stack. There is no success screen. The
remote access offer that used to follow it is a dismissible card on Home, shown
only to a Pond that is paired and reachable without remote access; declining is
remembered against the paired profile, so a phone that pairs afresh is asked
again.
