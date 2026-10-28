# Component Guide

How to add, modify, and remove components in the Goose on The Go UI library.

## Component Types

| Type | Location | Naming | Purpose |
|------|----------|--------|---------|
| **Primitive** | `@jarida/ink/native` | `Ink*` (InkButton, InkSwitch) | Basic building blocks. No business logic. A few in-house exceptions live in `components/ui/`: `GIcon`, `GPressable`, `GKeyboardView` and `EqualizerBars` — see below. |
| **Pattern** | `components/patterns/` | descriptive (conversation-card, voice-orb) | Composed from ink primitives. Domain-aware. |

As of issue #17, in-house primitives (the old `GButton`/`GCard`/`GChip`/etc.
`g-*.tsx` family) were replaced by `@jarida/ink/native`. Before adding a new
primitive, check whether ink already has it — most basic building blocks
should come from there, imported directly (e.g. `import { InkButton } from
'@jarida/ink/native'`).

## Adding a New In-House Primitive (exception case only)

Only add a component to `components/ui/` if ink has no equivalent — as with
`GKeyboardView`, or `GPressable`, which gives a hand-rolled tappable the press
response ink's own controls already have.

1. **Create the file** in `components/ui/` with kebab-case naming:
   ```
   components/ui/g-avatar.tsx
   ```

2. **Follow the prop pattern:**
   ```tsx
   interface GAvatarProps {
     variant?: 'default' | 'branded';
     size?: 'sm' | 'md' | 'lg';
     style?: ViewStyle;
     testID?: string;
   }
   ```

3. **Build the sheet through `useThemedStyles`**, never a hardcoded surface —
   and no inline objects:
   ```tsx
   import { useThemedStyles } from '@/hooks/use-themed-styles';
   import type { ThemeColors } from '@/constants/colors';

   const styles = useThemedStyles(makeStyles);

   const makeStyles = (c: ThemeColors) =>
     StyleSheet.create({ card: { backgroundColor: c.card, borderColor: c.border } });
   ```

4. **Import tokens** from individual constant files:
   ```tsx
   import { Accent, Grey } from '@/constants/colors';
   import { FontFamily, FontSize } from '@/constants/typography';
   import { Spacing } from '@/constants/spacing';
   import { Radii } from '@/constants/radii';
   ```

5. **Add haptic feedback** for pressable components, named by what happened
   (see [VIEW-LAYER.md](./VIEW-LAYER.md#haptics)):
   ```tsx
   import { selectionTick } from '@/services/haptics';
   // In onPress: void selectionTick();
   ```

6. **Strings go through the catalogue.** `t('ns.key')` from `useTranslation()`,
   with the key in `services/i18n/locales/en.json`. A key carried as data is
   typed `TranslationKey`, and a key is never assembled at runtime
   (`` t(`ns.${x}`) ``): `services/__tests__/i18n.test.ts` refuses it, because
   the key-completeness check cannot see it. Map a value to its key with an
   exhaustive `switch` instead.

7. **Wrap with React.memo** if it's a leaf/list component:
   ```tsx
   export const GAvatar = React.memo(function GAvatar(props: GAvatarProps) { ... });
   ```

8. **Export from barrel** in `components/ui/index.ts`:
   ```tsx
   export { GAvatar } from './g-avatar';
   ```

## Adding a New Pattern Component

1. **Create the file** in `components/patterns/`:
   ```
   components/patterns/notification-card.tsx
   ```

2. **Compose from ink primitives**, plus the in-house ones from `@/components/ui` where needed:
   ```tsx
   import { InkButton, InkSwitch } from '@jarida/ink/native';
   import { GIcon } from '@/components/ui/g-icon';
   import { GPressable } from '@/components/ui/g-pressable';
   ```

3. **Props should mirror ViewModel data shapes:**
   ```tsx
   interface NotificationCardProps {
     notification: Notification;  // from models/
     onDismiss: () => void;       // from ViewModel actions
   }
   ```

4. **Use React.memo** for list items.

## Modifying a Component

1. Read the component and understand its current props/variants.
2. Add new variants or props — don't break existing API.
3. Update the barrel export if the component name or export changed.

## Removing a Component

1. Search for imports across the codebase:
   ```bash
   grep -r "ComponentName" app/ components/ --include="*.tsx"
   ```
2. Remove or replace all usages.
3. Remove from the barrel export (`components/ui/index.ts`).
4. Delete the file.

## Adding a New Screen

1. **Create model types** in `models/` if needed.
2. **Create ViewModel** in `view-models/use-screen-name.ts`.
3. **Create pattern components** in `components/patterns/` as needed.
4. **Create screen file:**
   - Tab screen: `app/(tabs)/screen-name.tsx`
   - Stack screen: `app/(stack)/screen-name.tsx`
5. **Register the route:**
   - Tab: add to `app/(tabs)/_layout.tsx`
   - Stack: add `<Stack.Screen name="screen-name" options={{ title: t('screens.screenName') }} />`
     to `app/(stack)/_layout.tsx`. An unregistered stack screen is headed by its raw route
     name, and `constants/__tests__/navigation.test.ts` fails on it.
6. **Add navigation entry** in `constants/navigation.ts` if it should appear in the Profile hub,
   with `labelKey` a `TranslationKey`. See [NAVIGATION.md](./NAVIGATION.md#every-route-has-to-lead-somewhere).

## Feedback for actions

What a tap came to goes in the snackbar, not in a notice that stays on the
page: `useSnackbar().show({ message, tone, action })` from
`providers/snackbar-provider.tsx` in a component, `showSnackbar` from
`services/snackbar.ts` in a view-model or store. Confirmations are neutral;
failures are danger, with a Try again action when sending the request again
is cheap. A field's error, a form still open, and a standing condition stay
inline with `InkNotice`; content that did not load is `ContentUnavailable`. The
full rule, and the snackbar's timing, placement and accessibility, are in
"Feedback for actions" in [VIEW-LAYER.md](./VIEW-LAYER.md).

## Existing Components

### Primitives (@jarida/ink/native)
Imported directly from the library — not re-exported through `components/ui/`.
See ink's own docs for full prop lists; these are the ones the app leans on.

| Component | Description |
|-----------|-------------|
| InkButton | Action button — 3 variants (GButton's old secondary/ghost/bordered variants collapsed into ink's `quiet`; `size` prop is gone) |
| InkCard, InkEdge | Surfaces. A card already has a face and a plate; its own style carries layout only |
| InkTitle, InkText, InkEyebrow | Type. A section heading is `InkTitle level={3}` |
| InkRow, InkGroup | Settings-style rows and the group that titles them (the Profile hub) |
| InkChoice, InkSegmented | Filters and segmented choices |
| InkSwitch | Toggle switch |
| InkNotice, InkEmptyState, InkSpinner, InkSkeleton | Standing conditions, field and form errors, empty and loading states. Not for what an action came to: that is the snackbar |
| InkBadge, InkBubble | Badges; chat bubbles |
| InkIcon | Ink's icon slot, resolving from the same registry as `GIcon` |
| InkBottomBar, InkNavbar | The tab bar and screen title bars |
| InkProvider | Wraps the app (see `app/_layout.tsx`) |

### Primitives — in-house exceptions (components/ui/)
| Component | Props | Description |
|-----------|-------|-------------|
| GIcon | name, size, color, strokeWidth | Named lucide glyph from `constants/icons.ts` — see [VIEW-LAYER.md](./VIEW-LAYER.md). `components/ui/ink-icons.ts` registers the same set with Ink, so `InkIcon` resolves the same artwork |
| GPressable | feedback (`tint` / `lift`), Pressable props | A press that answers on the way down; `lift` dims instead under reduced motion. Imported by path, not through the barrel |
| GKeyboardView | offset, style | Keeps the focused input above the on-screen keyboard — no ink equivalent |
| EqualizerBars | color, count (8), height (20) | Animated level-meter bars for playing audio. See below. |

### Animated components: the rules EqualizerBars follows

`EqualizerBars` (`components/ui/equalizer-bars.tsx`) draws the Now Playing card's bars, each rising and falling at its own pace, so the row reads as "playing" at a glance. It is the first continuous animation in the app, and it sets the rules the next one should follow:

- **Run it on the UI thread**, with Reanimated, so it keeps its rhythm while the JS thread is polling the Pond.
- **Stop it when its screen is not in front.** Tab screens stay mounted, and an off-screen animation spends battery for nobody. It uses `useFocusEffect`.
- **Honour Reduce Motion**, with Reanimated's `useReducedMotion`, and hold still.
- **Keep render pure.** Each bar's motion is fixed per index (`equalizerMotion` in `equalizer-motion.ts`), not random.
- **Draw it only when it is true.** The card shows bars only while something is playing, never over "Nothing playing".

The motion numbers are in their own module because Reanimated's native worklets do not exist under Jest. That module is tested on its own (`components/ui/__tests__/equalizer-motion.test.ts`) without mocking Reanimated for the whole suite.

Verified on a device from outside the app. Six rapid screenshots of the bar area were all different, while a static control area was identical in all six. uiautomator cannot reach an idle screen on Home while the bars move, and it can on another tab, which shows the animation stops off-screen. Reduce Motion has not been tested on a device.

`VoiceOrb` is the other continuous animation, and it keeps the same rules by a different route: React Native's `Animated` on the native driver, one value per loop, with a still pose under reduced motion.

### Settings (components/settings/)

Every Settings screen is drawn from these, in Ink (`settings-theme.ts` gives each style
factory Ink's palette, its `inkText` styles and its metrics). Groups are hairline
surfaces with their name in Ink's eyebrow inside, as pond-desktop's cards carry it;
the raised edge is spent on what is chosen and on the main action, about twice a
screen, which is Ink's own budget. Text goes through `inkText` because it names the
weight's font file: a `fontWeight` on a custom family draws the regular face on
Android.

| Component | Props | Description |
|-----------|-------|-------------|
| SettingsGroup | title?, footer?, inset? | A group of rows on one hairline `InkEdge`, hairlines between them starting at `inset` |
| SettingsRow | label, icon?, tile?, description?, value?, trailing?, accessory?, note?, error?, onPress? | One row: tile, label, what it is set to, chevron or menu marker |
| SettingsHeader | icon, tile, title, description | The top of a detail page: tile, `InkTitle`, a line on what it covers |
| SwitchRow, MenuRow, TextRow, NumberRow, SliderRow, TimeRow | value and its setter | One control each, applying on change; text and numbers save when typing ends, sliders on release |
| radioRows, RadioRow | options, value, onChange | A choice with what each option means, one row each |
| SettingsSlider | value, min, max, step, onCommit | Becomes a drag after 8 px of sideways movement and then tracks 1:1, holding the gesture from the page's scroll; a vertical swipe across it scrolls, a tap sets the value. Drawn as the desktop's pace slider; `InkSlider` reads `locationX` and loses drags to the scroll |
| SettingsPageScreen | page | Draws one page of `SETTINGS_PAGES` |
| DownloadRow, ModelRow | download / model | A model's download with its controls, and a model with its size and job |
| VoicePickerView | voices, current, pace, applying, problem, onChoose, onPace, preview, silentLine | The picker with no store behind it; owner setup drives it with `usePondVoiceSample`, which has the Pond say the sample on its own speaker (P4), and passes `null` on a Pond without that route |
| VoicePicker | vm | pond-desktop's picker: `VoiceOrb` on an `InkStage` with the voice, its line and play; the accents as a sideways row of `InkChoice` pills; the best six voices as chips with "Show all"; the pace. Previews come from `useVoicePreview`, the line's loudness driving the face |
| IssuePage, IssueRows, IssueDot | issue, ctx / issues / tone | One entry of `SETTINGS_ISSUES` as a page; the rows for the top of Settings; the dot the row and the You tab carry |
| VisionStatusCard, visionEventTypeRows | — / settings, vm, t | Cameras and vision's two multi-field rows: what the camera is doing over its live frame, drawn on its own edge; and one switch per kind of event, the last one left on locked |

### Owner setup and first run (components/setup/)

The steps of `app/(onboarding)/owner-setup.tsx`, in Ink. A choice saved with its
step is an `InkCheckbox` in a `CheckRow`, not a switch: Ink's rule is that a switch
applies on flip. Birthdays are three `InkSelect`s and the zone is a searchable
`InkSheet` (`setup-fields.tsx`), because a calendar opens on this month and a
birth year is decades back. `ModelStep` appears only when the Pond refuses to finish
without a chat model. `ReadinessStatus` says whether the Pond can answer yet, for
Home's `PondGettingReady`. `WakeStep` takes its own draft, so the wake word screen
reached from Home uses it outside setup.

First run's pieces live here too. `NearbyPonds` lists new Ponds and opens a claim
under the picked row. `PhoneName` shows the name this phone pairs under, with Change.
`WifiList` is a Pond's own network list, with a join panel under the chosen row.
`claim-fields.tsx` has the two fields Ink's input cannot be: a code typed in
fixed-width digits, and a Wi-Fi password that is masked, never autocorrected, and
never saved by the phone. iOS still shows its Passwords key on any
masked field; nothing here asks it to save one.

### Patterns (components/patterns/)

Refreshing is a downward swipe on every screen of Pond content, never a button:
the screen's scrollable takes `refreshControl={<RefreshControl {...pull} />}`
with `pull = usePullToRefresh(reload)`, which also re-checks the connection when
the strip says the Pond is unreachable. A section with its own read inside
another component's scroll registers it with `useReloadOnPull`. See "Failure,
offline and empty" in [VIEW-LAYER.md](./VIEW-LAYER.md).

| Component | Props | Description |
|-----------|-------|-------------|
| ServerStatus | online, label | Whether the Pond is reachable, as a dot and a word |
| ConnectionStatus | — | The connection banner, and the app's only statement that the Pond cannot be used: an icon and a sentence, with Pair as its one button for an unpaired, outdated or revoked phone (`connectionActionIsPairing`). It carries no Try again: another attempt is the screen's pull to refresh (`usePullToRefresh`), and screen readers get it as the sentence's `activate` action. Silent until the saved pairing has loaded (`hydrated`), shows reconnecting only after 1.5 s (`RECONNECT_GRACE_MS`), and stays off first run, the pairing wizard and the scanner (`bannerHiddenOn`), which are the pairing it would offer |
| ContentUnavailable | state, reason?, onRetry, compact? | In place of content that did not arrive: a quiet waiting line while the banner is up, or a title, a sentence and the hint "Pull down to try again" when the read failed. No button in either; the hint's `activate` action calls `onRetry` for screen readers. Must sit inside the scrollable with the screen's `RefreshControl`. Chosen by `useContentState`; see "Failure, offline and empty" in [VIEW-LAYER.md](./VIEW-LAYER.md) |
| RemoteAccessOffer | — | Home's dismissible offer of remote access to a Pond paired without it |
| PondList | title, ponds, phase, onSelect | The Ponds on this network, shared by first run and Switch Pond; an unclaimed one is badged "Not set up" with its card id |
| PondGettingReady | — | Home's card for a Pond just set up, until Goose can answer; mounted only then, so Home reads no models otherwise |
| FinishSetup | — | Home's "Finish setting up" card: the wake word and a look over setup's defaults, on the phone that set the Pond up, until done or put away |
| ConversationWall | cards, loading, selecting, onOpen, … | The Chat tab's wall of conversation cards |
| ConversationCard | card, onOpen, onAskDelete, … | One conversation on the wall |
| ConversationList | sections, loading, header | The wall read as an index instead |
| WallDock, WallMenu, WallSelectionBar | — | The wall's search and compose, its view menu, and its selection actions |
| GreetingCard | name, prompts, onPick | The opening of a conversation that has not started |
| MessageRow | message, position, status | One turn of the conversation |
| Markdown | source | A reply's markdown in Ink's type: bold through `inkText`, emphasis as weight where a span cannot slant, code and tables scrolling sideways, only `http(s)` links opening |
| ToolTrail | tools, done | Under an answer: the cards its tools drew, the pages it read (web search, Wikipedia, Wolfram) as Sources, then a chip per step whose raw answer opens below the row |
| ThinkingQuips | status, seed | What shows before Goose has written anything |
| ChatDock | onSend, onVoice, onAttach | The composer: attach, the field, speak or send |
| AnsweringLight, AnsweringWash, AnsweringNote | light, field, radius / note | While Goose answers, in place of a spinner: a light behind the composer running along the field's top border, rimming the field and its buttons and washing faintly over them (`useAnsweringLight` drives both); and the can-make-mistakes reminder, fading 4 s after the answer is in, in a band under the composer that opens with it and closes once it has faded (`useAnsweringNote`, whose `room` the dock pads by) |
| AttachMenu | open, onClose, onChoose | Camera, Photos or Files, from the composer |
| VoiceDock | send, stop, onClose | Voice mode, in the composer's place |
| VoiceOrb | state, level, size, onPress, accessibilityLabel | The voice control, and the face Goose talks with |
| Goose | state, size, water | The Pond's bird, afloat |
| ChromePuck, ChromePill | icon / label, onPress | One control floating over content: opaque `chrome`, not the bar's glass |
| PondPicture | path, version, label, contentFit | A picture the Pond serves, read over the pinned transport and kept (`services/pond-images.ts`); a stand-in for one that was never kept or would not load |
| CameraFrameView | frame, state, sentence, camera | The pond camera's latest frame in a fixed 16:9 box with what the camera is doing as a badge, and a stand-in when there is none |
| VisionEventRow, VisionEventSheet | event, nameOf, onOpen / event, onAcknowledge, onCreateRule | One event as a flat row between hairlines, and in full: large picture, every measure, Acknowledge, and the automation form prefilled |
| FaceSheet | person, defaultThreshold, onChanged, onForget, onStrictness | One household member's face: samples at the pond's camera or from a photo, strictness, forget |
