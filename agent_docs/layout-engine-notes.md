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
