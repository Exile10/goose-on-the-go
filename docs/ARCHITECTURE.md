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

## Navigation

Uses Expo Router v6 with file-based routing:

- **`(tabs)/`** — Bottom tab navigator (5 tabs: Dashboard, Chat, Canvas, Devices, More)
- **`(stack)/`** — Stack navigator (8 screens: Memory, Skills, Models, Logs, Schedules, Prompts, Settings, Agent)
- **`modal.tsx`** — Modal presentation route

See [NAVIGATION.md](./NAVIGATION.md) for detailed rationale.

## Component Library

Primitives come from **`@jarida/ink/native`** (`InkButton`, `InkInput`, `InkSwitch`, `InkProvider`, etc. — issue #17). Two in-house primitives remain in `components/ui/`, re-exported from its barrel: `GIcon` (pending the icon-registry work in #19) and `GKeyboardView` (no ink equivalent).

- **`components/ui/`** — The two surviving in-house primitives (`GIcon`, `GKeyboardView`)
- **`components/patterns/`** — Composite components (ChatBubble, ServerStatus, etc.), composed from ink primitives
- **`components/layout/`** — Screen wrappers (ScreenScrollView, ScreenFlatList)

See [COMPONENT-GUIDE.md](./COMPONENT-GUIDE.md) for how to add/modify components.

## Developer Mode

`app/(stack)/developer.tsx`, reached from the You tab's "Developer" section, is a
dev-only screen (`if (!__DEV__) return <Redirect .../>`) that lets each
migratable screen be flipped independently between its mock data and the real
`PondApiClient` (issue #21). `MIGRATION_SCREENS` and `isScreenReal`/`setScreenMode`
live on `ServerProvider` (`providers/server-provider.tsx`); mock and real code
paths coexist per screen, so nothing needs to be deleted to test either one.
It also has a "Pond server URL" field and a Test connection button that probes
`/health`. The screen isn't linked from the You-tab menu in production builds.

## Performance

- All styles use `StyleSheet.create()`
- List items use `React.memo()`
- Lists use `FlatList` (virtualized), never `ScrollView` + `.map()`
- Animations use `react-native-reanimated` (UI thread)
- React Compiler is enabled (`reactCompiler: true` in app.json)
