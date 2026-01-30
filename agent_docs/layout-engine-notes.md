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
