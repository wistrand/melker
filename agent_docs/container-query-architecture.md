# Container Query Architecture

CSS container queries: style children based on their container's resolved size, not the terminal size.

```css
.sidebar { container-type: inline-size; }

@container (min-width: 40) {
  .card { flex-direction: row; }
}
```

## Key Insight: No Two-Pass Layout

Melker's layout is top-down recursive — parent bounds are always resolved before children are styled. Container query conditions are evaluated inline during layout, no second pass needed.

```
calculateLayout(parent)          <- parent bounds computed
  +-- _layoutFlex(children)       <- children laid out after
       +-- for each child:
            _computeStyle(child)  <- child style computed here (with container bounds)
```

## Key Files

| File                       | Role                                                              |
|----------------------------|-------------------------------------------------------------------|
| [`src/types.ts`](../src/types.ts)           | `ContainerCondition` interface, `containerType` on Style          |
| [`src/stylesheet.ts`](../src/stylesheet.ts) | `@container` parsing, condition matching, `getContainerMatchingStyles()` |
| [`src/layout.ts`](../src/layout.ts)         | `_getContainerQueryStyles()`, dual-path injection, ancestor/bounds threading |
| [`src/rendering.ts`](../src/rendering.ts)   | Passes stylesheets into `LayoutContext` for container query evaluation |
| [`src/lint.ts`](../src/lint.ts)             | `containerType` in `BASE_STYLES_SCHEMA`                          |
| [`src/lsp.ts`](../src/lsp.ts)              | `@container` completion snippets, nested brace handling          |

## Syntax

```css
/* Mark a container */
.sidebar { container-type: inline-size; }

/* Query container width */
@container (min-width: 40) {
  .nav-item { flex-direction: row; gap: 2; }
}

/* Query container height (requires container-type: size) */
@container (max-height: 20) {
  .footer { display: none; }
}
```

### Supported Conditions

| Condition    | Syntax                  | Description                    |
|--------------|-------------------------|--------------------------------|
| `min-width`  | `(min-width: 40)`      | Container width >= value        |
| `max-width`  | `(max-width: 25)`      | Container width <= value        |
| `min-height` | `(min-height: 20)`     | Container height >= value       |
| `max-height` | `(max-height: 15)`     | Container height <= value       |

Multiple conditions joined with `and`.

### Container Types

| Value         | Width queries | Height queries |
|---------------|---------------|----------------|
| `inline-size` | Yes           | No             |
| `size`        | Yes           | Yes            |
| `normal`      | No (default)  | No             |

## Architecture

### Two Style Systems

| System              | When it runs                      | What it writes        |
|---------------------|-----------------------------------|-----------------------|
| `applyStylesheet()` | Before layout (init + resize)     | `element.props.style` |
| `_computeStyle()`   | During layout (per element/frame) | `computedStyle`       |

Media queries work through `applyStylesheet()` — evaluated before layout using terminal size. Container queries evaluate during layout when parent bounds are known. Container query styles live in `computedStyle` only, **never** in `props.style` — exactly like CSS animation values.

### CSS Parsing (`src/stylesheet.ts`)

`@container` blocks are detected alongside `@media` in `parseStyleBlock()`. Inner rules are parsed recursively. Each resulting `StyleItem` carries an optional `containerCondition: ContainerCondition`. Container rules are stored separately in `_containerItems: StyleItem[]` (not mixed with regular `_items`).

`containerConditionMatches(condition, containerSize)` checks all specified fields (AND logic). Only evaluates conditions appropriate for the container type (`inline-size` skips height conditions).

### Stylesheet Query Method

`getContainerMatchingStyles(element, ancestors, containerSize, styleContext?)`:
- Iterates only `_containerItems` (not `_items`)
- Filters by `containerConditionMatches()`, then `selectorMatches()`
- Sorts by specificity, returns merged styles
- Returns `{}` when `_containerItems` is empty (fast path)

`hasContainerRules` getter returns `_containerItems.length > 0` — used to skip the entire code path.

### Layout Integration (`src/layout.ts`)

#### LayoutContext extension

```typescript
export interface LayoutContext {
  // ...existing fields...
  stylesheets?: readonly Stylesheet[];
  styleContext?: StyleContext;
  ancestors?: Element[];
  containerBounds?: { width: number; height: number };
}
```

#### Container query style helper

`_getContainerQueryStyles(element, context)`:
- Returns `{}` when no container queries exist (fast path via `hasContainerRules`)
- Gets container bounds from `context.containerBounds`
- Iterates all stylesheets, calling `getContainerMatchingStyles()` on each
- Merges results from all stylesheets

#### Dual-path injection

Container query styles are injected into **both** style paths (same pattern as CSS animations):

1. **`_computeStyle()`** — rendering properties (colors, text, border):
   ```typescript
   const mergedStyle = {
     ...defaultStyle,
     ...typeDefaults,
     ...inheritableParentStyle,
     ...(element.props && element.props.style),
     ...this._getContainerQueryStyles(element, context),  // container queries
     ...this._getAnimatedStyle(element),                   // animations (last wins)
   };
   ```

2. **`_computeLayoutProps()`** — layout properties (width, height, flex, gap):
   ```typescript
   const baseStyle = (element.props && element.props.style) || {};
   const containerStyles = this._getContainerQueryStyles(element, context);
   const animStyle = this._getAnimatedStyle(element);
   const style = { ...baseStyle, ...containerStyles, ...animStyle };
   ```

#### Ancestor and bounds threading

In `calculateLayout()`, ancestors are tracked and container bounds set when entering a `containerType` element:

```typescript
childContext.ancestors = [...(context.ancestors || []), element];
if (computedStyle.containerType && computedStyle.containerType !== 'normal') {
  childContext.containerBounds = { width: bounds.width, height: bounds.height };
}
```

Container bounds propagate to all descendants until overridden by a closer container.

### display: none with container queries

Container query styles that set `display: none` work correctly. The layout engine checks `layoutProps.display === 'none'` (from `_getCachedLayoutProps()` which includes container query styles) rather than reading `props.style.display` directly. This ensures container-query-injected display changes take effect during the partitioning step.

## Style Cascade Order

1. Default style (theme colors, inherited text properties)
2. Type-specific defaults (component defaults)
3. Inherited parent style
4. Stylesheet rules — sorted by specificity
5. Inline style (`props.style`)
6. **Container query styles** (context-dependent override)
7. CSS animation values (`_getAnimatedStyle()`)

Container query styles override inline because they're context-dependent — a container shrinking should override the default inline layout. Animation still wins over everything.

## Animation Interaction

Container queries work correctly with CSS animations because of the top-down layout order:

**Animated container -> children with `@container` rules:**

```
calculateLayout(container)
  1. _computeStyle(container)        -> _getAnimatedStyle() -> e.g. width: 60 (mid-animation)
  2. _computeLayoutProps(container)   -> picks up animated width: 60
  3. _calculateElementBounds()        -> bounds = { width: 60, ... }
  4. _layoutFlex(children)            -> context.containerBounds = { width: 60 }
       +-- _computeStyle(child)       -> @container (min-width: 40) matches (60 >= 40)
```

The animated size flows into bounds (step 3) **before** children evaluate container queries (step 4).

**Same property set by both container query and animation on a child:** Animation wins — it's last in the cascade (step 7 > step 6). Matches CSS spec.

## What Works Automatically

| Feature            | Why                                                                     |
|--------------------|-------------------------------------------------------------------------|
| Specificity        | Container-conditioned rules carry `specificity` like media rules        |
| Animation          | Container query styles go into `computedStyle`; animations overlay last |
| Hit testing        | No impact — bounds unchanged                                            |
| `_inlineStyle`     | No impact — container query styles don't write to `props.style`         |
| Per-frame caching  | `_styleCache` cleared each frame; re-evaluated with current bounds      |
| No resize handler  | Re-evaluated every layout pass from live parent bounds                  |

## Comparison to Media Queries

| Aspect                  | Media queries                | Container queries                             |
|-------------------------|------------------------------|-----------------------------------------------|
| When evaluated          | Before layout                | During layout                                 |
| Context                 | Terminal size (global)       | Parent bounds (local)                         |
| Writes to `props.style` | Yes                          | No (stays in `computedStyle`)                 |
| Re-apply on resize      | Yes (terminal resize handler)| No (re-evaluated each frame automatically)    |
| Two-pass layout         | No                           | No (parent bounds known before children)      |
| CSS comment support     | Yes                          | Yes                                           |

## Performance

### Zero overhead without container queries

`hasContainerRules` fast path ensures zero cost when no `@container` rules exist — the entire code path is skipped.

### With container queries

For each element inside a container-type ancestor:
```
For each @container rule:                      O(container_rules)
  containerConditionMatches(condition, size)    O(1) -- numeric comparisons
  selectorMatches(selector, element, ancestors) O(ancestor_depth)
Sort matches by specificity                     O(m log m)
Merge styles                                    O(m)
```

Typical app (~100 elements, ~5 `@container` rules): ~0.2-0.5ms overhead, well within the 20ms slow-layout threshold.

### Mitigations

| Mitigation                             | Effect                                                                |
|----------------------------------------|-----------------------------------------------------------------------|
| `hasContainerRules` fast path          | Zero cost when no `@container` rules exist                            |
| Per-frame `_styleCache`               | Each element's container query result computed once per frame          |
| Separate `_containerItems` array       | Regular `getMatchingStyles()` never iterates container rules          |
| Short-circuit on container-type        | Skip elements whose ancestors have no `container-type` set           |

## LSP Support

The language server provides:
- `@container` completion snippet with condition template
- Nested brace handling via `unwrapAtRules()` preprocessor (brace-depth tracking)
- CSS comment stripping (`/* ... */`) before validation
- `containerType` property validation with enum values

## Example

```css
.sidebar {
  container-type: inline-size;
  width: 30%;
  border: thin;
}

@container (min-width: 40) {
  .nav-item { flex-direction: row; gap: 2; }
}

@container (max-width: 25) {
  .nav-item { flex-direction: column; }
  .nav-label { display: none; }
}
```

When the sidebar is wide enough (>= 40 cells), nav items display horizontally. When narrow (<= 25), they stack vertically and labels hide. All evaluated per-frame from the sidebar's actual resolved width.

### Example Apps

| Example                                                                                | Demonstrates                                       |
|----------------------------------------------------------------------------------------|-----------------------------------------------------|
| [container-queries.melker](../examples/layout/container-queries.melker)                | Split-pane with sidebar, cards adapting via @container |
| [container-queries-animated.melker](../examples/layout/container-queries-animated.melker) | Animated container width with status badges adapting through breakpoints |

## Limitations

- **No named containers**: All `@container` queries match the nearest ancestor with `container-type` set. Named container matching (`container-name`) is not supported.
- **No nested `@container` blocks**: Inner `@container` blocks inside outer `@container` blocks won't be recognized.
- **Container-type on root**: Setting `container-type` on the root element won't work since bounds come from the terminal, not a container.

## Related Docs

- [css-variables-architecture.md](css-variables-architecture.md) — CSS custom properties (`var()` works in `@container` rule bodies)
- [css-animation-architecture.md](css-animation-architecture.md) — `@keyframes` animations, specificity
- [architecture-media-queries.md](architecture-media-queries.md) — `@media` queries (terminal-level, vs container-level)
