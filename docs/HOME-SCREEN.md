# Home — carrying the Pond's ideas, and reading denser

Status: **proposal**, written 2026-10-31, and built in #214. Two constraints below were wrong
when first written and are corrected in place: today's counts need no change to the Developer
toggle, and the fixed starters do not belong on Home.

The question it answers: can Home carry the ideas the Pond already composes, and say more per
screenful, without the household learning anything new and without a new dependency.

The short answer is that almost none of this needs new phone capability. The Pond composes four
kinds of idea today, and Home shows none of them — they sit one or two taps away, behind the You
tab. What Home needs is to surface them and to stop spending a whole row on two facts.

Verify before you reuse any of this: grep the symbol, the line numbers below will drift.

## 1. What is true today

### The screen

[`app/(tabs)/index.tsx`](<../app/(tabs)/index.tsx>) draws, in order:

1. The greeting and the avatar.
2. A badge row: devices online, outdoor temperature. Two facts at most, and the whole row is
   hidden while the Pond is unreachable.
3. `PondCard` — whether the Pond can be reached.
4. Four conditional offers: `PondGettingReady`, `AgentsGettingReady`, `FinishSetup`,
   `RemoteAccessOffer`.
5. **Right now** — `NowPlayingCard` and `NextRoutineCard`, and the heading is drawn only when at
   least one of them is true.
6. **Conversations** — three rows (`RECENT_LIMIT` in
   [`use-recent-sessions.ts`](../view-models/use-recent-sessions.ts)), one line each, and See all.
7. **Devices** — a grid capped at `HOME_GRID_LIMIT = 4`, and See all.

The screen's own rule, in its doc comment, is the right one: *a card with nothing true to say is
not drawn*. It is also why Home thins out. On an evening with nothing playing and no routine due,
section 5 vanishes entirely and Home is a greeting, two chips, a status card, three lines of
conversation and four tiles. Nothing is broken. There is simply far less on screen than the Pond
knows, and the quiet case is the common one.

### The Pond already composes ideas, and Home shows none of them

| What | View-model | Where it shows today |
| --- | --- | --- |
| Proposals, each awaiting a yes or no | [`use-proposals.ts`](../view-models/use-proposals.ts) | `/(stack)/suggestions`, via `PROFILE_NAV` |
| Prompts worth asking | [`use-suggestions.ts`](../view-models/use-suggestions.ts) | `conversation.tsx`, and `greeting-card.tsx` which only conversation uses |
| Reminders lifted out of conversations | [`use-reminders.ts`](../view-models/use-reminders.ts) | `/(stack)/reminders`, via `PROFILE_NAV` |
| How much happened today | [`use-activity-summary.ts`](../view-models/use-activity-summary.ts) | the strip above the Activity list |

**Proposals** are the closest thing to what was asked for, and the app already calls them
"suggestions" to the reader — the Pond's word is "proposal". A `ProposalRow` carries a `summary`,
a `rationale` kept in its own field *so that showing the summary alone cannot pass for the reason*,
and a formatted `expires`. `actions.decide(id, 'approve' | 'reject')` settles one. Approving runs
nothing: `ProposalDecisionResult.executed` is always false, so a yes stages work rather than
firing it — which is what makes a yes safe to offer on Home.

**Ask-prompts** are a different thing that needs no decision: `OfferedPrompt` is
`{ id, prompt, composed }`, the Pond composes them from its memories while idle, and it answers up
to four. When it has none, or cannot be reached, the rule the desktop set and this app follows is
to keep the fixed starters on screen — a row of chips that empties reads as broken.

**Reminders** are final once dismissed; the Pond has no route that brings one back, which is why
their screen asks first.

**Today's counts** are `ActivitySummary` — `{ window, since, total, by_category }` over
`EventCategory` (`agent`, `tool`, `inference`, `sensor`, `camera`, `device`, `auth`, `network`,
`system`).

## 2. The design

Order on screen, with what each part does when it has nothing to say.

### (a) Greeting — unchanged

### (b) A glance strip, in place of the two chips

Three or four figures across one row, each a number and its noun: devices on, the temperature with
its location, what the household asked today. A figure the Pond has not answered for is left out
rather than shown as a dash; the strip hides only when every figure is missing.

This is where the density actually comes from. The current row can carry two facts and often
carries one.

### (c) Pond card and the setup offers — unchanged

They are about whether the app works at all, and they already draw nothing once they are satisfied.

### (d) Ideas from your Pond — the new section

At most **two** proposal cards, each the summary, the rationale beneath it, and two buttons:
**Yes** and **Not now**, deciding in place exactly as `/(stack)/suggestions` does. A count beside
the heading, and See all into that screen when there are more.

Under them, a wrapped row of ask-chips. Tapping one opens `/conversation` with the prompt as the
first message, and tells the Pond it was taken so it stops offering it.

When there are no proposals, the section is the chips alone, under a quieter heading. When there
are neither, the section is not drawn — the existing rule, unchanged.

Pending reminders appear here as a single line, not as cards: *3 reminders waiting*, leading to
their screen. Dismissal stays where it asks first.

### (e) Right now — unchanged

### (f) Conversations — a second line

Each row gains the last thing said, one line, under the title. Three rows of two lines carry
considerably more than three rows of one, and it is already fetched.

### (g) Devices — a fuller grid

Raise `HOME_GRID_LIMIT` from 4 to 6, and let the last tile be a +N that leads to the tab. Four
tiles on a modern phone leaves most of a row empty.

## 3. The constraints that decide the work

These are the things that will cost a day each if they are met at the end rather than the start.

1. **Ask-prompts need a session id, and Home has no conversation.** `useSuggestions(sessionId)`
   takes one because the id decides whose data the Pond may read. Home must not borrow a real one:
   the Pond binds an unattributed session to the device's member on read, so reusing a session
   from the list would quietly claim somebody else's conversation. `use-proposals` already solved
   this — `sessionLabel()` mints `gotg-suggestions-<32 hex>`, which satisfies the not-blank rule
   and names no session. Home does the same, once per visit, and never reuses a real id.

2. **Today's counts need no change.** `useActivitySummary` gates its source on
   `isScreenReal('logs')`, which reads like a Developer-only surface and is not one: `logs` is in
   `REAL_BY_DEFAULT`, and `resolveScreenReal` returns the default in any build where `__DEV__` is
   false. A household already reads the real Pond. The hook can be used as it stands; only a dev
   build with the toggle flipped to mock shows `SAMPLE_SUMMARY`, which is what that toggle is for.

3. **There is no forecast route, and this is the one item that cannot be built from the phone.**
   `GET /api/v1/weather` answers `{ enabled, temp, location_name }` — a current temperature and
   nothing else. The `WeatherForecast` type in [`models/weather-card.ts`](../models/weather-card.ts)
   is parsed by `tool-card.tsx` out of a `get_weather_forecast` **chat tool result**, so a forecast
   reaches the phone only when the assistant calls that tool inside a conversation. Home cannot ask
   for one. Until the Pond grows a forecast route, the honest version of (b) is the temperature
   with its location name; a high and low is a Pond-side change, and it is separable from
   everything else here.

4. **The fixed starters do not belong on Home.** `useSuggestions` keeps them on screen when the
   Pond has none, which is right in a conversation about to be started: a row of chips that
   empties reads as broken. On Home it would mean the same three chips every day under "Ideas
   from your Pond", and the section could never be absent. Home shows only prompts carrying a
   Pond id.

5. **Dismissal is final**, so Home links to reminders rather than dismissing them inline.

6. **Strings carried as data are `TranslationKey`, not `string`**, and `t()` is never called at
   module scope — a constant is evaluated at import, before i18next has a language, and freezes
   there. New keys go under `home.*`, beside the greetings and the section headings.

7. **The bottom bar reserves its own strip.** Home already clears it with
   `paddingBottom: useBottomBarInset()`. A new section must not reintroduce a hardcoded spacer.

8. **`InkCard` already has a face and a plate.** A proposal card's own style carries layout only.

9. **A read that failed is not an empty list.** Home already distinguishes them — today with an
   `InkNotice tone="danger"` against an `InkEmptyState`, and with the `ContentUnavailable` pattern
   once #196 lands. The new section follows whichever is current: a failed read of proposals must
   not read as "no ideas".

## 4. What it costs

On the phone: one new section component, a view-model that wraps `useProposals` and
`useSuggestions` for Home's own session label, the strip, the conversation second line, the grid
cap, their strings and their tests. No new dependency.

On the Pond: a forecast route, if a high and low is wanted. Nothing else.

## 5. What this should not become

- **Not a feed.** Two proposals on Home, the rest behind See all. The point is that the good one is
  seen without hunting, not that Home becomes the list.
- **Not auto-approved.** A yes stages work and the Pond runs nothing by itself; that property is
  what makes the inline button acceptable, and it should stay true.
- **Not polled hard.** Proposals move on the Pond's own slow schedule. They belong on the existing
  pull-to-refresh and the screen's focus, not on a timer.
- **Not a replacement for the Suggestions screen.** Home is a glance; that screen is the record.
