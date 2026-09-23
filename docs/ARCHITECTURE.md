# Architecture — MVVM

Goose on The Go follows the **Model-View-ViewModel** pattern adapted for React Native with hooks.

## Layer Overview

```
┌─────────────────────────────────────┐
│          Views (Screens)            │
│  app/(tabs)/*.tsx  app/(stack)/*.tsx │
├─────────────────────────────────────┤
│        ViewModels (Hooks)           │
│        view-models/use-*.ts         │
├─────────────────────────────────────┤
│     Models (Types + Services)       │
│   models/*.ts   services/*.ts       │
└─────────────────────────────────────┘
```

### Views
Screen components in `app/` that import a single ViewModel hook. Views are **pure rendering** — they destructure `{ data, actions }` from the hook and render UI. No business logic, no direct API calls.

```tsx
export default function MemoryScreen() {
  const { data, actions } = useMemory();
  return (
    <FlatList
      data={data.items}
      renderItem={({ item }) => (
        <MemoryItem {...item} onDelete={() => actions.remove(item.id)} />
      )}
    />
  );
}
```

### ViewModels
Custom hooks in `view-models/` that own all state and side effects. Every ViewModel returns:

```ts
{
  data: T;           // The screen's data
  loading: boolean;  // Loading state
  error: string | null;
  actions: {...};    // Callbacks the view can invoke
}
```

### Models
TypeScript interfaces in `models/` defining the domain shapes. These are pure types — no logic. Mock data is co-located with its type file (e.g., `LLM_MODELS` in `models/model.ts`).

### Services
`services/api-client.ts` — the HTTP client for pond-server, and the only place in
the app that calls `fetch`. It attaches the bearer token, refreshes once on 401
(sharing a single refresh across concurrent 401s), and throws a typed `ApiError`
carrying the status and any `Retry-After`. Wire types live in
`services/types.ts`, in the server's own snake_case — deliberately separate from
the display-shaped types in `models/`.
`services/storage.ts` — typed AsyncStorage wrapper.
`services/discovery.ts` — finds Ponds over mDNS, so step 0 of the pairing wizard
can offer a hub rather than ask for its address. See "Finding the Pond" below.

## Finding the Pond

pond-server advertises `_pond._tcp.local.`; `services/discovery.ts` browses for
it through `react-native-zeroconf`, and `view-models/use-discovery.ts` turns that
into the `{data, loading, error, actions}` shape the wizard renders.

Three things about this are load-bearing and easy to undo by accident.

**Only numeric addresses are kept.** A resolved service carries both a `host`
(`<name>.local`) and `addresses` (numeric). Android's resolver does no mDNS at
all, so the `.local` name is unreachable there however it arrives — typed,
scanned from the pairing QR, or discovered. A service that resolves without a
numeric address is therefore dropped rather than shown.

**The list dedupes on address and port, not on name.** mDNS records outlive the
process that registered them, so a restarted server leaves ghosts advertising
the same endpoint under incrementing instance names. Keying on the endpoint means
a restart replaces its own entry.

**A discovered Pond is probed with `/health` before the wizard advances**, for
the same reason: an advertisement is not a running server, and a ghost resolves
perfectly and answers nothing.

The search ends on a clock (8 s), because mDNS has no "that is all" signal, and
browsing continues past the deadline so a hub switched on later still appears.
The deadline only changes what the screen says. Stopping the browse is not
optional — it holds a multicast lock on Android for as long as it runs.

Discovery is the default, not the only way in: multicast is filtered on plenty
of guest and office networks, so scanning the QR and typing an address both
remain on the same step.

`types/react-native-zeroconf.d.ts` declares the library's browsing API, which
ships no types of its own. Field names there are taken from its Android NSD
implementation, which is the default backend.

## Providers

Two React context providers wrap the app:

- **ThemeProvider** (`providers/theme-provider.tsx`) — Jarida color tokens resolved for light/dark mode. Access via `useTheme()`.
- **ServerProvider** (`providers/server-provider.tsx`) — Server connection state. Access via `useServer()`.

## Presence: telling the Pond this phone is still here

The Pond does not store whether a device is online. It derives `is_online` at read time from `last_seen` against a **five-minute** threshold, so a paired phone has to keep refreshing its own row, or it ages out and reports itself offline in its own device list while in use. `ServerProvider` does that with `POST /api/v1/devices/{id}/heartbeat`, where `{id}` is the install id sent as `client_id` at pairing. The Pond keys the device row on exactly that id.

| Rule | Why |
|---|---|
| Every **2 minutes** (`HEARTBEAT_MS`) | Inside the five-minute threshold with room for one dropped beat, and about 30 requests an hour against the Pond's per-IP budget. |
| First beat once the **connection manager has reached the Pond** | The paired identity loads before the base URL resolves. A beat sent then goes to the client's default address and is lost, which on a cold start left the card offline until the interval came round. |
| Stops only in a **known background** state | Backgrounding a React Native app suspends its networking, so claiming reachability then would be false. On an Android cold start AppState can still read `'unknown'`, and the app is on screen. |
| A missed beat is **dropped, not retried**, and logged | The next one is already scheduled, and a retry loop against a rate-limited Pond is the failure the interval avoids. It is logged because a beat that always fails looks exactly like one that never fires. |

The conditions live in `services/heartbeat.ts` (`canBeat`) and are unit tested there; the provider only wires them to its state. The cold-start behaviour was verified on a device, starting from a row that had aged out: the card read online 38 seconds after launch, before the interval could fire.

The desktop app has the same problem and the same fix, on the Pond side (goose-in-a-pond#388).

## Navigation

Uses Expo Router v6 with file-based routing:

- **`(tabs)/`** — Bottom tab navigator (5 tabs: Dashboard, Chat, Canvas, Devices, More)
- **`(stack)/`** — Stack navigator (8 screens: Memory, Skills, Models, Logs, Schedules, Prompts, Settings, Agent)
- **`modal.tsx`** — Modal presentation route

See [NAVIGATION.md](./NAVIGATION.md) for detailed rationale.

## Component Library

All UI components are in-house — no external UI library.

- **`components/ui/`** — Primitive components (GButton, GCard, GChip, etc.)
- **`components/patterns/`** — Composite components (ChatBubble, DeviceCard, etc.)
- **`components/layout/`** — Screen wrappers (ScreenScrollView, ScreenFlatList)

See [COMPONENT-GUIDE.md](./COMPONENT-GUIDE.md) for how to add/modify components.

## Performance

- All styles use `StyleSheet.create()`
- List items use `React.memo()`
- Lists use `FlatList` (virtualized), never `ScrollView` + `.map()`
- Animations use `react-native-reanimated` (UI thread)
- React Compiler is enabled (`reactCompiler: true` in app.json)
