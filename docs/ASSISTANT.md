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

## What Android does not allow

- **No always-on "Hey Goose" through this role.** The platform's hotword path
  (`HotwordDetectionService`, the always-on hotword detector) is a system API for preinstalled
  assistants. A third-party assistant gets the assist gesture and nothing more. Hands-free wake
  needs the app's own foreground service listening on the microphone, a later phase. The overlay
  is ready for it: `AssistActivity` can be started by an explicit intent from such a service (as
  a full-screen intent or from a visible notification, since Android limits activity starts from
  the background).
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
