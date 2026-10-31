# The view layer

Conventions the screens share. `docs/DESIGN-SYSTEM.md` has the tokens; this has
the four systems a screen touches every time it is written.

## Colour scheme

`ThemeProvider` is the only thing that resolves the scheme. It owns a stored
`preference` (`system` | `light` | `dark`), consults the system only when that
is `system`, and hands the result to React Navigation and to Ink. People choose
the preference on the Appearance page (the `theme` row in
`components/settings/settings-page.tsx`), the only caller of `setPreference`.

Nothing else may call `useColorScheme()`. Two resolvers is how a theme starts
flipping on its own — the app and the library disagree about who won, and the
loser re-renders.

```tsx
const { colors, isDark, preference, setPreference } = useTheme();
```

On Android, React Native hears of a system light/dark change only through
`MainActivity.onConfigurationChanged`. A change made while the process lives
on without an activity — swiped from Recents while `PondNetworkService` holds
it — reaches nothing, and the next activity starts in a scheme the JS side
never learns of. `plugins/with-appearance-resync.js` makes `MainActivity`
forward its configuration on every resume, which re-syncs it; keep that plugin
when touching the activity.

A screen never hardcodes a surface or text colour. `StyleSheet.create` runs once
at module load, so a sheet that has to follow the scheme is built through
`useThemedStyles`:

```tsx
const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.background },
    label: { color: c.text },
  });

export default function Screen() {
  const styles = useThemedStyles(makeStyles);
}
```

Define the factory at module scope. Passing an inline arrow rebuilds the sheet
every render. Every component in a file that reads `styles` calls the hook —
including memoised sub-components, which are components and may hold hooks.

Brand colours (`JaridaPurple`, `Accent`, `Semantic`) are not themed. They are
the same value on both grounds by design; only surfaces and text flip.

## Icons

`constants/icons.ts` maps a name to a lucide glyph, and that map is the whole
vocabulary. `GIcon` draws it and Ink resolves its `icon=` slots from the same
map, so a name that works in one works in the other.

```tsx
<GIcon name="server" size={18} />
<InkButton icon="refresh">Refresh</InkButton>
```

`ICONS` carries no type annotation on purpose. Annotating it
`Record<string, …>` collapses `IconName` to `string`, and every wrong name then
compiles and renders nothing — which is how `devices` (the key is `device`) and
`x` shipped invisible. Leave it inferred and a typo is a compile error.

On React Native, Ink draws nothing until something is registered:
`components/ui/ink-icons.ts` does that once, imported for its side effect in the
root layout. Ink's own eighteen built-ins resolve on the web only, where there
is an `<svg>` to draw into.

## Text

Every user-facing string comes from `services/i18n/locales/en.json` through
`useTranslation`. The catalogue is typed, so `t('home.devicez')` does not
compile.

```tsx
const { t } = useTranslation();
<InkTitle level={3}>{t('home.devices')}</InkTitle>
```

`en` is the source language and the fallback, so an untranslated key reads as
English rather than as `home.devices`. The catalogue is bundled, not fetched: a
phone that cannot reach its Pond still has to render its own UI.

**A key carried as data is a `TranslationKey`, not a `string`.** `t()` checks a
literal at the call site; a key stored in a constant loses that check, and a
typo then ships as a rendered key. `TranslationKey` is derived from `en.json`
itself, so the union is never out of date. `constants/navigation.ts` and
`pond-pairing.tsx`'s step list both carry keys this way.

**Never call `t()` at module scope.** A module constant is evaluated at import,
before i18next has a language, so the value freezes at whatever the build
shipped with. `STEP_LABELS` in the pairing flow was written that way; it is
`STEP_KEYS` now, resolved at render.

### Writing

Sentence case, not Title Case. An action is named for what it does — "Back up
now", not "Backup Now" — and keeps that name through the flow, so the button
that says "Add a device" opens a screen titled "Add a device".

Name things the way a household would. The Activity screen's filters read
"Actions", "Tools", "System", "Problems" rather than the `action | mcp | system
| error` enum behind them, and the pairing flow says "your Pond" where it used
to say "the GIAP host". A raw enum rendered into the UI is a bug, not a label:
`{tab.charAt(0).toUpperCase() + tab.slice(1)}` is how "mcp" shipped as "Mcp".

No ALL CAPS section labels. A heading is `InkTitle level={3}`, and a heading
that only repeats the screen's own title is deleted rather than styled.

## Haptics

`services/haptics.ts` names feedback by what happened, never by waveform.

| Call | For |
| --- | --- |
| `selectionTick()` | Moving between tabs, filters, segments |
| `tap()` | An ordinary button |
| `toggle()` | A switch or a slider detent |
| `confirm()` | Something completed |
| `caution()` | Attention needed, nothing lost |
| `reject()` | The action failed |

Call sites say what happened; this file decides how it feels. Naming the intent
is what stops one impact style drifting across three unrelated gestures. Every
call is fire-and-forget and swallows its own failure — absent on web, on the
simulator, and on a device whose motor is off, none of which is a caller's
problem.

## Navigation chrome

The bottom bar is Ink's `InkBottomBar`, driven from expo-router's navigation
state in `app/(tabs)/_layout.tsx`. It is positioned *over* the screens rather
than beside them. React Navigation renders a custom `tabBar` as a flex sibling
in a column, so left alone it reserves its own strip and content stops above it
— and a bar that reserves a strip cannot leave one, because removing it reflows
the list under a moving thumb. Out of flow it can go, and lists clear it with
`paddingBottom: useBottomBarInset()`, the bar's measured height rather than a
number somebody guessed.

Both bars need `style={{ alignSelf: 'stretch' }}`. Ink's shell is
`alignSelf: "flex-end"` with a width that is `undefined` until its first layout
lands, so an unstyled bar hugs its own content on the right — the navbar puts
its title beside the actions, and the bottom bar packs its destinations into a
corner. `style` is spread after the shell, so it wins.

### The bar leaving

`providers/chrome-provider.tsx` owns the stage. A list spreads
`useChromeScroll()` onto itself, its offset goes through Ink's
`NavbarBehaviour`, and the bar reads the stage back down. The decision is
entirely Ink's `nextStage`: pure, hysteretic, and with the scroll-up reveal
checked *before* any threshold, so 8px of upward movement returns the bar
wherever the reader is. Two contexts rather than one — `report` never changes
and `stage` changes twice a gesture, and together in one value they would
re-render every list on every change.

The last stage is Ink's: the bar contracts to a single control carrying the
current destination's glyph, and pressing it restores the bar rather than
navigating. Ink 1.0.0 needed a local patch for two things in `InkBottomBar`
(a third, the blur slot, is under *The bar's glass*); 1.1.0 carries all three, so
the patch is gone. The puck answered its own press with local state
(`setPushed`) that nothing ever cleared, so `collapse` worked exactly once —
press it and the bar was pinned open for the life of the app. Ink now clears
that push when the stage changes, and takes an `onExpand` so a host can own the
decision instead. The app passes `onExpand={restore}`, because the component
cannot see a scroll that leaves the stage unchanged: a reader who pressed and
carried on scrolling down would otherwise hold a bar that never contracted
again.

Two departures from the web binding, both the bottom edge rather than taste:

- **`material="always"`.** The scroll edge — nothing until content has passed
  under the bar — is a *top* bar's rule. At the bottom it inverts: an offset of
  zero means the bar is over the first screenful, so `auto` spends the whole
  scroll drawing labels straight onto cards.
- **`collapseAt: 120`.** 220 is a page's number. A phone's whole viewport is
  about 870 points, so a quarter of the screen would pass before the bar moved.

`alignSelf` carries two placements. Before Ink's first layout the bar has to
stretch or it measures its own content and the destinations bunch into a
corner; after it, the width is Ink's animated one and `flex-end` is what makes
the bar contract towards the right rather than the left.

### The bar's glass

The bar is glass in both schemes: a real blur, a light tint of `surface` over
it, and a hairline in `lineStrong`. This is what #18 asked for, and the
conversation-wall rebuild had replaced it with an opaque `chrome` fill.

- **The blur.** Ink's native `InkBottomBar` drew only a tint; 1.1.0 adds a
  `blurComponent` slot, the same one `InkNavbar` has, and draws the blur behind
  the bar's content so the padding, the morph and the puck are unchanged. The
  app passes `TabBarBlur`, a function wrapping expo-blur's `BlurView`: a class
  component's props would have to match the slot's exactly, and `BlurView`
  takes more tints than the `light` and `dark` Ink passes.
- **Reduce Transparency.** With it on, the bar skips the blur and fills
  with Ink's `glass.solid`, as the navbar does. The app needs no second path.
- **How clear it is.** Ink's blur intensity (60), with the tint lowered to
  `TINT_ALPHA` (0.3) in `app/(tabs)/_layout.tsx`. Ink derives about 0.50 light
  and 0.64 dark, the least opacity that keeps the labels at 4.5:1 over any
  backdrop *with no blur at all*. #18 asked for Ink's derived tint; the app
  goes clearer than that by choice and leans on the blur for legibility. Raise
  `TINT_ALPHA` if labels struggle over busy content.
- **The hairline.** The tint is `surface`, the colour the cards are made of, so
  on its own it cannot tell the bar from a card passing under it. In light the
  lift does that; on a dark ground a shadow is nothing. The edge is what says
  the bar is a plane, in both schemes. The web glass draws the same hairline;
  the native binding does not.

`accentLine` is blanked through an `InkProvider` scoped to the bar. Ink draws a
dash over the selected destination and exposes no way to turn it off; inside the
bar that token draws nothing else, and selection is already carried by the icon
and label going from tertiary to full contrast.

The bar contracts sideways rather than leaving, so it holds the same strip at
every stage and nothing anchored above it has to move. Chat does clamp its
*title* bar to `condensed` — Ink's navbar shrinks its body at
`collapsed` whether or not it may draw the puck that gets it back, so sharing
the stage outright leaves an empty stub where the screen name was.

A screen reader pins the bar expanded, through the state machine's own
`configure({ enabled: false })`. Reading by swiping through elements is not
scrolling to a place, and a bar that leaves on scroll is a bar VoiceOver cannot
find.

### The stack header is not a screen

`app/(stack)/_layout.tsx` draws the header for all eighteen sub-screens, and a
navigator header is the one surface `useThemedStyles` cannot reach. It reads
`useTheme()` directly. It also carries its own `headerLeft`: these screens are
pushed from the tab group through the *root* stack, so the nested navigator has
one entry in its own history and suppresses the system back button. Without that
control every one of them is a dead end reachable only by the edge-swipe
gesture, which is invisible and which some people have turned off.

Screen titles come from `t('screens.*')`, and `constants/navigation.ts` carries
`TranslationKey`s rather than text — a module constant is evaluated at import,
before i18next has a language, so a literal there freezes at build time.

## The wall

`app/(tabs)/chat/index.tsx` renders; `use-chat-history.ts` fetches. It is
pond-desktop's `ChatHistory` brought to a phone, and the parts a reader could
compare are deliberately the same, so a conversation does not look long on one
and short on the other:

- **A card is as tall as its conversation was long.** `cardWeight` buckets by
  message count and preview length into three row spans, the desktop's own
  thresholds. `placeOnWall` puts each card in the shorter column, leftmost on a
  tie, which is what the desktop's grid auto-placement does and why the wall
  still reads newest-first from the top. Two plain columns would put the newest
  half down the left.
- **Nothing is measured.** Heights follow from weights, so every frame is known
  before it draws — which is also what lets `conversation-wall.tsx` mount only
  the cards near the viewport.
- **The cards are the only loud thing.** They wear the edge, on `InkEdge` at
  radius `xl` rather than `InkCard`, whose radius is fixed at `lg`. The three
  pucks over them (`chrome-puck.tsx`) are opaque `chrome` with a `lineStrong`
  hairline and Ink's lift. They stay solid while the bar is glass, on purpose:
  a puck is one small glyph, and at that size glass over a card buys little
  and costs the glyph its contrast. A tint of `surface` alone would separate it
  from nothing (see *The bar's glass*).
- **The filter is the one distinction the Pond draws.** `isRoutine` copies
  pond-core's `POND_AUTHORED_SESSION_PREFIXES`: `sched-` sessions are ones the
  Pond opened itself, for a schedule or a rule. They share the list with
  everything else, and nothing else in the list is worth a facet.
- **`title` and `preview` arrive as JSON `null`**, whatever `services/types.ts`
  says, and `preview` is Goose's first reply rather than the opening question.
  `message_count` counts tool rows too, so it runs ahead of the bubbles.
- **A row the Pond says is empty is not drawn** (`isEmpty`). The scheduler
  opens a session before each run, and a run that stores nothing leaves the row
  behind; on a Pond with schedules running, those were most of the first screen.
  Only an explicit `0` counts, so a server that sends no count loses nothing.

Search is on the device, every word in any order across title and preview.
`GET /api/v1/sessions` has no paging and no search, and the Pond runs several
queries per session to build it, so the view-model answers a mount and a focus
landing on the same frame with one request.

The corner puck opens `wall-menu.tsx`: the layout, the filter, then Select
below a hairline. A layout or a filter applies as it is chosen. The puck's dot
marks a filter only, since a filter hides conversations and a layout hides
none.

**The list is the quiet index** (`conversation-list.tsx`). The same cards as
flat rows between hairlines — no edge, because a list with every row raised has
nothing raised — in a `SectionList` under sticky headings: Today, Yesterday,
Previous 7 days, Previous 30 days, then calendar months, with the year once it
is not this one (`sectionByRecency`). The headings and the "when" labels count
days with one function, `calendarDaysBetween`, so a row that says Yesterday is
never filed under Today, and "Previous 7 days" is exactly the stretch in which
the labels name a weekday. The layout is kept on the device
(`chatHistoryView`), and the loading ghosts stay up until it has been read, so
the list does not open as a wall for a frame.

**Choosing several flattens the wall.** Every card drops to a hairline and a
chosen one rises onto its plate — "state is elevation", on the thing being
chosen — while a circle in each corner, the platform's mark for the mode, says
a tap will choose rather than open. A row has no plate, so a chosen one takes
`accentSofter` instead. Done takes the puck's corner and a bar in the dock's
material takes the dock's place; its Delete asks in place, as a card does. The
Pond has no bulk delete, so `removeMany` sends one DELETE per conversation,
three at a time (`settleEach`), and re-reads the wall once they have all
settled. Leaving the screen clears the selection.

## The conversation

`app/conversation.tsx` renders; `use-chat.ts` fetches; `use-voice.ts` runs
voice mode. What is worth knowing:

- **Every turn streams, through `/chat/stream`.** `/chat` answers whole and
  silently drops `images` and `voice_mode`. The stream is SSE (`id:` and `data:`
  lines, a `:` keep-alive every 15s); `services/sse.ts` parses it off Expo's
  fetch, whose body is a real `ReadableStream`. `applyFrame` folds each frame
  into the reply and is pure, so a turn can be replayed in a test. Two frames
  carry no `type`: `{error}` and `{done: true}`.
- **Turns are resumable.** A turn tied to its connection is cancelled when the
  phone locks, and its question is deleted from the history. `resumable: true`
  keeps it running; after a drop `use-chat.ts` reattaches from the last `id:`
  it saw, and after a 404 or 410 reads the saved turn back instead. The Pond
  holds four streams at most, so a stream the screen stops watching is
  aborted, never left open.
- **Tools are folded, not listed.** In history a turn is `user`, a `tool` row
  per result — whose `content` is a JSON blob around the result — and one
  `assistant` row holding every call. `fromHistory` matches results to calls.
  A live `tool_result` may carry a card hint (`ui.card_type`: weather, devices,
  time, knowledge, wolfram, memory) that `tool-card.tsx` draws. Both weather
  tools send `weather`: a current reading (`temperature`, `condition`, ...) or
  a forecast (`location` plus a `forecast` array, a row per day, a week at
  most before it counts the rest). `models/weather-card.ts` tells them apart
  by shape; a payload with nothing to draw stays the tool's chip rather than
  an empty card. The Pond strips the hint before saving, so the phone keeps
  each card it is shown (`services/card-cache.ts`, by conversation and call
  id) and `fromHistory`
  puts it back on reopen. A turn this phone never streamed has no card to
  restore and shows its result chip. Kept cards go with their conversation,
  and all of them on sign-out. Friendly names are pond-desktop's, kept in
  `constants/tools.ts`, because the Pond has none of its own.
- **A long task is followed where it started.** The assistant can start one
  with `giap-tasks__task_start`, and it runs later, outside the turn. Its
  answer reads "Started task <id>", and the chat draws `long-task-card.tsx`
  there in place of the chip. The card shows the goal, the state in the
  Pond's own words, each step with its agent and summary, and the result
  with Read the result. It also has Stop, behind a confirmation, because a
  stopped task cannot be carried on.
  - It reads `GET /long-tasks/{id}` every 5 s while the task plans or runs,
    and every 30 s while it waits for a decision or is paused.
  - It never reads an ended task again. Ended tasks and their result bodies
    are kept in memory (`services/long-task-cache.ts`) until sign-out, so
    reopening the conversation asks nothing.
  - On mock chat, a message that says "long task" starts one in the mock
    Pond (`models/long-tasks-mock.ts`). The mock works them one at a time,
    as the Pond does, so a second one waits its turn.
  - The Pond works long tasks one at a time, in the order they were asked
    for, and each task's `queue` says where an open one waits. A task behind
    others reads "Waiting its turn: 2nd in line" and says who is ahead,
    without naming another member's task (`long-task-queue.tsx`).
  - When some of the member's own tasks are ahead, the card lists them and
    this one, each with Keep going or Stop, all kept going until changed.
    One Stop button stops exactly the picked tasks, then reads this task
    again. A 409 counts as stopped, and a task that could not be stopped
    stays picked, so trying again is one press.
  - Nothing shows at the front of the line, once the task has ended, or
    from an older Pond that sends no `queue`.
  - A finished task whose `answer` is `short` shows its `answer_text` whole,
    as chat Markdown, in place of the result line and Read the result: a
    short answer is read in the conversation, not opened as a report. Any
    other task, or an older Pond's, keeps the line and the button.
- **A long task's report is read on its own page** (`/(stack)/task-report`).
  - It is the whole report from `GET /long-tasks/{id}/report`, cut at its
    headings so a row of section chips can jump between them.
  - A Pond without the route shows the result artifact instead, with
    nothing to share.
  - Share fetches `/export` with the bearer token, writes it to the cache
    under the Pond's file name, and opens the share sheet. It offers a
    document, a web page, and "Add to calendar" only when the plan has
    dated events.
  - The reply renderer shows any HTML the model wrote as text, links only
    web addresses (a map link opens where the phone opens maps), and shows
    a picture's description instead of fetching it.
- **Deep research starts from the plus menu.**
  - Whether it is offered comes from `GET /long-tasks/deep-research`, asked
    once per dock and per Pond (`use-deep-research.ts`).
  - The Pond's answer decides the row. A 404 or "off" leaves it out.
    "unidentified" shows it greyed, with one line saying why.
  - Choosing it puts a removable "Deep research" chip over the field. The
    next message goes with `deep_research: true`, then the mode ends; it
    also ends if the conversation changes.
  - Under the chip, "How much to write" offers Pond decides, Short answer
    and Full report, with the pick's hint below. Short and report go as
    `deep_research_answer`; Pond decides leaves the field out, so the Pond
    reads it from the question. The pick outlasts the message and the
    conversation while the composer is mounted.
  - Research takes a question on its own, so the picture sources wait while
    it is on, and it cannot be chosen with pictures waiting.
  - The Pond answers with the same `task_start` frames a model call makes,
    so the long-task card follows it, named "Deep research".
- **The title bar names the conversation.** It shows the title the wall or
  Home passed with the link, and the Pond's own after every reply. A new
  conversation shows, from its first question, the title the Pond will store
  for it after that turn — the first six words, sixty characters at most
  (`derivedTitle`, mirroring pond-core's `derive_title_from_text`) — so the bar
  does not change when the Pond's arrives. The Pond's idle re-titling job can
  rename it later; the next reply or reopen picks that up. Nothing asked yet
  means no title.
- **Goose's replies are not bubbles.** A person's message is Ink's bubble;
  Goose's answer is the page's text, as pond-desktop sets it.
- **Until the first words arrive**, `ThinkingQuips` shows what the Pond says it
  is doing over a rotating quip, in the reply's own place; nothing around the
  thread glows or moves. Reduced motion holds the quip still.
- **Writing never waits for the answer.** The composer stays live while a reply
  streams; what is sent meanwhile queues (`view-models/turn-queue.ts`) and is
  drawn at the foot of the thread as Ink's bubble in its sending state, marked
  Queued, with a way to take it back — pond-desktop's treatment. Each goes when
  the turn ahead of it settles, however it settles, and keeps its id, so its row
  stays put. A queued message keeps its own pictures. Stop and New conversation
  drop the queue; leaving the screen does not, and the queue finishes in the
  background.
- **A turn can outlast its answer.** The Pond may take another model pass after
  the words appear — the agent re-engaging a turn it counted as empty, or the
  answer review when `review_mode` allows it — and sends `done` only after. On a
  local model one pass is tens of seconds. Until `done`, a small spinner stays
  under the answer, with the Pond's `status` or `review_status` beside it when it
  sends one, so a queued message waiting on the turn does not look stuck.
- **Pictures are re-encoded before they are sent** (`services/media.ts`): JPEG,
  1024px long edge, the desktop's rule, because the Pond takes four pictures of
  4 MiB each and a phone photo is a 12-megapixel HEIC. Text files travel inside
  the message. The picker modules load lazily, so a build without them fails
  one button rather than the launch.
- **A picker waits for the attach menu to close.** The menu is a `Modal`; a
  picker launched while it is still animating out is presented on the menu's
  view controller, and iOS dismisses it with the menu. The Files browser
  opened and vanished, and the request it left unanswered made every later
  pick fail until the app restarted. `attach-menu.tsx` holds the choice until
  `onDismiss` (with a 500ms backstop) and only then calls `onChoose`. A picker
  that will not open says so (`pickerFailed`) rather than blaming a picture.
- **Voice mode records PCM, not a file.** The Pond transcribes WAV only and
  Android's recorder cannot write one, so `use-voice.ts` takes a PCM stream,
  detects the end of speech from its loudness, and writes the WAV itself
  (`services/speech.ts`). Replies are spoken a sentence at a time through
  `/tts`, the next one synthesised while the last plays.
- **Stopping the microphone never throws.** When voice mode closes,
  expo-audio's own cleanup releases the stream before `use-voice.ts` stops it,
  and stopping a released stream throws: `ERR_USING_RELEASED_SHARED_OBJECT` on
  Android, `ERR_NATIVE_SHARED_OBJECT_NOT_FOUND` on iOS.
  Thrown during unmount that ends the app: on 2026-10-05, tapping the keyboard
  icon in voice mode closed it. `stopStream` in `services/voice-io.ts` treats
  a released stream as stopped and reports any other failure without throwing.

The root stack draws no header for it (`headerShown: false` in
`app/_layout.tsx`); the screen draws Ink's navbar, which carries its own way
back to the wall.

## Failure, offline and empty

Every screen whose content comes from the Pond is in one of five states, chosen
by `contentState` in `models/content-state.ts` (`useContentState` reads the
connection for it). Each state has one owner, and nothing says a thing twice.

| State | When | Who says it |
|---|---|---|
| `ready` | There is content, from this read or an earlier one | The screen. A later read that fails keeps it on screen and is logged |
| `loading` | Nothing yet, a read in flight | The screen's spinner or ghosts |
| `unreachable` | Nothing to show, and the connection indicator is up | The indicator says why. The screen shows `ContentUnavailable` in its waiting form: no cause, no button |
| `failed` | Nothing to show, the connection is fine, the read failed | `ContentUnavailable`: a title, one sentence, and "Pull down to try again" |
| `empty` | The read worked and found nothing | The screen's own `InkEmptyState`, never styled as a failure |

**Connectivity is said once**, by `ConnectionStatus` at the top of the app. It
is quiet -- a hairline strip on the secondary surface, an icon and a sentence --
and it is not a retry button. Its only control is Pair, where only pairing can
help (`connectionActionIsPairing`). It has no "Checking" state of its own: a
pull's spinner shows the attempt, and the attempt turns the strip to
"Reconnecting" once it outlasts the grace period. Screens do not add their own
"your Pond is unreachable" notice. Home's Pond card, which is a status card,
drops its reachability title and badge while the indicator is up.

**Trying again is a pull, everywhere.** Every screen of Pond content carries a
`RefreshControl` fed by `usePullToRefresh(reload)`
(`view-models/use-pull-to-refresh.ts`), and no screen holds a `refreshing` flag
of its own. A pull first asks the connection manager to look for the Pond when
the strip is up for a reason another attempt can help (not for an unpaired,
outdated or revoked phone, where a token-less probe would report success and
change nothing), then runs the screen's `reload`. The spinner stays until both
settle; a second pull meanwhile is ignored; a reload that throws is logged
(`[pull-to-refresh] refresh failed kind=...`) and the spinner still goes. A
screen with several reads passes one `reload` that makes them all (Home reads
recent conversations and devices). A section that reads its own content inside
a scroll another component owns -- the Schedules and Automations tabs, the
camera status card and the voice list on a settings page, the account row on
the You tab -- registers its read with `useReloadOnPull`, and the screen wraps
it in `PullSectionsProvider` with the registry from `usePullSections`, so the
pull reaches it. No screen adds a Refresh or Try again button beside the pull;
Devices' header Refresh went for that reason.

A screen reader cannot easily pull to refresh, so both places that used to
carry Try again keep it as an accessibility action instead: the strip's
sentence (while another attempt can help) and the failed form's hint each have
an `activate` action labelled Try again. TalkBack and VoiceOver read them as
actionable, and a double tap runs the same retry. A sighted tap does nothing.

**`ContentUnavailable`** (`components/patterns/content-unavailable.tsx`) goes
in place of the content, never above it, and always inside the scrollable that
carries the screen's `RefreshControl` -- a `ListEmptyComponent`, or a child of
the `ScrollView` -- or the hint under it promises a pull there is nothing to
pull. Where it is the whole screen, put it in a `ScrollView` whose
`contentContainerStyle` has `flexGrow: 1` so it can centre and still be pulled
(the wake word screen does this). It takes the view-model's sentence as
`reason` when that sentence says something specific (busy, a feature the Pond
is too old for), and the shared one otherwise. When the connection comes back
it reads again by itself, and keeps its waiting form until that read settles,
so nobody sees "did not load" for content already on its way. `compact` fits it
into one section of a longer screen.

**A view-model reports a failed read as a flag** (`failed`, or `readFailed` in
a store), never by whether it has a sentence for it. `describeApiError` returns
null for a request that got no answer, so a screen that took "no error text" to
mean "loaded" drew a failure as an empty list -- which is how Devices said "No
devices yet" with the Pond down.

**A failed action** -- a save, a delete -- is not a failed screen. A view-model
keeps `error` and `failed` for its reads only; what an action came to is said
as "Feedback for actions" below has it. Never `Alert.alert`, which draws the
platform's dialog in the platform's theme rather than the app's.

**Technical detail is for the log.** A status code, a route or an exception's
text never reaches a reader. `describeApiError` turns a failure into words or
into nothing (when the indicator already covers it), and `logFailure` writes the
engineer's half: `[scope] what kind=http_500`.

## Feedback for actions

What a tap came to -- saved, started, refused -- is not a fact about the page,
so it does not become a box in the page that stays there. Four homes, chosen by
what the sentence is about:

| The sentence is about | Where it goes |
|---|---|
| An action the user just took that worked: saved, run started, deleted, download started | The snackbar, neutral |
| An action the user just took that failed: a switch the Pond refused, a delete, a run | The snackbar, danger, with Try again when sending the same request again is meaningful and cheap |
| A field, or a form still open | Inline, beside the field or the form's button, so the typed values and the reason stay together |
| A standing condition: a feature off or unavailable, a setup state, a warning about what an option does, a page that did not load | Inline (`InkNotice`, or `ContentUnavailable` for content) |

The app's own dialog (`useConfirm` / `useInform`) is for a question before an
action, or a failure the user must read before going on; a screen that chose a
dialog keeps it.

**The snackbar** is `providers/snackbar-provider.tsx`, mounted once inside
`InkProvider`. A component asks with `useSnackbar().show(...)`; a view-model or
a module-level store calls `showSnackbar(...)` from `services/snackbar.ts`
directly, since a store cannot call a hook.

    show({ message, tone?: 'neutral' | 'danger', action?: { label, onPress } })

It follows Material 3's snackbar and the HIG. One at a time: a new message
replaces the one showing. It goes by itself after about 4 s (longer for a long
sentence, by Ink's `readingTime`), at least 8 s when it carries an action, and
not at all while a screen reader is on and it carries an action. A tap or the
screen reader's escape puts it away. It is announced once
(`announceForAccessibility`), sits above the safe area, the tab bar (which
reports its height with `useSnackbarClearance` while it is in front) and the
keyboard, and appears without a slide under Reduce Motion. An inverse surface
for neutral, the danger fill for danger; no border, no icon. The message is
one short sentence from the catalogue: a status code or a route belongs to
`logFailure` and `console.warn`, which every failure site still writes.

Try again calls the action as it is now, not the closure the failure was
caught in: a hook keeps a ref to its current action, set in an effect, and the
snackbar's `onPress` reads the ref. (A hook cannot name its own `useCallback`
inside it; the React lint rejects that.)

**One limit:** the snackbar draws under a `Modal`, so anything said while an
`InkSheet` stays open stays in the sheet (the face sheet's samples, the event
sheet's "automation added"). A sheet that closes on success can use the
snackbar, because the sheet is gone by the time it shows.

## Shared surfaces

`components/patterns/pond-list.tsx` draws the Ponds on the network. First run and
switching Pond both use it, with `currentUrl` marking the active one, so the two
lists cannot drift into different shapes.

`components/patterns/chat-dock.tsx` and `voice-dock.tsx` belong to the
conversation alone today. They are patterns rather than screen-local views
because each is a whole composer, and the screen swaps one for the other.

## Do not redecorate Ink

`InkCard` draws a face and a plate. Giving it a `backgroundColor`, a
`borderWidth` and a `borderRadius` as well does not restyle the card — it paints
a second card behind the first, and the plate reads as a thick coloured slab.
The Devices grid shipped that way on twenty-two cards at once. A card's own
style should carry layout only: width, gap, padding.
