# Jarida Design System — React Native Reference

All design tokens are in `constants/`. Import from individual files or the barrel `constants/theme.ts`.

## Colors

### Brand
| Token | Value | Usage |
|-------|-------|-------|
| `Brand.purple` | `#8C4BFF` | Brand mark only (logo, marketing) |
| `Brand.charcoal` | `#1C1C1C` | Primary text, headings |
| `Brand.white` | `#FFFFFF` | Backgrounds, text on brand |

### Accent (interactive)
As of issue #20, interactive/CTA colour is a separate token from the
`Brand`/`JaridaPurple` mark ramp above — aligned with `@jarida/ink`'s own
`tokens/color.ts`, where the mark (4.42:1) and the accent (5.47:1) are
deliberately different values.

| Token | Value | Usage |
|-------|-------|-------|
| `Accent.base` | `#7C3AED` | CTAs, active states, tint — fills and light-mode text/icon/border |
| `Accent.pressed` | `#6D28D9` | Pressed state |
| `Accent.soft` | `rgba(124, 58, 237, 0.11)` | Light-mode soft backgrounds |
| `Accent.softer` | `rgba(124, 58, 237, 0.06)` | Light-mode subtler backgrounds |
| `Accent.onDark` | `#B794FF` | Accent as **text, icon or border on a dark surface** (6.9:1) |
| `Accent.softDark` / `Accent.softerDark` | `rgba(124, 58, 237, 0.22 / 0.12)` | Dark-mode soft backgrounds |

`Accent.base` is a *fill* colour, tuned against white text sitting on top of
it — on a dark background it only measures 2.93:1, under the 3:1 UI floor. Use
`Accent.base` for fills in both themes; use `Accent.onDark` (not `Accent.base`)
for text, icons or borders drawn directly on a dark surface. See
`DarkColors.textBrand` / `iconActive` / `borderBrand` in `constants/colors.ts`.

### Purple Scale
`JaridaPurple` (unchanged) is the brand mark ramp — not used for interactive
elements; use `Accent` for those.
```
50:  #F4ECFF    Soft backgrounds, hover states
100: #E6D6FF    Light borders
200: #CFB0FF    Focus rings
300: #B386FF    Decorative
400: #9D63FF    Secondary active
500: #8C4BFF    Brand primary ★
600: #7636E6    Brand hover, text accent
700: #5D23C2    Deep accent, active text
800: #421593    Dark surfaces
900: #2A0C66    Darkest
```

### Neutrals (Grey)
```
50:  #FAFAFA    Screen backgrounds
100: #F5F5F5    Card backgrounds (secondary)
200: #EDEDED    Borders, dividers
300: #D9D9D9    Strong borders
400: #B5B5B5    Disabled, inactive icons
500: #8A8A8A    Tertiary text, tab inactive
600: #5F5F5F    Secondary text
700: #3D3D3D    Code text, strong labels
800: #262626    Dark surfaces
900: #1C1C1C    Charcoal (= Brand.charcoal)
```

### Semantic
| Token | Value | Usage |
|-------|-------|-------|
| `Semantic.success` | `#1F8A3C` | Online, connected, positive |
| `Semantic.warning` | `#C88A00` | Memory warnings, caution |
| `Semantic.danger` | `#C8383B` | Errors, destructive actions |
| `Semantic.info` | `#1C63D1` | Informational, ASR |

Each has a `Soft` variant for backgrounds (e.g., `Semantic.successSoft`).

## Typography

### Font Families
| Token | Value | Usage |
|-------|-------|-------|
| `FontFamily.display` | `Quicksand` | Hero text, large headings |
| `FontFamily.heading` | `Quicksand` | Section titles |
| `FontFamily.body` | `Quicksand` | Body text, labels, buttons |
| `FontFamily.bodyAlt` | `Comfortaa` | Alternative body (warm) |
| `FontFamily.mono` | `JetBrainsMono-Regular` | Code, model names, cron |

### Font Sizes
```
xs:   10    Badges, labels, metadata
sm:   12    Captions, secondary text
base: 14    Body text, button labels
md:   16    Section titles, card headings
lg:   18    Screen titles
xl:   20    Hero text
2xl:  24    Large display
```

### Font Weights
```
regular:  400
medium:   500
semibold: 600
bold:     700
```

## Spacing (4pt Grid)
```
xs:   4     Tight gaps
sm:   8     Default gap
md:   12    Comfortable padding
lg:   16    Section padding
xl:   20    Large spacing
2xl:  24    Section margins
3xl:  32    Screen-level padding
```

## Border Radii
```
xs:   4     Focus rings
sm:   6     Small buttons, inputs
md:   10    Cards, modals, main elements
lg:   14    Large cards
xl:   20    Rounded panels
2xl:  28    Hero elements
pill: 999   Chips, badges
```

## Shadows
```
xs:   Subtle lift (elevation 1)
sm:   Card default (elevation 2)
md:   Elevated card (elevation 4)
lg:   Modal/overlay (elevation 8)
brand: Purple glow (purple shadow)
```

## Role Colors
Used for model role assignment chips:
```
chat:  #7C3AED  (Accent.base — #20)
think: #F5A524  (amber)
task:  #17C964  (green)
asr:   #0072F5  (blue)
tts:   #F31260  (red)
```
