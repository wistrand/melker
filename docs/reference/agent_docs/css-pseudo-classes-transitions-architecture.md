# Pseudo-Classes & Transitions Architecture

## Summary

- `:focus` and `:hover` pseudo-classes enable declarative styling based on element state
- `transition` property animates changes smoothly (e.g. `transition: background-color 300ms ease`)
- Hover tracking uses mouse position from `TextSelectionHandler`; focus state from `FocusManager`
- Transitions interpolate between old and new computed values using the animation timer

CSS `:focus`/`:hover` pseudo-class selectors and `transition` property support for smooth interactive styling.

## Overview

Pseudo-classes enable declarative styling based on element state (focused, hovered). Transitions animate property changes over time when those states change, producing smooth visual effects instead of instant snaps.

```css
button {
  background-color: gray;
  transition: background-color 800ms ease;
}
button:hover {
  background-color: blue;
}
```

## File Map

| File                                                  | Purpose                                                                                    |
|-------------------------------------------------------|--------------------------------------------------------------------------------------------|
| [`src/stylesheet.ts`](../src/stylesheet.ts)           | Selector parsing (`:focus`/`:hover`), `hasPseudoClassRules` flag, `getPseudoMatchingStyles()`, `parseTransitionShorthand()` |
| [`src/layout-style.ts`](../src/layout-style.ts)       | `getPseudoClassStyles()`, `processTransitions()`, `getStyleValue()` BoxSpacing decomposition, merge in `computeStyle()` and `computeLayoutProps()` |
| [`src/css-animation.ts`](../src/css-animation.ts)     | `getTransitionStyle()` interpolation, `interpolateValue()` (shared with `@keyframes`)      |
| [`src/types.ts`](../src/types.ts)                     | `TransitionSpec`, `PropertyTransition`, `TransitionState`, `PseudoClassState` types; `_transitionState`/`_transitionRegistration` on Element |
| [`src/easing.ts`](../src/easing.ts)                   | Timing functions reused by transitions (same as `@keyframes`)                              |
| [`src/ui-animation-manager.ts`](../src/ui-animation-manager.ts) | 60fps tick registration for in-flight transitions                                |
| [`src/events.ts`](../src/events.ts)                   | `transitionend` event type                                                                 |
| [`src/focus.ts`](../src/focus.ts)                     | `FocusManager._focusedElementId` — source of `:focus` state                               |
| [`src/text-selection-handler.ts`](../src/text-selection-handler.ts) | `_hoveredElementId` — source of `:hover` state                           |

## Pseudo-Classes

### Supported Pseudo-Classes

| Pseudo-class | Matches when                         | State source                    |
|--------------|--------------------------------------|---------------------------------|
| `:focus`     | `focusedElementId === element.id`    | `FocusManager._focusedElementId`|
| `:hover`     | `hoveredElementId === element.id`    | `TextSelectionHandler._hoveredElementId` |

### Selector Parsing

`StyleSelectorPart` has an optional `pseudoClasses` field:

```typescript
interface StyleSelectorPart {
  type: 'id' | 'type' | 'class' | 'universal';
  value: string;
  pseudoClasses?: string[];  // ['focus'], ['hover'], ['focus', 'hover']
}
```

`parseCompoundSelector()` splits on `:` after the main selector. `button:hover` parses as `{ type: 'type', value: 'button', pseudoClasses: ['hover'] }`.

Pseudo-classes count as class-level specificity (weight 1,000), matching real CSS rules.

### Selector Examples

```css
button:hover { ... }              /* type + pseudo */
.card:focus { ... }               /* class + pseudo */
button.danger:hover { ... }       /* compound + pseudo */
.nav container:hover { ... }      /* descendant combinator + pseudo */
```

### Rule Storage and Fast Path

Rules containing pseudo-class selectors are tagged during parsing. The `hasPseudoClassRules` flag on `Stylesheet` enables fast-path skipping — if no stylesheet has pseudo-class rules, `getPseudoClassStyles()` returns `{}` immediately.

Additionally, `getPseudoClassStyles()` returns `{}` when no element is focused or hovered (checked via `context.focusedElementId` and `context.hoveredElementId`).

### Matching

`getPseudoMatchingStyles()` on `Stylesheet` evaluates only rules with pseudo-class selectors. A rule matches when:
1. The base selector matches the element (type, class, id, ancestors)
2. Every pseudo-class in the selector is active for that element

The `PseudoClassState` context is passed from the layout engine:

```typescript
interface PseudoClassState {
  focusedElementId?: string;
  hoveredElementId?: string;
}
```

### Re-rendering

Focus and hover changes already trigger re-renders (focus via `FocusManager`, hover via `TextSelectionHandler` auto-render). No additional trigger mechanism is needed — `computeStyle()` picks up the new state on the next frame.

## CSS Transitions

### Syntax

```css
/* Shorthand — comma-separated for multiple properties */
transition: background-color 800ms ease;
transition: background-color 300ms ease, color 200ms linear 50ms;
transition: all 500ms ease-in-out;

/* With delay (second time value) */
transition: color 800ms ease 400ms;
```

### Types

```typescript
interface TransitionSpec {
  property: string;      // camelCase: 'backgroundColor', 'color', 'all'
  duration: number;      // ms
  timingFn: string;      // 'ease', 'linear', 'ease-in-out', etc.
  delay: number;         // ms
}

interface PropertyTransition {
  from: any;
  to: any;
  startTime: number;     // performance.now()
  duration: number;      // ms
  delay: number;         // ms
  timingFn: (t: number) => number;
}

interface TransitionState {
  active: Map<string, PropertyTransition>;  // in-flight per-property transitions
  previousValues: Map<string, any>;         // last frame's target values for change detection
}
```

Element fields: `_transitionState?: TransitionState`, `_transitionRegistration?: () => void`.

### Parsing

`parseTransitionShorthand()` parses the `transition` shorthand into `TransitionSpec[]` stored as `_transitionSpecs` on the Style object. Parsing happens once at stylesheet parse time — no re-parsing at runtime.

Token disambiguation:
- Time values (`300ms`, `1s`): first is duration, second is delay
- Known timing functions (`ease`, `linear`, `ease-in`, `ease-out`, `ease-in-out`): timingFn
- Everything else: property name (kebab-case converted to camelCase)

### Data Flow

```
CSS parsed                  hover/focus state changes          UIAnimationManager tick
    │                              │                                  │
    ▼                              ▼                                  ▼
_transitionSpecs            computeStyle() re-runs             requestRender()
(on Style)                         │                                  │
                                   ▼                                  ▼
                           processTransitions()                 layout pass
                           (change detection)                         │
                                   │                                  ▼
                              creates/updates              getTransitionStyle()
                           PropertyTransition               (interpolated values)
                           (on element._transitionState)          │
                                   │                              ▼
                                   ▼                        merged into
                           registers with                   computedStyle
                           UIAnimationManager
```

### Change Detection (`processTransitions`)

Runs inside `computeStyle()` after computing the merged style (without transition overlay). Only executes for elements that have `_transitionSpecs` or `_transitionState` — zero overhead for all other elements.

For each property with a transition spec:
1. Read target value from the pre-transition merged style
2. Compare against `previousValues` (last frame's target)
3. If changed and `duration > 0`: create or interrupt a transition
4. Update `previousValues` to the new target

**Critical invariant**: `processTransitions()` sees the **target** style (what the element wants to be), not the interpolated mid-transition style. This prevents the transition from restarting every frame.

**BoxSpacing decomposition**: `parseStyleProperties()` normalizes `paddingLeft`/`paddingRight`/etc. into `padding: { top, right, bottom, left }` objects. The `getStyleValue()` helper decomposes these when looking up individual properties like `paddingLeft`, so transition specs for individual padding/margin sides work correctly.

### Interruption

When a property's target changes during an active transition (e.g., mouse leaves during hover-in animation):
1. Compute current interpolated value at this moment
2. Use that as the new `from` value
3. Set the new target as `to`
4. Reset `startTime` to now

This produces smooth reversal — the animation continues from its current visual position rather than snapping.

### Interpolation (`getTransitionStyle`)

Called during `computeStyle()` after `processTransitions()`. Iterates active transitions, computes progress, applies easing, and returns interpolated values. Reuses `interpolateValue()` from `css-animation.ts`:

| Category      | Interpolation                                               |
|---------------|-------------------------------------------------------------|
| **Color**     | OKLCH perceptually-uniform lerp via `lerpPackedRGBA()`      |
| **Numeric**   | Linear lerp, rounded to integer                             |
| **BoxSpacing**| Per-component lerp (top, right, bottom, left)               |
| **Percentage**| Lerp numeric part, emit as `"N%"` string                    |
| **Discrete**  | Snap at `t >= 0.5` (non-animatable properties like `border`)|

Completed transitions (progress >= 1) are removed from the active map. When all transitions complete, the UIAnimationManager registration is cleaned up.

### UIAnimationManager

When a transition starts and no registration exists, `processTransitions()` registers a tick callback with `UIAnimationManager` at ~60fps (16ms interval). The callback calls `requestRender()` to drive interpolation forward. When all active transitions complete, the registration is removed.

## Style Cascade Order

The full priority order in `computeStyle()` (lowest to highest):

1. Default style (theme colors, inherited text properties)
2. Type-specific defaults (component defaults)
3. Inherited parent style
4. Stylesheet rules — **sorted by specificity** (definition order as tiebreaker)
5. Inline style (`props.style`)
6. Pseudo-class styles (`:hover`, `:focus`) — see [getPseudoClassStyles](#matching)
7. Container query styles — see [container-query-architecture.md](container-query-architecture.md)
8. CSS animation values (`getAnimatedStyle()`) — see [css-animation-architecture.md](css-animation-architecture.md)
9. CSS transition values (`getTransitionStyle()`) — highest priority, in-flight interpolation

Transition output is highest priority because it represents the in-flight interpolation toward whatever the cascade produced. Once a transition completes, its values are removed and the cascade's target value takes over naturally.

### Dual Injection

Both `computeStyle()` (rendering properties) and `computeLayoutProps()` (flex algorithm) merge pseudo-class, animation, and transition values. This ensures transitioning layout properties (padding, width) affects both visual rendering and element sizing.

## Performance

### Zero-cost for non-transitioning elements

`computeStyle()` gates all transition work behind:
```typescript
if (mergedStyle._transitionSpecs || element._transitionState) { ... }
```

Elements without transition CSS specs (the vast majority) skip `processTransitions()`, `getTransitionStyle()`, and the transition overlay — zero object creation, zero function calls.

### Pseudo-class fast path

`getPseudoClassStyles()` returns `{}` immediately when:
- No stylesheets in context, OR
- No element is focused AND no element is hovered

When pseudo rules exist, only stylesheets with `hasPseudoClassRules === true` are checked.

### Memory

- `_transitionState` is only allocated when an element has `_transitionSpecs` in its resolved style
- `previousValues` Map stores only property values (not full style objects)
- One UIAnimationManager timer per element with active transitions (not per property)

### Layout thrashing

Transitioning layout properties (width, height, padding, margin) forces re-layout every frame during the transition. This is expected behavior but can be expensive for deep element trees. Color transitions are the cheapest — they only affect rendering, not layout.

## Edge Cases

| Scenario                               | Behavior                                                                   |
|----------------------------------------|----------------------------------------------------------------------------|
| Hover during active transition         | Interrupt: current interpolated value becomes new `from`, smooth reversal  |
| Focus + hover simultaneously           | Both pseudo-class styles apply; specificity and source order resolve conflicts |
| Non-animatable property (e.g. `border`)| Discrete snap at `t >= 0.5`                                               |
| `transition: all`                      | Applies to every property that changes (excluding internal `_` prefixed)   |
| Zero-duration transition               | Skipped — instant change, no transition created                            |
| Transition with delay                  | Returns `from` value during delay period, then interpolates                |
| `paddingLeft` in transition spec       | BoxSpacing decomposition extracts value from `padding.left` automatically  |

## Examples

See [`examples/basics/pseudo-classes.melker`](../examples/basics/pseudo-classes.melker) for pseudo-class demos and [`examples/basics/transitions.melker`](../examples/basics/transitions.melker) for transition demos covering:

- Hover color fade (background-color transition)
- Multi-property transitions (background + padding with different durations)
- Focus glow (border-color + text color on focus)
- `transition: all` (all properties animate)
- Timing function comparison (linear, ease, ease-in, ease-out)
- Card border transitions on hover
- Transitions with delay

## Limitations

- **No `:active` pseudo-class**: Would require tracking mousedown state per element
- **No `:disabled` pseudo-class**: Elements have a `disabled` prop but pseudo-class matching is not implemented
- **No `transition: none`**: No reset mechanism to disable inherited transitions
- **No `transitionend` event dispatch**: The event type is defined but not fired yet
- **Integer rounding for layout properties**: Terminal cells are discrete, so padding/margin transitions appear stepped (e.g., padding 1-4 has only 3 visible steps)

## Related Docs

- [css-variables-architecture.md](css-variables-architecture.md) — CSS custom properties (`var()` works in `transition` shorthands)
- [css-animation-architecture.md](css-animation-architecture.md) — `@keyframes` animations, specificity, style cascade
- [architecture-media-queries.md](architecture-media-queries.md) — `@media` queries
