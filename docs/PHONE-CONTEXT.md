# Phone context — what the phone could tell the Pond

Status: **proposal**, written 2026-10-16. Nothing here is built. It is the phone's half of the
Pond's [PAI-8, personal context streaming](https://github.com/jarida-io/goose-in-a-pond/blob/main/docs/architecture/pai/08-personal-context-streaming.md),
which already names this app as a first-class source and is waiting on it.

The question it answers: what can a phone collect, reduce and send to its own Pond so that Goose
knows enough about the household's day to be useful at the right moment, without anything leaving
the house that does not have to.

## 1. What is true today

### The phone sends almost nothing

Verify before you reuse any of this: grep the symbol, the paths below will drift.

- **A heartbeat**, every two minutes while the app is in the foreground (`services/heartbeat.ts`,
  `POST /api/v1/devices/{id}/heartbeat`). The body is empty. The Pond uses it only for the phone's
  own `last_seen`, so the phone does not age out of its device list.
- **A push token** (`services/push-token.ts`, `POST /api/v1/devices/{id}/push-token`).
- **What the user starts**: chat, voice turns, photos picked for a chat.
- **Location, once, for a ride fare** (`view-models/use-ride.ts`): a foreground, high-accuracy
  fix, sent to the Pond and on to the ride company. This is the only location the app reads.

The only background work is a push wake-up. `expo-task-manager` arrived with #155, and
`services/background-notifications.ts` registers one task: a notification the Pond pushes wakes
the phone long enough to receive it. It reads nothing from the phone, so it is not a context
source. There is still no `expo-background-fetch`, `expo-calendar` or `expo-contacts` in
`package.json` -- nothing that would let the phone gather on its own schedule.

The only foreground service is remote access's `PondNetworkService` (type `connectedDevice`,
declared by `plugins/with-pond-tls.js`), which holds network access for the tunnel and reads
nothing from the phone.

The connection manager already knows how it reached the Pond: `services/connection-manager.ts`
types a route as `'local' | 'remote'`, the home network or the embedded tailnet.

### The Pond has a slot waiting for the phone

- **`SourceKind::Mobile`** in `pond-core/src/context/domain.rs`, documented as "the mobile
  companion (GOTG) pushing calendar, location or contacts". Its availability is
  `AwaitingIngestRoute`: the pipeline refuses its items until `POST /api/v1/context/ingest`
  exists. That route is PAI-8 phase P3, "`POST /context/ingest` + GOTG calendar and location".
- **Five item kinds**: `Message`, `Event`, `Document`, `Location`, `Task`.
- **The hard rules already apply** (PAI-8 §3.6): every item carries a `profile_id` and a
  `PrivacySensitivity`; `Mobile`'s floor is `Sensitive`; a `Guest` session sees no item; redaction
  runs before persistence; disconnecting a source deletes its items and says how many; retention
  follows the user's existing per-category map.
- **`POST /api/v1/sensors`** exists today: `{device_id, sensor_type, value: f64, unit}`. It
  persists the reading and publishes it on the event bus, where automations and proactive speech
  can react. A phone-derived *state* (home or away, driving or not) fits it now, with no new route.
- **`giap-context`**, the MCP extension, is how the agent reads context back:
  `search_context`, `get_recent_context`.

### The privacy documents are already behind the code

`docs/PRIVACY.md` says "We do not ask for your location, your contacts, or your photo library", and
`docs/DATA-SAFETY.md` says there is no location permission. The app has asked for location (ride
fares) and the photo library (chat attachments) for some time. That has to be corrected before
anything in this document ships, and every source below changes both files and the store answers.

## 2. Goals

- Goose knows **who is home**, **what the day holds**, and **whether now is a good moment** to
  speak, without being asked.
- Each source is **reduced on the phone** to the least the Pond needs, before it is sent.
- Context goes **only to the household's own Pond**, over the home network or the household's own
  tailnet. No relay, no cloud, no developer access.
- Every source is **visible and revocable in the app**, in the place a household would look.

### Not goals

- Write-back (Goose changing the calendar). PAI-8 defers it as a separate risk profile.
- Realtime streaming. The phone syncs on events and on a schedule; the Pond never holds the phone.
- Anything the platform only allows through an unofficial or fragile path.

## 3. What a phone can contribute

Ordered by what it unlocks against what it costs in permission and trust.

| Signal | What it unlocks on the Pond | How the phone reads it | Lands as | Floor |
|---|---|---|---|---|
| **Home or away, from the network path** | Arrival and departure automations; announcements only to people at home | The route the heartbeat took: `local` or `remote`. No new permission | A presence sensor reading | Internal |
| **Home or away, from a geofence** | The same, but true when the phone is on cellular at the gate | iOS region monitoring; Android Geofencing. Both need background ("Always") location | A presence sensor reading | Sensitive |
| **Calendar** | "Your four o'clock moved", leave-by reminders, quiet during meetings, a morning briefing | iOS EventKit, Android `CalendarContract`, through `expo-calendar` | `Event` items | Sensitive |
| **Do not disturb, Focus, silent** | Goose does not speak aloud, or speaks on the phone instead of a speaker | Android's notification policy, with access granted; iOS gives only whether a Focus is on, through `INFocusStatusCenter`, with the Communication Notifications entitlement | A state reading | Sensitive |
| **Driving** | Nothing spoken that needs reading; short answers | iOS Core Motion activity; Android Activity Recognition | A state reading | Sensitive |
| **Coarse location** | Weather where the person is, travel context, "remind me when I get to the office" | Significant location change only, rounded to a place before sending | `Location` items | Sensitive |
| **Reminders** | One household task list Goose can read | iOS Reminders, through EventKit. Android has no shared store | `Task` items | Sensitive |
| **Contacts** (opt-in) | "Call Mum"; names Goose can recognise | `expo-contacts` | People, once PAI-8's entity resolution lands | Sensitive |
| **Sleep and activity** | Wake-up and bedtime routines | HealthKit; Health Connect. Both behind store review and an entitlement | State readings | Sensitive |
| **Notifications** | Messages from other apps as context | Android `NotificationListenerService` only; iOS does not allow it | `Message` items | Sensitive |

### Shortcuts and intents

iOS Shortcuts automations ("When I arrive home") and Android intents can call the Pond with no
background permission at all, because the user built the automation and can see it. App Intents
that post a presence reading are a cheap complement to every source above, and work while the app
is not running.

## 4. Shape

### On the phone

```text
collectors ─▶ reducer ─▶ outbox ─▶ sync ─▶ the Pond
(per source)  (on-device  (persisted,   (local or remote
               minimising) idempotent)    route only)
```

- **Collectors**, one per source, behind its own permission and its own switch.
- **The reducer** is where the minimising happens, and it is tested on its own: "home", not a
  coordinate; a place name, not a fix; an event's time, title and place, not its attendees'
  addresses or notes. A field the Pond does not use is never read.
- **The outbox** persists what has not been accepted yet, keyed by `(source, external_id)`, so a
  sync that fails is retried and a sync that succeeds twice changes nothing. The Pond's ingest is
  idempotent on the same key.
- **Sync** sends only over a route the connection manager has already proven (`local`, or
  `remote` through the embedded node). There is no other transport.

### When it syncs

iOS does not run apps in the background on request, so the triggers are the ones it offers:

- entering or leaving the home region (region monitoring wakes the app);
- a significant location change;
- `BGAppRefreshTask`, which runs when iOS decides;
- a silent push the Pond sends to ask for a sync. This needs the paid team's push entitlement; the
  personal team cannot sign it;
- the app coming to the foreground.

Android adds a periodic `WorkManager` job (no more often than every 15 minutes) and the
`dataSync` foreground service `app.json` already declares, for a sync that must finish.

### On the Pond

1. **Now:** presence and state readings to `POST /sensors`, with `sensor_type` names agreed in
   one place (`phone.presence`, `phone.driving`, `phone.dnd`) and the phone's own device id.
2. **PAI-8 P3:** `POST /context/ingest`, flipping `Mobile` to `Landed`. Items go through the
   production redactor and the ingest pipeline like every other source, owned by the profile the
   phone is paired to.
3. **Consumers already exist:** the agent through `giap-context`, automations and proactive
   speech through the event bus, and quiet hours and announcements through settings.

## 5. In the app

Automagical where it costs nothing, asked for where it costs trust.

- A Settings page, **What this phone shares**, under *Notices and privacy* (the Settings menu from
  #131). One row per source:
  its switch, when it last synced, how many items the Pond holds from it, and **Delete from my
  Pond**, which disconnects the source and says how many items went.
- **Presence from the network path is on by default.** The heartbeat already reaches the Pond by
  one route or the other; saying which adds no new data, and the row says so.
- **Every other source starts off**, and is offered in context rather than in a wall of
  permissions. The first time Goose could have used a calendar, the app suggests it, with one tap
  to turn it on and the platform prompt behind it.
- A source whose permission was revoked in the OS becomes a Settings issue
  (`constants/settings-issues.ts`, from jarida-io/goose-on-the-go#131), so the dot on the You tab
  says something needs attention.
- The Pond side shows the same sources in the household's view, so whoever runs the Pond can see
  what each phone is sharing.

## 6. Rules

PAI-8's invariants, restated for the phone, plus what only the phone can promise:

1. Nothing is read from a source whose switch is off, and nothing is sent that the Pond does not
   use.
2. Reduce before sending; redact before persisting. Both, not either.
3. Every item is owned by the paired profile and is at least `Sensitive`. A `Guest` sees none.
4. Only the household's own Pond, only over a proven route. No third party, ever, for context. The
   ride company receiving a pickup point is a ride, not context, and stays separate.
5. Turning a source off stops it at once. Deleting removes the Pond's copy and says how much.
6. Each source updates `PRIVACY.md`, `DATA-SAFETY.md` and the permission strings in `app.json`
   in the same change. A permission string must say what the data is for, in a sentence a
   household would read.

## 7. Phases

| Phase | Phone | Pond |
|---|---|---|
| **0** | Correct `PRIVACY.md` and `DATA-SAFETY.md` for ride location and photos | none |
| **1** | Heartbeat says which route it took; presence row in Settings | Derive presence from it, or accept it as a `phone.presence` reading |
| **2** | Home geofence → `phone.presence` on `/sensors` | Automations on arrival and departure |
| **3** | `expo-calendar` collector, reducer and outbox; the shares page | `POST /context/ingest`; `Mobile` becomes `Landed` (PAI-8 P3) |
| **4** | Focus, do-not-disturb and driving states | Announcements and voice respect them |
| **5** | Coarse location; Reminders on iOS | `Location` and `Task` items in `get_recent_context` |
| **Later** | Contacts; sleep and activity; Android notifications | Entity resolution (PAI-8 defers it) |

## 8. Open questions

- **Presence per person or per phone?** A phone is paired to one profile; a person may carry two.
  The Pond should merge on profile, not device.
- **Is the network path honest enough?** A phone on home Wi-Fi in the garden is home; a phone left
  on the hall table while its owner is out is not. The geofence and the network path disagree in
  exactly those cases, and the Pond needs a rule for the disagreement.
- **iOS Focus** reports only that *a* Focus is on, not which. Is "on" enough to stay quiet?
- **Calendar scope.** Every calendar on the phone, or the ones the person picks? Work calendars
  are where the redactor will work hardest.
- **Battery.** Region monitoring is cheap; significant-change location is cheap; Activity
  Recognition is cheap. A periodic calendar read is cheap. Anything continuous is not, and is out.

## 9. Verification

Per this repository's own rule, none of this is finished until it has run on a real phone against
a real Pond. Unit tests mock the network and the OS, and every source here is decided by the OS:
when a region fires, whether a background task runs, what a revoked permission looks like.

- **Unit:** the reducer for each source (what leaves, field by field); outbox idempotency and
  retry; the route gate refusing to send without a proven route.
- **Device:** each source on iOS and Android, in the foreground, the background, and after the app
  was killed; revoking the permission in OS settings; turning the switch off mid-sync.
- **Pond:** an ingested item is redacted before it is stored, owned by the right profile, invisible
  to a `Guest`, and gone after delete.
