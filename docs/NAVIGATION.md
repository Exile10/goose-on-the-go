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

Four more stack screens aren't in the hub:

- **Pond Pairing** (`/(stack)/pond-pairing`) — from the pairing gate below, first
  run, Switch Pond, Your home and the connection banner.
- **Switch Pond** (`/(stack)/switch-pond`) — from Home's Pond card; the Ponds on
  this network, the one in use marked. A pick opens the wizard at that Pond through
  `offerPairingStart`, as the welcome screen does; until 2026-10-17 it went in a
  route param the wizard never read, and the wizard opened on its own search.
- **Add a device** (`/(stack)/commission-device`) — from the Devices tab and Home.
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

Welcome (`app/(onboarding)/welcome.tsx`) → Pond Pairing → Owner setup, for a Pond
nobody has set up → Home. The welcome screen is the network scan itself, split
into its two ways in: "Set up a new Pond", which scans the setup card (the wizard
opens under the scanner to take it) or lists the Ponds advertising `setup=1`, and
"Join a Pond that's already set up", the rest of the list and the address form.
`PondList` badges an unclaimed Pond "Not set up" and prints its card id beside
its address, so a household with two new Ponds can tell which card is whose. A Pond picked there opens the pairing wizard
at that Pond's fingerprint check, as a Pond picked from the wizard's own search
does, and "Enter an address" opens it at the address form; the wizard begins
with its own search only when it is opened from anywhere else. The choice
travels through `offerPairingStart` in `services/pairing-handoff.ts`, not route
params, so a `gooseonthego://` link cannot open the wizard with an address and
pin already filled. There is no restore path, because there is no backup to
restore from.

Until 2026-10-05 the welcome screen put the address in a route param the wizard
never read, so either choice landed on the same search the welcome screen had
just shown.

A Pond that advertises itself unclaimed (`setup=1`) skips the fingerprint check:
the wizard stages it and opens at the code step on its setup card's entry, which
also offers "Have the Pond say a code" and a six-digit pairing code instead. A
scanned setup card goes further, since it carries the code: the wizard finds the
Pond with the card's id and opens at naming the phone (2026-10-17). The
fingerprint check itself offers "My Pond has no screen: have it say a code", which
skips the check and opens the code step while the Pond speaks; a code typed from a
screen after any skipped check returns to the check first. Why the check can be
skipped is in ARCHITECTURE.md, "Finding the Pond".

## Owner setup (2026-10-17)

`app/(onboarding)/owner-setup.tsx` is pond-desktop's onboarding wizard for a Pond
with no screen: Welcome, About you, Language and location, How Goose talks, Wake
word, All set. `models/owner-setup.ts` holds the steps, the backend step each one
records, and the keys each one writes, copied from the desktop's
`onboarding.constants.ts` and `useOnboardingPersist.ts`; the screen renders
`view-models/use-owner-setup.ts`, and the steps are in `components/setup/`.

- **How it is reached.** Pairing that succeeds asks `/onboard/status` and opens
  setup instead of Home when the Pond is not done. On launch,
  `view-models/use-setup-gate.ts` asks once per pairing and the tab layout
  redirects while the answer is `needed`; until the Pond answers, Home shows, so
  an unreachable Pond never holds the app on a blank screen. Any request the Pond
  refuses with 403 `onboarding_required` sets the gate too, which replaced the
  quiet retry that used to be the only thing that happened.
- **Each step is saved as it is left**, then recorded with
  `POST /onboard/step/{name}`; a Pond that will not record it has still saved the
  step. Setup reopens on the screen after the furthest one recorded.
- **What the Pond will not answer until setup is done** shapes the rest. `GET
  /settings` is refused, so the record is read back with an empty `PUT`, which
  writes nothing. `GET /profiles` is refused and `PATCH /profiles/{id}` replaces
  the whole preference map, so the draft is kept on the phone
  (`storageFamily('setupDrafts')`, by pairing) and every PATCH sends the whole
  map. `GET /models` is refused, so the voices offered are the installed ones
  `/voice/tts/apply` reports and Kokoro's graded catalogue, and none can be heard
  first: `/tts` answers loopback only. The picker is Settings' own
  (`VoicePickerView`) with no preview.
- **Calibration is recorded on the phone.** `/voice/calibrate` takes an uploaded
  WAV and the sentence read; the Pond does not listen itself. The wake step
  records the five sentences pond-voice's `calibration_prompts` builds, one take
  each, and starts each run by clearing the old one.
- **Finishing** is `POST /onboard/complete`. A 400 names `missing_fields`: setup
  goes back to the earliest step that sets one, and says which. `chat_model` has
  no default on the Pond and no step can set it, because a phone cannot list
  models until setup is done; setup says so and stays.
- **After finishing**, `components/setup/setup-ready.tsx` waits for the chat
  model to be on disk and warmed (`/warmup`, `/models/download/progress`). A
  model is never fetched without asking first (`askToDownload`, shared with the
  Models page). Going on before then marks the Pond getting ready, and Home shows
  `PondGettingReady` until it can answer.
- **The phone's owner is shown as the Pond reports it** (`/devices/self`). A
  claim binds the phone to nobody, since a new Pond has no members yet, and
  nothing attributes it afterwards.

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
