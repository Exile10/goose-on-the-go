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
