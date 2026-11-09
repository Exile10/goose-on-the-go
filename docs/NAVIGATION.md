# Navigation Architecture — Goose On The Go v2

## Design Inspiration
- **Alexa**: Floating mic FAB, shortcut carousel, full-screen listening ring
- **Google Home**: Device grid with color-coded toggles, room groupings, "Ask" bar
- **Claude Mobile**: Clean threaded chat, conversation list, generous whitespace

## Bottom Tabs (5)

Ink's `InkBottomBar`, floating over the screens rather than beside them, and
leaving on scroll. Labels come from `tabs.*` in the catalogue; icon names are
registry keys, so `device` is singular.

| Tab | Screen | Icon | Purpose |
|-----|--------|------|---------|
| Home | Dashboard | home | Greeting, status, devices, shortcuts, recent |
| Chat | Conversations wall → conversation | chat | Every conversation the Pond holds; open one or start one |
| My Goose | What the Goose holds for you | the brand mark | Suggestions to decide, watches, news briefs, the cart of kept listings, ideas |
| Devices | Device Grid | device | Room-grouped smart home control |
| You | Profile Hub | profile | Settings, integrations, data |

The bar is absolutely positioned, so a tab screen's own list has to clear it —
`paddingBottom: useBottomBarInset()`, never a hardcoded spacer. Which stage the
bar is in lives in `providers/chrome-provider.tsx`; see
[`VIEW-LAYER.md`](VIEW-LAYER.md#the-bar-leaving) for the last stage, where the
bar contracts to one control, and the fix in Ink that makes that work more
than once.

My Goose (`app/(tabs)/goose.tsx`, `view-models/use-my-goose.ts`) opens on one sentence of at most
three clauses, each a link to its shelf's screen, then a shelf per kind of thing with something on
it. Its glyph is the brand mark from `assets/images/tab-goose*.png`, made by `scripts/make-icons.py`;
the mark is never tinted, so an unselected tab steps back by opacity. The Pond has no cart or news
route: Cart (`goose-cart`) is the saved listings per collection, shown as a price range because kept
listings are alternatives, and News (`goose-news`) is what scheduled prompts last answered, with a
one-press daily 7:00 brief when there are none. Ideas (`goose-ideas`) is the Pond's composed
questions and its agent suggestions. Watching and Waiting on you open the existing `web-watches`
and `suggestions` screens.

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

Home's idea chips link with `?ask=<prompt>` and no id: a new conversation that
asks that prompt on arrival, as picking one inside a conversation does. The
screen clears the param once it has asked, so the activity being recreated on a
return to the app cannot send it twice.

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
| Goose | Assistant, Voice, Thinking, Models, Memory, Tools, Agents, Extensions |
| Home | Your home, People, Cameras and vision, Rooms and Ponds |
| Notices and privacy | Announcements, Privacy |
| Records | Memories, Conversations, Activity, Schedule |
| This phone | Appearance, and Haptic feedback as a switch on the row |
| Advanced | Advanced |
| Help | Help & Feedback: a guide to common problems, and email to support (#249) |
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

### Cameras and vision

`/(stack)/settings-cameras` is a catalogue page with four things the others lack, all against the
vision contract in goose-in-a-pond's `.ai/vision-finish-plan.md`.

- **What the camera is doing, first.** `VisionStatusCard` (a bare special, drawn on its own raised
  edge rather than as a row) says it in one sentence from `GET /vision/status` over the camera's
  latest frame: watching at so many pictures a second, looking for a camera, reconnecting with how
  long ago the stream dropped and why, switched off, or held back by Privacy, which links to
  Privacy's own Cameras switch rather than carry a second one. The status is read every 5 s. The
  frame is read about once a second, and only while the camera is running, this screen is in front
  and the app is in the foreground (`useLive` with `LIVE_VIEW_POLL_MS`, the one poll allowed under
  its 5 s floor; the Pond allows 600 requests a minute and this spends a tenth, on screen only).
- **Three ways in**: Vision events (how many are unacknowledged), Faces (how many people the pond
  knows by face) and Vision automations (how many camera rules). The counts are read only by this
  page.
- **What the pond watches for** is one switch per kind of event over `vision_event_types`, with the
  last one left on locked (an empty list means every kind to the Pond), then the pause between
  events and how sure the detector must be.
- **Faces**: recognition on or off, and whether to look for a face in plain movement too.

Every vision setting applies live except the detector (`vision_classifier_model`), which the
contract leaves out of its live list and still says waits for a restart.

Pictures are never handed to the image view as a URL. `PondApiClient.fetchImage` reads one over
the pinned transport, the bearer in a header, and returns a `data:` URI; `services/pond-images.ts`
keeps the last forty and reads three at a time. Expo's image loader on iOS has its own session,
which the pin does not reach, so a Pond with its own certificate drew nothing there.

`/(stack)/faces` lists every household member from `GET /faces`, with whether the pond knows them
by face and how many samples it holds. A person opens a sheet: take a sample at the pond's own
camera (the recommended way, since recognition happens there: the live frame and
`POST /faces/register-from-camera`, with the 409 `no_frame`, 422 `no_face` and 403
`cameras_disabled` refusals each said as a sentence), or from a photo on the phone (multipart
`POST /faces/register`); how strictly a face must match, as a per-person override
(`PUT`/`DELETE /faces/profile/{id}/threshold`) with a way back to the default; and forgetting the
face (`DELETE /users/{id}/biometrics`, after a confirmation). The screen says first that face data
stays on the pond. A pond with no face model shows why, and what to do, in place of controls.

`/(stack)/vision-events`, Vision events, lists newest first the events the Pond recorded for the
camera its settings name (`vision_camera_id`), over `view-models/use-vision-events.ts`.
`GET /api/v1/camera/events` lists one camera per call and has no read across cameras, so an event
posted under another `camera_id` does not show here, and renaming the camera shows the new name's
events only. A row carries the event's picture (`snapshot_url`), who or what it was (a person by
the name `GET /faces` gives their profile id, or "someone your Pond doesn't know"), and the one
measure that matters: how sure the detector was, how much of the picture changed for plain
movement (the Pond's `confidence` means that for movement), or how closely a face matched. Filters
are chips on a hairline: all, people, faces, unknown faces, movement, pets, vehicles, packages,
unacknowledged; they apply to the latest 100 events the Pond lists, because it filters none. New
events arrive over `GET /vision/events/stream` while the screen is in front, with the 30 s poll
as what is left when the stream is not open (before it connects, after it drops, on a Pond with
no such route); a stream that opens reads the list once so nothing from the gap is lost. A row
opens a sheet with the large picture, everything measured, Acknowledge
(`PATCH /api/v1/camera/events/{id}/acknowledge`) and "Make an automation from this", which is the
automation form prefilled to listen for the same kind of thing, opened inside that sheet because
iOS drops a second modal presented over the first. The Pond has no acknowledge-all and no delete,
so neither does the screen; it prunes acknowledged events after 14 days on its own. Like Devices
it always reads the real Pond.

`/(stack)/vision-automations` lists the rules whose source is a camera, narrowed from `/rules`,
with starters to add in a tap (someone the pond does not know; a package; a named person arrives,
so ask Goose to greet them; movement at night). A starter is built from the kinds the pond is
watching for and the people it knows by face, so it is offered only when the pond would ever
produce its signal, and it goes once it exists; when no starter about a person can be offered it
says why. The form is the Schedule screen's one form: for a camera, what it listens for is chosen
from the contract's signals (`motion`, `person`, `pet`, `vehicle`, `package`, `face_detected`,
`face_recognized`, `face_unknown`, and `face:<profile_id>` for each household member, shown by
name), the confidence condition is named for what it measures, and it is typed as a percent
because the Pond compares a fraction.

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

### Agents

`/(stack)/agents` lists the household's agents, the helpers the Pond hands one job each (goose-in-a-pond
PAI-6 section 9): every recipe whose YAML has a `giap_role` block, with where its start-up copy (its
prefill) stands. Below them are the Pond's suggestions (`GET /agents/suggestions`), each saying why it fits,
when it would run, and that nothing runs until it is turned on; Turn on copies the template into this
member's recipes and the Pond builds its copy then. The built-in long-task helpers, shown by their goose
names (Point Gander plans, Forager Gosling works, Sentinel Goose checks, Nestmaker Goose composes), have a
prefill and no recipe, so they show only their status and Rebuild. Rebuild all asks first,
because every agent is slower until its copy is back. The words are pond-desktop's (`prefillWords.ts`).

An agent opens `/(stack)/agent?name=…`; with no `name` it is a new one. The phone edits what a person
writes (name, one line, instructions, steps per run, tools, personal data) and says the rest in
pond-desktop's words: when it runs, its hooks, sharing. The YAML is read and written with a copy of
the desktop's reader (`models/agent-yaml.ts`), and whatever the form has no field for is written
back as it was read, so a save here never drops a schedule set on the dashboard. A new agent runs
only when asked (`delegated`, `task_step`). Save asks `POST /recipes/validate` first and shows each
problem under the field its path names, or listed with its path; a Pond without the route saves as
written. A new agent's name is checked against the names already taken, because the Pond replaces
a recipe saved under a taken name. Leaving with unsaved changes asks first.

Home shows Getting agents ready while the Pond builds start-up copies (`GET /agents/prefills`,
`building`): every 30 s while none runs, every 5 s while one does, and never again for a Pond that
answers 404. The agents screens read it every 15 s, 5 s during a pass.

Every agents route goes through `view-models/agents-source.ts`, which picks the Pond or the
in-memory one in `models/agents-mock.ts` by the Developer toggle `agents` (real by default). The mock
queues a compile on save, rebuild and turn-on, waits for a quiet moment and compiles one agent at a
time, so every state the screens draw can be reached without a Pond. The prefill routes were written
against the contract before the Pond served them; on a Pond without them the screens say so and
everything else works.

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

Schedule (`/(stack)/schedule`) has two tabs over the Pond's scheduler:
Schedules (`/schedules`) and Automations (`/rules`). A schedule's card opens
`schedule-detail?id=…`: what it runs, when in words and as its cron, its zone,
next and last run, its recent runs with what each said or why it failed, and
edit, on/off, Run now and delete. A run shows three plain lines of its output
with the markdown taken out (`runPreview`) and how long it took in words
(`formatRunDuration`, both in `models/schedule.ts`); a run with more than that
opens in place to all of it, drawn by the chat's markdown renderer, and each
run opens and closes on its own (`components/patterns/schedule-run-row.tsx`).
An automation's card opens its edit sheet,
which also deletes it. Opened with `?schedule_id=…`, as a schedule notification
does, the list goes straight on to that schedule's screen, with the list left
beneath it for Back. Both tabs are behind the Developer toggle (`schedule`, real
by default); on mock they show the samples in `models/schedule.ts`.

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
  None of it needs the current Pond to answer, which is why an offline Home card
  leads here. Set up a new Pond opens first run (`/(onboarding)/welcome`) over the
  stored pairing, for a new or reset Pond that has not joined the network and so
  is not on the list: Bluetooth and the setup card live there. Until 2026-10-27
  first run opened only when nothing was paired, so a phone whose Pond had gone
  could not set up its replacement. There is one stored Pond, not a list; pairing
  another replaces it.
- **Add a device** (`/(stack)/commission-device`) — from the Devices tab and Home.
- **Wake word** (`/(stack)/wake-word`) — from Settings > Voice and Settings > Listening, the Voice agent, and Teach Goose your voice's intro: the phrase, saved through the shared settings store, and a way into Teach Goose your voice. Home's "Finish setting up" card opens Teach Goose your voice itself.
- **Connect Desktop** (`/(stack)/connect-desktop`) — the QR scanner opened from
  Pond Pairing. It reads the pairing QR and a Pond's printed setup card
  (`pond://setup`), and hands either back through `services/pairing-handoff.ts`.
  It has no header at all; the viewfinder carries its own dismiss.

Every other stack screen gets its header, and its back control, from
`app/(stack)/_layout.tsx`: these screens are pushed through the root stack, so
the nested navigator has one entry in its own history and would draw no back
button of its own. The header reads `useTheme()` directly, because a navigator
header is the one surface `useThemedStyles` cannot reach.

## My Pond

My Pond (`app/(stack)/pond.tsx`, `view-models/use-my-pond.ts`), the first row of the You tab's
menu under the household card, is the Pond's
administration, against goose-in-a-pond's `docs/architecture/pond-administrator.md`. Every route
is under `/api/v1/admin`, and every one but status, unlock and lock answers 403 `admin_locked`
until this phone is unlocked with the Pond's administrator card.

- **The lock is one state for the whole area** (`view-models/use-admin-gate.ts`). The tab and
  every screen under it read it, and any admin route that answers `admin_locked` returns all of
  them to the card's form (`components/pond/admin-lock.tsx`), which any of them can unlock from.
- **The card's form.** Sixteen Crockford base32 characters, shown in the card's
  `XXXX-XXXX-XXXX-XXXX` groups as they are typed. Case, dashes and spaces are ignored, and `O`
  reads as `0`, `I` and `L` as `1`, as the Pond reads them. Nothing is sent until the password is
  sixteen characters from the card. A Pond slowing wrong guesses gives `retry_after`, which the
  form counts down.
- **What it says instead of the form**: a Pond with no card (`card: "missing"`, made on the Pond
  with `bash scripts/giap.sh admin-card`), a phone that is not a member's (`admin_members_only`),
  and a Pond that predates My Pond (404, 405 or 501 on the status, after which it stops asking).
- **This phone's key** (`services/kept-admin-key.ts`). After the card opens My Pond, the phone asks
  the Pond for a key of its own (`POST /admin/enroll`, which replaces any older one) and keeps it
  behind the phone's own check: the iOS keychain with Face ID or a fingerprint
  (`requireAuthentication`, `WHEN_PASSCODE_SET_THIS_DEVICE_ONLY`), or on Android a Keystore-sealed
  copy that a fingerprint or the screen lock opens (`plugins/pond-keyguard/PondKeyguard.kt`; a
  Galaxy's face unlock is Class 2, which the Keystore never accepts), unless the form's "next time" switch is off or the phone
  has no biometrics; the web never keeps one. Owner setup keeps the key `/onboard/complete` gives
  the phone that claimed the Pond, and Home's getting-ready card says so. A non-secret AsyncStorage
  marker names the Pond (its pin), so the app knows a key is kept without a prompt; Android asks
  on every read of the key itself. With a key kept, the lock leads with "Unlock with Face ID or
  fingerprint" ("fingerprint or the phone's PIN" on Android) (`POST /admin/unlock {key}`), asks once by itself on each arrival, and keeps the
  card a tap away. A Pond with no card still opens to a key. A cancel leaves the lock as it was;
  a key the phone can no longer read (a new face or finger invalidates it) or the Pond rejects
  (`admin_key_rejected`) is forgotten, with a line saying to type the card. A status whose `key`
  is false forgets the kept one quietly. Open, "Forget My Pond on this phone" asks with Keep it
  as the safe answer, then sends `DELETE /admin/key` and locks. Signing out forgets it too.
- **Only the status is polled**, every 30 s while My Pond is in front. It is the one admin route
  that does not renew the unlock; the Pond locks after 15 idle minutes, and polling anything else
  would keep it open for as long as the phone sat on the tab. The overview and health are read on
  arrival, after an unlock and on a pull. After any admin request the countdown starts again,
  since the Pond renews the unlock on each.
- **Unlocked**, My Pond says when it locks, with Lock in the stack header's right, then the disk as
  an `InkMeter`, what the Pond keeps as one bar in four parts (models, engine caches, saved prompts,
  and the rest, every other area id included; `groupAreas`), its six counts, and rows to Files,
  Caches, Tasks and reports, Health (All good, or a badge when a check is not ok) and Power. The
  bar's parts differ in lightness as well as hue in both schemes (`StorageColors`).
- **The screens under it** are `pond-files`, `pond-caches`, `pond-tasks`, `pond-health` and
  `pond-power`. Each destructive action asks through `useConfirm()` with Keep it as the safe
  answer (`cancelLabel`): a delete names the entry and its size, a cache says what clearing it
  costs, a power mode change asks first, and a restart asks again when a long task is running (409
  `long_task_running`), sending `force` only on that second yes. A restart locks My Pond, as it
  ends every unlock on the Pond.
- **Another member's task** shows its state, kind, dates and size but never its goal or the
  titles of what it saved, so its artifacts are counted, not listed. Only the member's own tasks
  open their report (`task-report`).

My Pond is behind the Developer toggle `pond` (real by default). The mock (`models/pond-admin-mock.ts`)
follows the contract, idle lock, cooling and the key included; its card is `G00S-E1NA-P0ND-2026`,
which also unlocks typed as "goos eina pond 2026". A key kept for the mock is marked with its own
pin, `mock-pond`, so it is never taken for the paired Pond's.

## Every route has to lead somewhere

expo-router resolves routes at runtime, so a menu row pointing at a deleted screen passes `tsc` and fails only when someone taps it, on an unmatched-route screen. `constants/__tests__/navigation.test.ts` holds three rules:

- every profile menu row in `constants/navigation.ts` reaches a screen file, and every catalogue settings page is reached from a menu row or a page link;
- every screen `app/(stack)/_layout.tsx` registers exists;
- every screen file in `app/(stack)` is registered.

The third is this app's rule, not expo-router's. The stack sets `headerShown: true`, and a screen the layout does not register gets its route name as its header. That is how Remote Access shipped headed `remote-access`, lowercase and untranslated, until the guard caught it. So a new screen needs its `<Stack.Screen name="..." options={{ title: t('screens....') }} />` line, and removing a screen means removing its file, its registration and its menu row together.

Backup and Restore were removed rather than wired (#64): the Pond exposes no backup API, and a screen reporting a backup that never ran is worse than no screen. Biometrics went for the same reason: it showed face recognition as enrolled from a hardcoded state and "enrolled" voice recognition on a two-second timer, with no call to the Pond, which had no voice biometrics then. Faces and Voice Match replaced it, on the Pond's own routes. Photos and Videos and Upload for Analysis went too: they showed analyses of household photos that never ran, and the Pond exposes no image analysis. Their hub group, Media and data, went with them rather than stay as an empty heading.

## Notification taps (2026-10-27)

A Pond notification can name the screen a tap opens, as `open` in its `data` (the Pond's
`OpenScreen`, in pond-core `mcp/ports/notification.rs`, and its `docs/architecture/notifications.md`).
`openRouteFromData` in `services/notification-link.ts` accepts six values and `screenPath` maps
them:

| `open` | Screen | Sent for |
|---|---|---|
| `schedule` (with `schedule_id`, `run_id`) | `/(stack)/schedule`, going on to that schedule | a schedule result |
| `devices` | `/(tabs)/devices` | pairing, a Matter device, and a device removed |
| `chat` | `/(tabs)/chat` | a suggestion |
| `models` | `/(stack)/models` | a model download finished or failed, the disk running low or recovering, a start with speech or voice down |
| `extensions` | `/(stack)/extensions` | a start where a saved extension failed |
| `remote_access` | `/(stack)/remote-access` | remote access stopped, needs signing in, or works again |

The hint is the Pond's name, not the route's: `remote_access` is accepted, `remote-access` is
not. Any other value, a non-string, or no `open` at all is ignored, and the tap opens the app
where it was, so a newer Pond's hint is inert on an older app rather than an unmatched route.
The hint is checked when the notification is shown (`presentLocally` stores only a checked
hint) and again when it is tapped. A link or a ride offer in the same notification takes
precedence over the screen. `typedRoutes` is on, so a `screenPath` target that is not a route
fails `tsc`.

## Voice

There is no separate listening overlay. Voice mode belongs to the conversation:
the composer's speak control swaps `ChatDock` for `VoiceDock`, in the same place,
and the orb in it is `VoiceOrb`. A reply is sent to `/tts` a clause at a time
(`takeSpeechUnits` in `services/speech.ts`), and while it speaks the caption names
the Voice agent, which answers every spoken turn.

Everything else about voice is against goose-in-a-pond's room voice, Voice agent
and Voice Match contract, behind the Developer toggle `voice` (real by default;
the mock is `models/voice-mock.ts`). On a Pond without those routes each screen
says the Pond needs an update, where the mock would show a made-up household.

- **The Voice agent** (`/(stack)/voice-agent`, `view-models/use-voice-agent.ts`),
  from Agents' built-in Voice row and from the first row of Settings > Voice. The
  shipped agent that answers everything said out loud, at the Pond and on this
  phone. How it speaks (instructions and examples) and what it can use (tool groups
  it can only lose, and steps per answer) are held on the phone and saved with one
  button through `PUT /agents/voice`, which sends only what changed; a refusal is
  shown under the field its path names, a guest is told it cannot change it, and Go
  back to the shipped agent (`DELETE /agents/voice`) asks first. How it sounds links
  to Speaking. How it hears shows the wake phrase (to Wake word), the detector in use
  and why, Listen in this room (`PUT /voice/room`) and how a reply is stopped, then
  links to Listening. Who it knows links to Voice Match. Its start-up copy is its
  prefill, with Rebuild. Leaving with unsaved changes asks first.
- **In this room** is the first thing on the Voice agent page: what the Pond's own
  microphone and speaker are doing, who woke it, what it heard and is saying, who it
  last heard by name, and Stop talking (`POST /voice/room/interrupt`). It folds
  `GET /voice/room/events` into what it shows while the page is in front, and reads
  `GET /voice/room` every 15 s besides. Home has a card with the state, who was last
  heard and Stop talking, shown only where the Pond can listen in the room; it reads
  the status alone, because a stream held open for as long as Home is on screen keeps
  the radio awake for a glance.
- **Voice Match** (`/(stack)/voice-match`, `view-models/use-voice-prints.ts`)
  mirrors Faces: a row per member with how many of the five sentences the Pond holds.
  It says first that a voice never approves anything and that recordings are deleted
  once learnt. The speaker model downloads on its own, with its progress and its
  CC BY 4.0 credit. A person's sheet says how alike their sentences sounded, opens
  Teach Goose your voice for them (so an owner can hand the phone to someone with no
  phone of their own), and Forget this voice (`DELETE /voice/prints/{id}`) asks with
  Keep it as the safe answer.
- **Teach Goose your voice** (`app/teach-voice.tsx`, `view-models/use-teach-voice.ts`)
  is one full-screen flow for the wake phrase and Voice Match, after Apple's Hey Siri
  setup in Ink's material. It is a root-stack screen presented over everything, with
  its own close control and no header. An intro says what Goose learns and that
  recordings are not kept, with Recognise my voice on by default (off, and greyed, for
  a phone that belongs to no one or a Pond without Voice Match) and the speaker
  model's download where it is still coming. Then five sentences, one at a time, each
  starting with the household's wake phrase (a custom one too) and asking for
  something Goose does; never music, which Spotify's terms keep off voice. The
  sentence rests muted and flat, and rises to full ink on its offset while the phone
  hears speech: no glow, because state is elevation, not hue. Each take is one
  `POST /voice/takes`; an accepted one moves on by itself, a refused one keeps the
  sentence and says why ("I heard ... Say it with ... at the start"), and silence
  stops on Try again. What the Pond learned about the phrase belongs to the phrase,
  not the person, so runs add to it; it is cleared (`DELETE /voice/calibrate`) only
  when a run saves a different phrase. A print recorded again is forgotten first
  (`DELETE /voice/prints/{id}`). The done screen names the person, marks which of
  their sentences the "hey goose" detector fired on (each take's `new_detector`),
  says which detector the Pond now uses for the household and why, and marks Home's
  setup item done. Closing once a sentence is recorded
  asks first; Set up later leaves without asking and Home keeps its card. It opens
  from Home's setup card, the Wake word screen and Voice Match, and records with
  `view-models/use-take-recorder.ts`.
- **Wake word** keeps the phrase choice; its card opens Teach Goose your voice with
  the phrase chosen, which the flow saves before the first sentence, and says which
  detector the Pond listens with now and why.
- **Faces** forgets a face alone (`DELETE /faces/profile/{id}`). A Pond without that
  route forgets a face only with the voice (`DELETE /users/{id}/biometrics`), so the
  sheet asks a second time, naming both, before it does.
- **Listening** leads with In this room: the room switch, the detector and how a
  reply is stopped. The `voice_kws_*` fields sit under Whisper detector, because only
  Whisper reads them. **Speaking** leads with how a reply is stopped.

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
| Setup: Wake word | Home's "Finish setting up" card, which opens Teach Goose your voice (`app/teach-voice.tsx`); the phrase is on `/(stack)/wake-word`, reached from that flow's intro, the Voice agent, and a Wake word row in Settings > Voice and Listening; Settings > Voice also has the bare field, labelled Phrase |
| Setup: All set | Memory stays on (sent with Finish) and is in Settings > Memory; "Look over your choices" on Home opens Settings |
| Setup: Ready | Home's getting-ready card, shown after every setup until Goose can answer |

- **How it is reached.** Pairing that succeeds asks `/onboard/status` and opens setup instead of Home when the Pond is not done. On launch, `view-models/use-setup-gate.ts` asks once per pairing, and the tab layout redirects while the answer is `needed`. Until the Pond answers, Home shows, so an unreachable Pond never holds the app on a blank screen. Any request the Pond refuses with 403 `onboarding_required` sets the gate too, which replaced the quiet retry that used to be the only thing that happened.
- **Each step is saved as it is left**, then recorded with `POST /onboard/step/{name}`. A Pond that will not record a step has still saved it. Setup reopens on the screen after the furthest one recorded. A Pond with Basics recorded but not Location was left halfway by an older build, so it reopens on About you.
- **What the Pond will not answer until setup is done** shapes the rest.
  - The record is read with `GET /settings`, which a paired token may use before setup from goose-in-a-pond#579 (P4) on. An older Pond refuses it with a 403, and then an empty `PUT`, which writes nothing, answers the same record.
  - `GET /profiles` is refused and `PATCH /profiles/{id}` replaces the whole preference map, so the draft is kept on the phone (`storageFamily('setupDrafts')`, by pairing) and every PATCH sends the whole map.
  - Before P4 the voices offered are the installed ones `/voice/tts/apply` reports plus Kokoro's graded catalogue. The picker is Settings' own (`VoicePickerView`). Its play button asks the Pond to speak, and on a Pond without the route the picker says that samples come after setup.
- **Calibration is recorded on the phone.** The Pond does not listen itself: Teach Goose your voice records five sentences, each starting with the wake phrase, and sends each to `POST /voice/takes`. It clears the old calibration with `DELETE /voice/calibrate` only when it saves a different phrase.
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
