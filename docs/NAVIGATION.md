# Navigation Architecture — Goose On The Go v2

## Design Inspiration
- **Alexa**: Floating mic FAB, shortcut carousel, full-screen listening ring
- **Google Home**: Device grid with color-coded toggles, room groupings, "Ask" bar
- **Claude Mobile**: Clean threaded chat, conversation list, generous whitespace

## Bottom Tabs (4)

Floating glass pill bottom nav (iOS 26 "Liquid Glass" style):

| Tab | Screen | Icon | Purpose |
|-----|--------|------|---------|
| Home | Dashboard | home | Greeting, status, devices, shortcuts, recent |
| Chat | AI Chat | chat | Conversation with Goose AI |
| Devices | Device Grid | devices | Room-grouped smart home control |
| You | Profile Hub | profile | Settings, integrations, data |

## Sub-Screens (stack navigation from Profile hub)

| Screen | Route | Section |
|--------|-------|---------|
| AI Models | `/(stack)/models` | Goose |
| Memories | `/(stack)/memories` | Goose |
| Activity Logs | `/(stack)/logs` | Goose |
| Schedule | `/(stack)/schedule` | Goose |
| App Integrations | `/(stack)/app-management` | Integrations |
| MCP Servers | `/(stack)/mcp-servers` | Integrations |
| Users | `/(stack)/add-users` | Household |
| Biometrics | `/(stack)/biometrics` | Household |
| Home Management | `/(stack)/home-management` | Household |
| Privacy & Licenses | `/(stack)/privacy` | Data & Privacy |
| Pond Pairing | `/(stack)/pond-pairing` | Devices |
| Remote Access | `/(stack)/remote-access` | Profile footer, Home offer |

## Every route has to lead somewhere

expo-router resolves routes at runtime, so a menu row pointing at a deleted screen passes `tsc` and fails only when someone taps it, on an unmatched-route screen. `constants/__tests__/navigation.test.ts` holds three rules:

- every profile menu row in `constants/navigation.ts` reaches a screen file;
- every screen `app/(stack)/_layout.tsx` registers exists;
- every screen file in `app/(stack)` is registered.

The third is this app's rule, not expo-router's. The stack sets `headerShown: true`, and a screen the layout does not register gets its route name as its header. That is how Remote Access shipped headed `remote-access`, lowercase and untranslated, until the guard caught it. So a new screen needs its `<Stack.Screen name=... options={{ title: i18n.t('nav....') }} />` line, and removing a screen means removing its file, its registration and its menu row together.

Backup and Restore were removed rather than wired (#64): the Pond exposes no backup API, and a screen reporting a backup that never ran is worse than no screen.

## Special Overlays
- **Listening Overlay**: Full-screen dark overlay triggered by mic FAB or Ask bar
- **Mic FAB**: Floating purple button, bottom-right, visible on Home & Devices tabs

## Onboarding Flow
Welcome → What is Pond → Choose path (New/Restore) → Scan → WiFi → Name → Biometrics → Household → Done

## Pairing gate (2026-09-21)

Nothing in this app works without a paired Pond, so an app without one reaches
none of it: `app/(tabs)/_layout.tsx` redirects to `/(stack)/pond-pairing`
whenever no identity is stored. A fresh install and a phone that has just signed
out land in the same place.

The guard is keyed on the **stored identity**, not on the connection state, and
the distinction is load-bearing. `ConnectionManager.configure` publishes
`unpaired` at the start of every reconfiguration — including the one that enables
remote access — so a guard watching the connection throws the user onto pairing
in the middle of setting remote access up. It also waits for `hydrated`, or every
cold start bounces through pairing before discovering it is already paired.

Pairing leaves for Home the moment it succeeds, replacing rather than pushing, so
a finished wizard is not left in the stack. There is no success screen. The
remote access offer that used to follow it is a dismissible card on Home, shown
only to a Pond that is paired and reachable without remote access; declining is
remembered against the paired profile, so a phone that pairs afresh is asked
again.
