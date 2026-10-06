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

The hub is `PROFILE_NAV` in `constants/navigation.ts`, rendered by the You tab.
Its labels are `TranslationKey`s under `screens.*` and `nav.*`, never text.

| Screen | Route | Hub group |
|--------|-------|-----------|
| Models | `/(stack)/models` | Goose |
| Memories | `/(stack)/memories` | Goose |
| Conversations | `/(stack)/sessions` | Goose |
| Activity | `/(stack)/logs` | Goose |
| Schedule | `/(stack)/schedule` | Goose |
| Connected apps | `/(stack)/app-management` | Integrations |
| MCP servers | `/(stack)/mcp-servers` | Integrations |
| People | `/(stack)/add-users` | Household |
| Your home | `/(stack)/home-management` | Household |
| Remote access | `/(stack)/remote-access` | Data and privacy; also the Home offer |
| Privacy and licenses | `/(stack)/privacy` | Data and privacy |
| Developer mode | `/(stack)/developer` | Developer (dev builds only, #21) |

Conversations is the rename-and-delete list of what the Pond holds. The Chat
tab's wall is the way into a conversation; this is the way to tidy them, and it
opens a row in `app/conversation.tsx` like the wall does.

Four more stack screens aren't in the hub:

- **Pond Pairing** (`/(stack)/pond-pairing`) — from the pairing gate below, first
  run, Switch Pond, Your home and the connection banner.
- **Switch Pond** (`/(stack)/switch-pond`) — from Home's Pond card; the Ponds on
  this network, the one in use marked.
- **Add a device** (`/(stack)/commission-device`) — from the Devices tab and Home.
- **Connect Desktop** (`/(stack)/connect-desktop`) — the QR scanner opened from
  Pond Pairing. It has no header at all; the viewfinder carries its own dismiss.

Every other stack screen gets its header, and its back control, from
`app/(stack)/_layout.tsx`: these screens are pushed through the root stack, so
the nested navigator has one entry in its own history and would draw no back
button of its own. The header reads `useTheme()` directly, because a navigator
header is the one surface `useThemedStyles` cannot reach.

## Every route has to lead somewhere

expo-router resolves routes at runtime, so a menu row pointing at a deleted screen passes `tsc` and fails only when someone taps it, on an unmatched-route screen. `constants/__tests__/navigation.test.ts` holds three rules:

- every profile menu row in `constants/navigation.ts` reaches a screen file;
- every screen `app/(stack)/_layout.tsx` registers exists;
- every screen file in `app/(stack)` is registered.

The third is this app's rule, not expo-router's. The stack sets `headerShown: true`, and a screen the layout does not register gets its route name as its header. That is how Remote Access shipped headed `remote-access`, lowercase and untranslated, until the guard caught it. So a new screen needs its `<Stack.Screen name="..." options={{ title: t('screens....') }} />` line, and removing a screen means removing its file, its registration and its menu row together.

Backup and Restore were removed rather than wired (#64): the Pond exposes no backup API, and a screen reporting a backup that never ran is worse than no screen. Biometrics went for the same reason: it showed face recognition as enrolled from a hardcoded state and "enrolled" voice recognition on a two-second timer, with no call to the Pond -- which has no voice biometrics at all. Photos and Videos and Upload for Analysis went too: they showed analyses of household photos that never ran, and the Pond exposes no image analysis. Their hub group, Media and data, went with them rather than stay as an empty heading.

## Voice

There is no separate listening overlay. Voice mode belongs to the conversation:
the composer's speak control swaps `ChatDock` for `VoiceDock`, in the same place,
and the orb in it is `VoiceOrb`.

## First run

Welcome (`app/(onboarding)/welcome.tsx`) → Pond Pairing → Home. The welcome
screen is the network scan itself: the Ponds it finds hand off to pairing with
that address, and "set up later" goes to the tabs, where the gate below sends an
unpaired phone to pairing instead. There is no restore path, because there is no
backup to restore from.

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
