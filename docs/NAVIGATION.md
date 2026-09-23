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

## Sub-Screens (16 — stack navigation from Profile hub)

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
| Developer Mode | `/(stack)/developer` | Developer (dev builds only, #21) |

Two more stack screens aren't in the hub: **Add Device** (`/(stack)/commission-device`, from the Devices tab) and **Connect Desktop** (`/(stack)/connect-desktop`, the QR scanner opened from Pond Pairing).

## Special Overlays
- **Listening Overlay**: Full-screen dark overlay triggered by mic FAB or Ask bar
- **Mic FAB**: Floating purple button, bottom-right, visible on Home & Devices tabs

## Onboarding Flow
Welcome → What is Pond → Choose path (New/Restore) → Scan → WiFi → Name → Biometrics → Household → Done
