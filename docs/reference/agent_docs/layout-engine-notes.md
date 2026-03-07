# Layout Engine Notes

Technical notes about the Melker layout engine behavior.

## Table Height Calculation

Tables calculate their height in two places that must stay synchronized:

1. **`intrinsicSize()`** - Returns the natural size for layout calculations
2. **`render()`** - Uses `fixedHeight` to determine space for thead/tfoot vs tbody

### Separator Height Rules

Table section separators (horizontal lines between thead/tbody/tfoot) are only rendered when `border !== 'none'`. Both `intrinsicSize()` and `fixedHeight` calculation must use the same logic:

```typescript
// Correct: separator only counts when hasBorder is true
if (hasBorder && (tbody || tfoot)) fixedHeight++;
```

If these calculations diverge, the layout engine will allocate incorrect height to the table, causing rows to be clipped.

### Height Flow

1. Layout engine calls `table.intrinsicSize()` to get natural dimensions
2. Layout engine assigns bounds based on intrinsic size and flex rules
3. Table render receives `bounds.height` and calculates `availableTbodyHeight = bounds.height - fixedHeight`
4. If `fixedHeight` calculation differs from `intrinsicSize()`, tbody gets wrong space allocation

## Element Bounds Registration

Tables are self-rendering components - they don't use the standard layout system for their cells. To make table cell elements findable by connectors:

- Table cells with IDs call `context.registerElementBounds(id, bounds)` during render
- This populates `_dynamicBounds` in the rendering system
- `getElementBounds()` checks `_dynamicBounds` first, then falls back to layout context

## Connector Element Lookup

Connectors find their endpoints via `context.getElementBounds(elementId)`:

1. Check `_dynamicBounds` (for table cells and other self-rendered elements)
2. Check `_currentLayoutContext` (for normally laid-out elements)
3. Apply scroll offset adjustments if element is inside a scrollable container

If an element isn't properly laid out or registered, connectors will either skip rendering or draw at incorrect positions.

## Position: Relative

`position: relative` offsets an element visually from its normal-flow position without affecting siblings. The element participates normally in flex/block layout (occupying its original space), then its bounds are shifted by `top`/`left`/`bottom`/`right`.

### Implementation

A single helper `_applyRelativeOffset(bounds, layoutProps)` is called at three sites, always **before** `calculateLayout()`:

| Code path | Location in `src/layout.ts` |
|-----------|-----------------------------|
| Flex layout | After flex algorithm computes bounds, before `calculateLayout()` |
| Block layout | After block flow computes child position, before `calculateLayout()` |
| Virtual layout | After estimated bounds, before `calculateLayout()` |

### Offset rules

- `top` shifts `y` positively (downward); `bottom` shifts `y` negatively (upward)
- `left` shifts `x` positively (rightward); `right` shifts `x` negatively (leftward)
- When both `top` and `bottom` are set, `top` wins
- When both `left` and `right` are set, `left` wins
- Without `position: relative`, `top`/`left`/`bottom`/`right` are ignored

### Why Option A (offset before `calculateLayout`)

The offset is applied to `parentBounds` before the recursive `calculateLayout()` call. This means:

1. The element and all its descendants render at the offset position
2. Hit testing works automatically — renderer stores offset bounds, hit tester reads them
3. No changes needed in `hit-test.ts` or `rendering.ts`
4. Children are laid out relative to the offset parent (correct CSS behavior)

### Animating relative position

`top`, `right`, `bottom`, `left` are in the animation engine's `NUMERIC_PROPS` set, so CSS animations work directly:

```css
@keyframes slide { from { left: 0; } to { left: 30; } }
.slider { position: relative; animation: slide 2s ease-in-out infinite alternate; }
```

See [`examples/basics/animation.melker`](../examples/basics/animation.melker) for slide, bounce, and orbit demos.

## Container Queries

Container queries style children based on their container's resolved size. The layout engine threads `containerBounds` through `LayoutContext` and evaluates `@container` conditions during `_computeStyle()` and `_computeLayoutProps()`.

### How bounds propagate

When `calculateLayout()` enters an element with `containerType` set (e.g., `inline-size`), it stores the element's resolved bounds on `childContext.containerBounds`. All descendants inherit these bounds until overridden by a closer container.

### display: none

Container query styles that set `display: none` work because the layout engine checks `layoutProps.display === 'none'` from `_getCachedLayoutProps()` (which includes container query styles) rather than reading `props.style.display` directly.

### Style cascade position

Container query styles sit between inline style and animation in the merge chain:

```
...inline → ...containerQueryStyles → ...animatedStyle
```

See [container-query-architecture.md](container-query-architecture.md) for full details.

## Two Style Paths

The layout engine has two separate style computation pipelines:

1. **`_computeStyle()`** → `computedStyle` — Used by the renderer for visual properties (colors, borders, etc.)
2. **`_computeLayoutProps()`** → `layoutProps` — Used by the flex algorithm for layout properties (`flexDirection`, `gap`, `display`, etc.)

Changes to flex/layout behavior must go in `_computeLayoutProps`, not `_computeStyle`.

## Inline Style vs Stylesheet Precedence

`applyStylesheet()` captures `props.style` as `_inlineStyle` on its first call. Inline style always wins over stylesheet rules. This means:

- Don't put media-query-overridable defaults in constructor `props.style` — they'll be captured as inline and can never be overridden by stylesheets
- Use low-level props like `flexDirection` for defaults, and let semantic props like `direction` come from stylesheets

## Root Element Height Defaulting

The engine sets `props.height = terminalHeight` if neither `props.height` nor `props.style.height` is set. A CSS stylesheet's `height: auto` goes to `computedStyle`, not `props.style`, so it doesn't prevent this override. To prevent it, set `height: auto` in inline style.

## Three Intrinsic Size Calculators

Three separate functions calculate intrinsic sizes. Changes to gap or wrap logic must be applied in all three:

| Calculator                    | File                  | Used for                     |
|-------------------------------|-----------------------|------------------------------|
| `ContainerElement.intrinsicSize()` | `src/components/container.ts` | Renderable containers  |
| `_calculateIntrinsicSize()`   | `src/layout.ts`       | Non-renderable containers    |
| `measureContainer()`          | `src/content-measurer.ts` | Scroll content sizing    |

All three count children for gap calculation and handle `flex-wrap: wrap` for row-direction containers by simulating line-breaking.

## Per-Frame Caches

Three Maps are cleared at the start of each layout pass:

| Cache                  | Accessor                     | Purpose                           |
|------------------------|------------------------------|-----------------------------------|
| `_layoutPropsCache`    | `_getCachedLayoutProps()`    | Avoid redundant `computeLayoutProps` calls |
| `_styleCache`          | `_getCachedStyle()`          | Avoid redundant `_computeStyle` calls     |
| `_intrinsicSizeCache`  | `_cachedIntrinsicSize()`     | Avoid redundant `intrinsicSize` calls     |

The intrinsic size cache uses a "last result" pattern — stores `{aw, ah, result}` per element and only hits when `availableSpace` matches (since the same element may be measured with different available space at different nesting levels). The cache is shared with `ContainerElement.intrinsicSize()` via `IntrinsicSizeContext._sizeCache`.

## Zero-Size Children and Gap

Connectors return `{0, 0}` from `intrinsicSize()` but were counted in `childCount` for gap calculation. With `gap: 5` and 24 connectors, this adds 120+ phantom rows. Fix: only count children with non-zero main-axis size.
