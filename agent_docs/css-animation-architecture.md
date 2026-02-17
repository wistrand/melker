# CSS & Animation Architecture

## Summary

- `@keyframes` + `animation` properties work like CSS — define named keyframes, apply with duration/easing/iteration
- Animated values are interpolated on the fly during layout, never written back to `props.style`
- Specificity follows CSS rules: inline > ID > class > type; `!important` supported
- Animations run via the shared `UIAnimationManager` timer

Melker's CSS-like style system: specificity, `@keyframes`, and `animation` properties.

## Core Principle: Never Write to `props.style`

Animated values are computed on the fly during each layout pass and **never persisted** to `props.style`. The animation state lives on the element; `_computeStyle()` overlays interpolated values at the end of the style merge chain.

This mirrors the **canvas `_terminalWidth`/`_terminalHeight` separation**:

| | Canvas | Animation |
|---|---|---|
| **Declarative** | `props.width` (`"100%"`, `"fill"`, `30`) | `props.style` (author + stylesheet cascade) |
| **Resolved** | `_terminalWidth` (numeric cells) | `_animationState` → interpolated in `_computeStyle()` |
| **Invariant** | Never written back to `props.width` | Never written back to `props.style` |
| **Why** | Prevents layout lock-in (image-never-shrinks) | Prevents `applyStylesheet()` diff from capturing animated values into `_inlineStyle` |

## File Map

| File | Purpose |
|------|---------|
| [`src/types.ts`](../src/types.ts) | `AnimationKeyframe`, `KeyframeDefinition`, `AnimationState` types; `_animationState`/`_animationRegistration` fields on Element; animation style properties |
| [`src/stylesheet.ts`](../src/stylesheet.ts) | `@keyframes` parsing, animation shorthand parsing, time units, lifecycle bootstrap/teardown in `applyStylesheet()` |
| [`src/easing.ts`](../src/easing.ts) | Timing functions: cubic bezier solver, `steps(N)`, standard CSS curves |
| [`src/css-animation.ts`](../src/css-animation.ts) | Interpolation engine: keyframe pair selection, value interpolation by type |
| [`src/layout.ts`](../src/layout.ts) | `_getAnimatedStyle()` computes current frame; injected into both `_computeStyle()` and `_computeLayoutProps()` |
| [`src/rendering.ts`](../src/rendering.ts) | Passes `computedStyle` through `ComponentRenderContext` so renderers can read animated layout properties |

## Data Flow

```
@keyframes parsed     applyStylesheet()     UIAnimationManager tick
    │                      │                        │
    ▼                      ▼                        ▼
KeyframeDefinition    AnimationState          requestRender()
(on Stylesheet)       (on Element)                  │
                                                    ▼
                                              layout pass
                                                    │
                          ┌─────────────────────────┤
                          ▼                         ▼
                   _computeStyle()          _computeLayoutProps()
                          │                         │
                          ▼                         ▼
                   _getAnimatedStyle()      _getAnimatedStyle()
                   (colors, text)           (width, height, padding, gap)
                          │                         │
                          ▼                         ▼
                   computedStyle              layoutProps
                   (render pipeline)          (flex algorithm)
```

## Types (`src/types.ts`)

```typescript
interface AnimationKeyframe {
  offset: number;        // 0.0 – 1.0
  style: Partial<Style>;
}

interface KeyframeDefinition {
  name: string;
  keyframes: AnimationKeyframe[];  // sorted by offset
}

interface AnimationState {
  name: string;
  keyframes: AnimationKeyframe[];
  duration: number;        // ms
  delay: number;           // ms
  iterations: number;      // Infinity for infinite
  direction: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  timingFn: (t: number) => number;
  fillMode: 'none' | 'forwards' | 'backwards' | 'both';
  startTime: number;       // performance.now()
  finished: boolean;
}
```

Style properties on `Style` interface:

| Property | Type | Notes |
|----------|------|-------|
| `animationName` | `string` | References `@keyframes` name |
| `animationDuration` | `number` | Milliseconds |
| `animationTimingFunction` | `string` | `linear`, `ease`, `ease-in-out`, `steps(N)` |
| `animationDelay` | `number` | Milliseconds |
| `animationIterationCount` | `number` | `Infinity` for infinite |
| `animationDirection` | enum | `normal`, `reverse`, `alternate`, `alternate-reverse` |
| `animationFillMode` | enum | `none`, `forwards`, `backwards`, `both` |
| `animation` | `string` | Shorthand |

Element fields: `_animationState?: AnimationState`, `_animationRegistration?: () => void`.

## CSS Parsing (`src/stylesheet.ts`)

### `@keyframes` blocks

Detected in `parseStyleBlock()` alongside existing `@media` handling. Inner blocks use `from`/`to` keywords or percentage selectors (`0%`, `50%`, `100%`). Each keyframe's style is parsed through `parseStyleProperties()` (inheriting box-spacing normalization, color parsing, etc.). Stored on the Stylesheet as `_keyframes: Map<string, KeyframeDefinition>`.

### Animation property parsing

Time values (`500ms`, `1s`, `0.5s`) are recognized for `animationDuration` and `animationDelay`. The `infinite` keyword maps to `Infinity` for `animationIterationCount`.

The `animation` shorthand is expanded by `parseAnimationShorthand()`:
```css
animation: fadeIn 2s ease-in-out 100ms infinite alternate forwards;
/*         name   dur timing     delay iter     dir       fill */
```

Tokens are identified by type: time values (contain `s`/`ms`), known timing functions, known direction/fill keywords, numbers (`infinite` or count), and the remainder is the animation name.

## Specificity (`src/stylesheet.ts`)

Selectors are ranked by CSS specificity. When multiple rules match the same element, higher-specificity rules win. Definition order is the tiebreaker for equal specificity.

### Computation

`selectorSpecificity(selector)` walks all segments and counts selector parts by type:

| Part type | Weight | Example |
|-----------|--------|---------|
| `id` | 1,000,000 | `#header` |
| `class` | 1,000 | `.primary` |
| `type` | 1 | `button` |
| `universal` | 0 | `*` |

Result: `ids * 1_000_000 + classes * 1_000 + types`. The wide spacing supports up to 999 of each category before overflow.

Examples:

| Selector | Specificity |
|----------|-------------|
| `button` | 1 |
| `.card` | 1,000 |
| `#header` | 1,000,000 |
| `button.primary` | 1,001 |
| `container .card text` | 2,001 |
| `#nav .item button` | 1,001,001 |

### Where it's applied

Specificity is **pre-computed at parse time** and stored on `StyleItem.specificity`. This happens at two creation sites:

1. `parseStyleBlock()` — when parsing CSS text into rules
2. `addRule()` — when adding rules programmatically

`getMatchingStyles()` collects all matching rules and sorts by specificity (stable sort, so definition order breaks ties). The sorted styles are then spread in order by `getMergedStyle()`, giving highest-specificity rules the final say.

### Style cascade order

The full priority order (lowest to highest):

1. Default style (theme colors, inherited text properties)
2. Type-specific defaults (component defaults)
3. Inherited parent style
4. Stylesheet rules — **sorted by specificity** (definition order as tiebreaker)
5. Inline style (`props.style`)
6. Pseudo-class styles (`:hover`, `:focus`) — see [css-pseudo-classes-transitions-architecture.md](css-pseudo-classes-transitions-architecture.md)
7. Container query styles (`_getContainerQueryStyles()`) — see [container-query-architecture.md](container-query-architecture.md)
8. CSS animation values (`_getAnimatedStyle()`)
9. CSS transition values (`getTransitionStyle()`) — highest priority, in-flight interpolation

Inline style always wins over all stylesheet rules regardless of specificity. Pseudo-class styles override inline for state-dependent styling. Container query styles override pseudo-class (context-dependent). Animation values overlay on top of container queries. Transition output is highest priority because it represents in-flight interpolation toward whatever the cascade produced — once a transition completes, its values are removed and the cascade's target value takes over naturally. See [css-pseudo-classes-transitions-architecture.md](css-pseudo-classes-transitions-architecture.md) for details.

## Easing Functions (`src/easing.ts`)

All functions map `t ∈ [0,1] → t' ∈ [0,1]`.

| Function | Implementation |
|----------|----------------|
| `linear` | Identity |
| `ease` | `cubic-bezier(0.25, 0.1, 0.25, 1.0)` |
| `ease-in` | `cubic-bezier(0.42, 0, 1.0, 1.0)` |
| `ease-out` | `cubic-bezier(0, 0, 0.58, 1.0)` |
| `ease-in-out` | `cubic-bezier(0.42, 0, 0.58, 1.0)` |
| `steps(N)` | Stepped (jump-end) |

Cubic bezier solver uses Newton-Raphson with bisection fallback (~45 lines). Standard curves are pre-built constants. Lookup via `getTimingFunction(name)`.

## Interpolation Engine (`src/css-animation.ts`)

### Value type detection

Each style property is interpolated based on its type:

| Category | Detection | Interpolation |
|----------|-----------|---------------|
| **Color** | Property in `COLOR_PROPS` set, both values numeric | RGBA component-wise lerp via `unpackRGBA`/`packRGBA` |
| **BoxSpacing** | Property in `BOX_SPACING_PROPS` (`padding`, `margin`) | Normalize both to `{top,right,bottom,left}`, lerp each component |
| **Percentage** | Both values are `"N%"` strings | Parse numeric parts, lerp, emit as `"N%"` string |
| **Numeric** | Property in `NUMERIC_PROPS` set, both values numeric | Linear lerp, round to integer |
| **Discrete** | Everything else | Snap at `t >= 0.5` |

Priority order matters — a `padding` value could be a number (uniform) or an object (BoxSpacing). The BoxSpacing check runs before the numeric check.

### Percentage string preservation

When both keyframe values are percentage strings (e.g. `"20%"` → `"80%"`), interpolation stays in the percentage domain. This preserves responsive semantics — the layout engine resolves `%` against parent size each frame. Mixed types (percentage vs number) fall through to discrete snap.

### Keyframe pair selection

`findKeyframePair(keyframes, progress)` finds the two bracketing keyframes for a normalized progress `t ∈ [0,1]` and computes the local interpolation factor between them. Supports multi-stop keyframes (e.g. 0% → 49% → 50% → 100% for step-like effects).

## Layout Integration (`src/layout.ts`)

### `_getAnimatedStyle(element)`

Reads `element._animationState`, computes progress from `performance.now() - startTime`, applies direction logic (reverse, alternate), timing function, and calls `interpolateStyles()`. Returns `{}` if no active animation.

Handles the full animation lifecycle per-frame:
- **Delay period**: Returns `{}` (or first/last keyframe for `fill-mode: backwards/both`)
- **Active**: Interpolates between bracketing keyframes
- **Finished (finite)**: Sets `anim.finished = true`, returns final keyframe (for `fill-mode: forwards/both`) or `{}`

### Two injection points

Animated values must be injected into **both** style paths:

1. **`_computeStyle()`** — rendering properties (colors, text decoration, border color):
   ```typescript
   const mergedStyle = {
     ...defaultStyle,
     ...typeDefaults,
     ...inheritableParentStyle,
     ...(element.props && element.props.style),
     ...this._getContainerQueryStyles(element, context),  // container queries
     ...this._getAnimatedStyle(element),                   // last wins
   };
   ```

2. **`_computeLayoutProps()`** — layout properties (width, height, padding, gap, margin):
   ```typescript
   const baseStyle = (element.props && element.props.style) || {};
   const containerStyles = this._getContainerQueryStyles(element, context);
   const animStyle = this._getAnimatedStyle(element);
   const style = { ...baseStyle, ...containerStyles, ...animStyle };
   ```

This dual-path injection is necessary because the layout engine has two independent merge chains — see [layout-engine-notes.md](layout-engine-notes.md) for background on `_computeStyle()` vs `_computeLayoutProps()`.

### Percentage main-axis resolution

The flex basis calculation resolves percentage strings against available main-axis space:
```typescript
} else if (typeof childProps.width === 'string' && childProps.width.endsWith('%')) {
  flexBasisValue = Math.floor(mainAxisSize * parseFloat(childProps.width) / 100);
}
```
This applies to both row (percentage width) and column (percentage height) directions.

### Caching

No extra cache needed. `_computeStyle()` and `_computeLayoutProps()` use per-frame caches (`_styleCache`, `_layoutPropsCache`) cleared at the start of each layout pass. Animation progress advances naturally because each frame re-computes from `performance.now()`.

## Lifecycle (`src/stylesheet.ts`)

### Bootstrap

In `applyStylesheet()`, after the style cascade resolves, the animation lifecycle runs:

1. Read `resolvedStyle.animationName`
2. If name exists, look up `KeyframeDefinition` from stylesheet's `_keyframes` map
3. If found and element has no animation (or different name): create `AnimationState`, register tick with `UIAnimationManager`
4. If **same** name already running: do nothing (prevents restart on resize/re-apply)

### Tick callback

The UIAnimationManager tick does only one thing: `manager.requestRender()`. No style writes, no interpolation. Actual interpolation happens lazily in `_getAnimatedStyle()` during the next layout pass. This matches the spinner pattern (tick requests render, computation happens in render).

### Teardown

| Event | Action |
|-------|--------|
| Animation finishes (finite, no fill-mode) | `stopElementAnimation()`: unregister from UIAnimationManager, clear `_animationState` |
| `animation-name` changes | Stop old, start new |
| `animation: none` or property removed | `stopElementAnimation()` |
| Element removed from tree | `stopElementAnimation()` |

### Render-side integration

`ComponentRenderContext` carries `computedStyle` so that component render methods can read animated layout properties (padding, margin) from the computed style rather than `props.style`. This is necessary because `props.style` doesn't contain animated values (by design).

## Supported Animated Properties

| Category | Properties |
|----------|-----------|
| **Color** | `color`, `backgroundColor`, `borderColor`, `borderTopColor`, `borderBottomColor`, `borderLeftColor`, `borderRightColor`, `dividerColor`, `connectorColor`, `ledColorLow`, `ledColorHigh` |
| **Size** | `width`, `height`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight` |
| **Spacing** | `padding`, `paddingTop/Right/Bottom/Left`, `margin`, `marginTop/Right/Bottom/Left`, `gap` |
| **Position** | `top`, `right`, `bottom`, `left` |
| **Flex** | `flexGrow`, `flexShrink` |
| **Other numeric** | `zIndex`, `barWidth`, `ledWidth`, `cellWidth`, `cellHeight`, `minPaneSize` |
| **Discrete** | `border`, `fontWeight`, `fontStyle`, `textDecoration`, `flexDirection`, `display`, `overflow` |

## Limitations

- **Single animation per element**: CSS supports `animation: a 1s, b 2s` (comma-separated). Only the first animation is applied.
- **No `cubic-bezier()` in CSS**: The `cubic-bezier(x1,y1,x2,y2)` function isn't parsed from CSS text. Use named presets (`ease`, `ease-in-out`, etc.) or `steps(N)`.
- **Mixed-unit interpolation**: Animating between `"50%"` and `30` (number) snaps discretely at 50%. Both values must be the same type for smooth interpolation.

## Example

```css
@keyframes pulse {
  0%   { border-color: #333333; }
  50%  { border-color: #3388ff; }
  100% { border-color: #333333; }
}

.alert-box {
  animation: pulse 2s ease-in-out infinite;
  border: thin;
  padding: 0 1;
}

@keyframes slide {
  from { left: 0; }
  to   { left: 30; }
}

.slider {
  position: relative;
  animation: slide 2s ease-in-out infinite alternate;
}
```

See [`examples/basics/animation.melker`](../examples/basics/animation.melker) for a comprehensive demo covering color, size, percentage, padding, gap, border color, position: relative, and nested container animations.

## Related Docs

- [css-variables-architecture.md](css-variables-architecture.md) — CSS custom properties (`var()` works in `@keyframes` and `animation` shorthands)
- [css-pseudo-classes-transitions-architecture.md](css-pseudo-classes-transitions-architecture.md) — `:focus`, `:hover`, CSS transitions
- [architecture-media-queries.md](architecture-media-queries.md) — `@media` queries
