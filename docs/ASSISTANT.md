# Goose as the phone's assistant (Android)

Goose On The Go can be the phone's **digital assistant app**, the way ChatGPT and Claude can. Once
it is chosen, the system's assist gesture opens Goose's voice orb over whatever app is in front,
the user talks to their Pond, and the orb goes away again. Nothing here runs on iOS, which lets no
app take Siri's place.

## Using it

1. In the app: Settings, Voice, **On this phone**, **Use Goose as this phone's assistant**. The
   row shows whether Goose is the assistant now, and opens Android's own screen to choose it
   (Settings > Apps > Default apps > Digital assistant app). Android makes the choice; the app can
   only open the screen and read the answer back, which it does again each time it returns to the
   front.
2. Invoke it with the system gesture: hold the side key (power button), or swipe up from a bottom
   corner where gesture navigation offers it. On Samsung, Settings > Advanced features > Side
   button > Press and hold must say **Digital assistant**, not Power off menu. A Bluetooth
   headset's long press (`VOICE_COMMAND`) opens the same overlay.
3. The orb starts listening at once. Talk; Goose answers out loud and in text. The overlay closes
   when the conversation ends (a goodbye, a tap on the orb while it waits, or eight seconds with
   nothing said), on a tap outside the panel, on back, or when anything else covers it. **Type
   instead** opens the same conversation in the app.

What is said lands on the conversation wall as an ordinary conversation, like voice mode in the
app: the overlay is a new conversation each time it opens.

## How it works

| Piece | Where | Does |
|---|---|---|
| `GooseInteractionService` | `plugins/pond-assist/PondAssist.kt` | Lists the app as an assistant. Empty: see "What Android does not allow". |
| `GooseSessionService`, `GooseSession` | same | One per assist gesture. Turns its own window off and starts `AssistActivity` with `startAssistantActivity`, falling back to a plain `startActivity` (the assistant is exempt from background start limits). Hidden again when the overlay closes, so the next gesture is a fresh one. |
| `GooseRecognitionService` | same | Exists because Android requires an assistant to name one. Refuses every request at once (`ERROR_CLIENT`); see below. |
| `AssistActivity` | same | Translucent `ReactActivity`, own task affinity, out of Recents, `singleTask`. Renders the JavaScript component `assist`. Finishes itself in `onStop`, so an overlay nobody can see never holds the microphone. Also answers `ASSIST` and `VOICE_COMMAND`. |
| `PondAssistModule` (`PondAssist`) | same | `isAssistant()` (RoleManager, Android 10+; null below), `chooseAssistant()`, `close()`. |
| `with-pond-assist.js` | `plugins/` | Declares all of the above in the manifest, registers the package in `MainApplication`, copies the Kotlin and `res/` (the service descriptions and `Theme.GooseAssist`). |
| `services/phone-assistant.ts` | | Typed wrapper; a no-op on iOS and on a build without the module. |
| `components/assist/assist-root.tsx` | | Root of the overlay's own React tree, registered in `index.ts` as `assist`. Providers for theme, Ink, safe area and translations; no router, no ServerProvider. |
| `components/assist/assist-overlay.tsx`, `view-models/use-assist.ts` | | The dimmed backdrop and the panel: reaching the Pond, the last exchange, and `VoiceDock`, the same voice pipeline (`useVoice`) as voice mode. |
| `view-models/use-phone-assistant.ts`, `PhoneAssistantRow` | `components/settings/special-rows.tsx` | The settings row. |
| `GooseWakeService`, `PondWakeModule` (`PondWake`), `PondEar` | `plugins/pond-wake/PondWake.kt` | "Hey Goose": the listening service, its module, and the detector's JNI (below). |
| `with-pond-wake.js`, `native/pondear` | `plugins/`, `native/` | Declares the service, copies the Kotlin and the detector libraries in; the JNI shim over the Pond's `pond-ear`. |
| `services/phone-wake.ts`, `view-models/use-phone-wake.ts`, `PhoneWakeRow` | `components/settings/special-rows.tsx` | The "Listen for Hey Goose" switch. |

Two React surfaces share one JavaScript runtime: MainActivity's `main` (expo-router) and
AssistActivity's `assist`. They do not share a tree, which is why the overlay does not mount a
second ServerProvider: two providers would each install, and on unmount clear, the shared `api`
client's token and recovery callbacks. The overlay instead calls `ensurePondSession()`
(`services/pond-session.ts`), the same restore a push wake-up uses: when the app is running it
reuses the app's session, and on a cold start it restores the pairing from storage. A conversation
needs `hydrated` and `isScreenReal` from the provider, so `useChat` takes them through
`useChatOn(connection)` here; the overlay always talks to the real Pond.

The choose button opens `Settings.ACTION_VOICE_INPUT_SETTINGS`, falling back to
`ACTION_MANAGE_DEFAULT_APPS_SETTINGS`. It does not use
`RoleManager.createRequestRoleIntent(ROLE_ASSISTANT)`: the assistant role is not requestable, so
that intent returns `RESULT_CANCELED` without showing anything.

## "Hey Goose" on the phone

With Goose as the assistant, Settings, Voice, **On this phone**, **Listen for "Hey Goose"** lets the
phone listen for the phrase itself and open the same voice orb as the side key.

- **What listens.** `GooseWakeService` (`plugins/pond-wake/PondWake.kt`), a foreground service of
  type microphone, built on the Pond's own ear: the `pond-ear` crate, built for Android by
  `scripts/build-embedded-ear.sh` from the Pond checkout beside this repository (`native/pondear`,
  a JNI shim). Licences ship in the APK as `pond-wake-notices.txt`.
- **Which phrase.** The household's, set on the Pond (`voice_wake_word`), not a fixed one:
  - For "hey goose", the phone runs the Pond's detector itself (`hey-goose.onnx`, threshold 0.97;
    provenance and measurements in the Pond's `crates/pond-ear/models/hey-goose.md`).
  - For any other phrase, only the Pond knows it and the pronunciations it has learned, so the
    phone cuts what it hears into speech segments as the Pond's ear does for Whisper (Silero VAD
    v5, the revision the Pond downloads, embedded in the library) and asks the Pond about each
    (`POST /voice/wake/check`, `services/phone-wake-pond.ts`). The Pond matches it with the
    room's own triggers and answers `{heard, phrase}`; it keeps nothing. A segment waits in the
    app's cache until it is sent, at most two at once, and is deleted when answered or after
    30 s. This needs the Pond reachable; the settings row says that speech near the phone goes
    to the Pond.
- **When the phrase changes.** The app hands the service the phrase from the Pond's settings,
  which it re-reads while open (`PhoneWakeSync` in `app/_layout.tsx`), and every answer to a
  segment names the phrase. A change made on the dashboard or another phone therefore counts
  from the next segment, and a return to "hey goose" moves the phone back to its own detector.
  Learned pronunciations live only on the Pond, so calibrating or clearing them applies at once.
  The one gap: a phrase changed from "hey goose" while the app is closed and its background link
  is down is learned when the app next opens or the orb next reaches the Pond.
- **When it listens.** Only while the screen is on, the phone unlocked, and no screen of the app in
  front: the overlay does not open over the lock screen, and the app's own voice mode and the
  overlay record with their own microphone, so the service lets go while either shows. The
  notification says so, and its **Stop** turns the switch off.
- **What happens to the audio.** For "hey goose", each 80 ms is scored and dropped; the detector
  keeps the last 20 seconds in memory to place the phrase, and nothing is written or sent until the
  orb opens. For another phrase, each speech segment (at most 8 s) goes to the household's own
  Pond and nowhere else, and is deleted from the phone once answered.
- **Opening the orb.** On the phrase, the service releases the microphone and calls
  `GooseInteractionService.showOverlay()`, which shows the assistant's own session: the path the
  side key takes, and one Android allows from the background for the active assistant. Speak
  after the orb appears; what is said in the same breath as the phrase is not kept.
- **What stops it.** Goose no longer being the assistant (the service stops at the next phrase and
  the row says why), the microphone permission withdrawn, or Android refusing the start. Android
  14 and later start a microphone service only while the app is in front, so it starts from the
  switch and resumes each time the app opens (`resumePhoneWake` at launch, and `PondWakeModule` on
  each return to the front); after a reboot it waits for the app to be opened once.
- **Logs.** `adb logcat -s PondWake` shows `kind=wake_listening state=on|off mode=... why=...`,
  `kind=wake_detector rung=...` or `kind=wake_segmenter rung=...`, `kind=wake_heard p=...` or
  `by=pond`, `kind=wake_segment_dropped reason=...`, and every `kind=wake_refused reason=...`. The
  Pond logs `kind=wake_check heard=true` for a phone's wake, and its misses only at debug.

To build it: `npm run build:ear` (add `--emulator` for x86_64), then prebuild as usual. The
`with-pond-wake` plugin stops the prebuild if a packaged ABI's library is missing.

## What Android does not allow

- **No always-on "Hey Goose" through this role.** The platform's hotword path
  (`HotwordDetectionService`, the always-on hotword detector) is a system API for preinstalled
  assistants. A third-party assistant gets the assist gesture and nothing more, so "Hey Goose" is
  the app's own foreground service; see below.
- **No lock screen.** `supportsLaunchVoiceAssistFromKeyguard` is false: a locked phone does not
  open a conversation with the household's Pond.
- **No speech recognition for other apps.** Android 11 and earlier also make an assistant's
  `recognitionService` the system speech recogniser, so on those versions apps that ask the
  default `SpeechRecognizer` for dictation get an error while Goose is the assistant. From
  Android 12 the attribute does nothing. Keyboards that recognise speech themselves (Gboard) are
  not affected on any version, and `selectableAsDefault="false"` keeps the service out of the
  separate Voice input picker.

## Verifying it

Unit tests: `plugins/__tests__/with-pond-assist.test.ts` (manifest entries, idempotence, the
resources and the component name), `services/__tests__/phone-assistant.test.ts`,
`view-models/__tests__/assist.test.tsx` and `view-models/__tests__/phone-assistant.test.tsx`.
`npm run check:prebuild` applies the plugin.

On a device, after a native build:

1. Settings, Voice, the new row reads "Another app"; tap it, choose Goose On The Go, come back:
   it reads "Goose".
2. Open any other app, hold the side key: the orb appears over it, dimmed, and listens. Ask
   something; the answer is spoken and shown.
3. Say "goodbye", or wait eight seconds: the overlay closes and the app underneath is as it was.
4. Repeat with the app force-stopped (cold start), and with the phone not paired (the panel says
   the Pond cannot be reached and offers to open the app).
5. Press Home with the overlay open: it closes, and the microphone indicator goes out.
6. `adb shell dumpsys voiceinteraction` shows `io.jarida.gooseonthego/io.jarida.pondassist.GooseInteractionService`
   as the interactor.
