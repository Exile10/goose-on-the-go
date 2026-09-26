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

## Sub-Screens (15 — stack navigation from Profile hub)

| Screen | Route | Section |
|--------|-------|---------|
| AI Models | `/(stack)/models` | Goose |
| Memories | `/(stack)/memories` | Goose |
| Activity Logs | `/(stack)/logs` | Goose |
| Schedule | `/(stack)/schedule` | Goose |
| App Integrations | `/(stack)/app-management` | Integrations |
| MCP Servers | `/(stack)/mcp-servers` | Integrations |
| Photos & Videos | `/(stack)/user-media` | Media & Data |
| Photo Upload | `/(stack)/photo-upload` | Media & Data |
| Users | `/(stack)/add-users` | Household |
| Biometrics | `/(stack)/biometrics` | Household |
| Home Management | `/(stack)/home-management` | Household |
| Backup | `/(stack)/backup` | Data & Privacy |
| Restore to Pond | `/(stack)/restore` | Data & Privacy |
| Privacy & Licenses | `/(stack)/privacy` | Data & Privacy |
| Pond Pairing | `/(stack)/pond-pairing` | Devices |

## Special Overlays
- **Listening Overlay**: Full-screen dark overlay triggered by mic FAB or Ask bar
- **Mic FAB**: Floating purple button, bottom-right, visible on Home & Devices tabs

## Onboarding Flow
Welcome → What is Pond → Choose path (New/Restore) → Scan → WiFi → Name → Biometrics → Household → Done
