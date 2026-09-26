# Component Guide

How to add, modify, and remove components in the Goose on The Go UI library.

## Component Types

| Type | Location | Naming | Purpose |
|------|----------|--------|---------|
| **Primitive** | `@jarida/ink/native` | `Ink*` (InkButton, InkSwitch) | Basic building blocks. No business logic. Two in-house exceptions live in `components/ui/`: `GIcon` and `GKeyboardView` — see below. |
| **Pattern** | `components/patterns/` | descriptive (chat-bubble, role-chip) | Composed from ink primitives. Domain-aware. |
| **Layout** | `components/layout/` | descriptive (screen-scroll-view) | Screen wrappers and containers. |

As of issue #17, in-house primitives (the old `GButton`/`GCard`/`GChip`/etc.
`g-*.tsx` family) were replaced by `@jarida/ink/native`. Before adding a new
primitive, check whether ink already has it — most basic building blocks
should come from there, imported directly (e.g. `import { InkButton } from
'@jarida/ink/native'`).

## Adding a New In-House Primitive (exception case only)

Only add a component to `components/ui/` if ink has no equivalent — as with
`GKeyboardView` — or it's a stopgap pending upstream ink work — as with `GIcon`
pending #19.

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

3. **Use StyleSheet.create()** for all styles — no inline objects.

4. **Import tokens** from individual constant files:
   ```tsx
   import { Accent, Grey } from '@/constants/colors';
   import { FontFamily, FontSize } from '@/constants/typography';
   import { Spacing } from '@/constants/spacing';
   import { Radii } from '@/constants/radii';
   ```

5. **Add haptic feedback** for pressable components:
   ```tsx
   import { useHaptics } from '@/hooks/use-haptics';
   const haptics = useHaptics();
   // In onPress: haptics.light();
   ```

6. **Wrap with React.memo** if it's a leaf/list component:
   ```tsx
   export const GAvatar = React.memo(function GAvatar(props: GAvatarProps) { ... });
   ```

7. **Export from barrel** in `components/ui/index.ts`:
   ```tsx
   export { GAvatar } from './g-avatar';
   ```

## Adding a New Pattern Component

1. **Create the file** in `components/patterns/`:
   ```
   components/patterns/notification-card.tsx
   ```

2. **Compose from ink primitives**, plus `GIcon`/`GKeyboardView` from `@/components/ui` where needed:
   ```tsx
   import { InkButton, InkSwitch } from '@jarida/ink/native';
   import { GIcon } from '@/components/ui';
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
   - Stack: add to `app/(stack)/_layout.tsx`
6. **Add navigation entry** in `constants/navigation.ts` if it should appear in the More hub.

## Existing Components

### Primitives (@jarida/ink/native)
Imported directly from the library — not re-exported through `components/ui/`.
See ink's own docs for full prop lists; only the primitives actually in use
here are listed.

| Component | Description |
|-----------|-------------|
| InkButton | Primary action button — 3 variants (GButton's old secondary/ghost/bordered variants collapsed into ink's `quiet`; `size` prop is gone) |
| InkInput | Text input |
| InkSwitch | Toggle switch |
| InkProvider | Wraps the app (see `app/_layout.tsx`) |

### Primitives — in-house exceptions (components/ui/)
| Component | Props | Description |
|-----------|-------|-------------|
| GIcon | name, size, color, fill | SVG icon from IconPaths registry — pending ink's icon registry (#19) |
| GKeyboardView | — | Keyboard-avoiding view — no ink equivalent |
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

### Patterns (components/patterns/)
| Component | Props | Description |
|-----------|-------|-------------|
| PageHeader | title, action | Screen title bar |
| MetricCard | label, value, trend | Dashboard stat |
| QuickAction | label, onPress | Dashboard action row |
| ServerStatus | online, label | Connection indicator |
| RoleChip | role, model, color | Model assignment badge |
| ChatBubble | role, content, loading | Chat message |
| ChatComposer | onSend, placeholder | Message input |
| MoreMenuItem | label, onPress | More hub nav item |
| MemoryItem | text, date, onDelete | Memory list row |
| VoiceOrb | state, onPress | Voice mode button |
| VuMeter | level, active | Audio level bars |
