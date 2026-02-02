# Plan: @media Queries for Terminal Size

## Overview

Add CSS-like `@media` queries to Melker stylesheets that respond to terminal dimensions.

```css
@media (min-width: 80) {
  .sidebar { width: 20; }
}
@media (max-width: 60) {
  .sidebar { display: none; }
}
@media (max-height: 24) {
  .footer { height: 1; }
}
```

## Current Architecture

### Stylesheet System (`src/stylesheet.ts`)
- Parses CSS-like rules: `selector { properties }`
- Flat list of `StyleItem[]` (selector + style pairs)
- Applied once at element creation via `applyStylesheet()`
- No knowledge of terminal size

### Terminal Size Flow
- `engine._currentSize` holds dimensions
- `_handleResize()` triggers on SIGWINCH
- Resize → `forceRender()` → re-layout (but styles NOT re-applied)

### Layout Context
- `LayoutContext.viewport` contains terminal size
- Available during layout calculation

## Implementation Plan

### Phase 1: Data Structures

Add new types to `src/stylesheet.ts`:

```typescript
interface MediaCondition {
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

interface MediaBlock {
  condition: MediaCondition;
  rules: StyleItem[];
}

// Update StyleItem to optionally have a media condition
interface StyleItem {
  selector: StyleSelector;
  style: Style;
  mediaCondition?: MediaCondition;  // New: optional media condition
}
```

### Phase 2: Parsing

Extend `parseStyleBlock()` to recognize `@media` blocks:

1. Detect `@media (...)  { ... }` pattern
2. Parse condition string into `MediaCondition`
3. Parse nested rules
4. Attach `mediaCondition` to each nested `StyleItem`

```typescript
function parseMediaCondition(conditionStr: string): MediaCondition {
  // Parse: "min-width: 80" or "max-height: 24" etc.
  // Support: min-width, max-width, min-height, max-height
  // Support multiple conditions with "and"
}

function parseStyleBlock(css: string): StyleItem[] {
  // Existing rule parsing...

  // NEW: Detect @media blocks
  const mediaPattern = /@media\s*\(([^)]+)\)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
  // Parse nested rules and attach mediaCondition
}
```

### Phase 3: Conditional Evaluation

Add terminal size context to style matching:

```typescript
interface StyleContext {
  terminalWidth: number;
  terminalHeight: number;
}

function mediaConditionMatches(condition: MediaCondition, ctx: StyleContext): boolean {
  if (condition.minWidth !== undefined && ctx.terminalWidth < condition.minWidth) return false;
  if (condition.maxWidth !== undefined && ctx.terminalWidth > condition.maxWidth) return false;
  if (condition.minHeight !== undefined && ctx.terminalHeight < condition.minHeight) return false;
  if (condition.maxHeight !== undefined && ctx.terminalHeight > condition.maxHeight) return false;
  return true;
}

// Update getMergedStyle to accept context
getMergedStyle(element: Element, ancestors: Element[], ctx?: StyleContext): Style {
  const matchingStyles = this._items
    .filter(item => {
      // Check media condition first
      if (item.mediaCondition && ctx) {
        if (!mediaConditionMatches(item.mediaCondition, ctx)) return false;
      }
      return selectorMatches(item.selector, element, ancestors);
    })
    .map(item => item.style);
  return matchingStyles.reduce((merged, style) => ({ ...merged, ...style }), {});
}
```

### Phase 4: Resize Integration

Update `applyStylesheet()` and engine resize handling:

```typescript
// In stylesheet.ts
export function applyStylesheet(
  element: Element,
  stylesheet: Stylesheet,
  ancestors: Element[] = [],
  ctx?: StyleContext  // New parameter
): void {
  const stylesheetStyle = stylesheet.getMergedStyle(element, ancestors, ctx);
  // ... rest unchanged
}

// In engine.ts - _handleResize()
private _handleResize(newSize: { width: number; height: number }): void {
  // ... existing code ...

  // NEW: Re-apply stylesheet with new terminal size
  if (this._stylesheet) {
    const ctx = { terminalWidth: newSize.width, terminalHeight: newSize.height };
    applyStylesheet(this._rootElement, this._stylesheet, [], ctx);
  }

  // ... existing forceRender() call ...
}
```

### Phase 5: Bundler Integration

Update bundler to pass stylesheet and terminal size context:

- Store stylesheet reference in engine
- Ensure `applyStylesheet()` is called with context on initial render
- Ensure re-application on resize

## File Changes Summary

| File                        | Changes                                              |
|-----------------------------|------------------------------------------------------|
| `src/stylesheet.ts`         | +150-200 lines: types, parsing, evaluation           |
| `src/engine.ts`             | +20-30 lines: resize integration, stylesheet storage |
| `src/bundler/generator.ts`  | +10-20 lines: pass context to applyStylesheet        |
| `tests/stylesheet_test.ts`  | +100-150 lines: media query tests                    |

## Estimated Effort

| Task               | Lines        | Effort      |
|--------------------|--------------|-------------|
| Data structures    | 30-50        | Easy        |
| Parsing            | 100-150      | Easy-Medium |
| Evaluation         | 50-80        | Easy        |
| Resize integration | 50-100       | Medium      |
| Tests              | 100-150      | Medium      |
| **Total**          | **~400-600** | **1-2 days**|

## Complexity Notes

### Main Challenge: Resize Re-application

Currently `applyStylesheet()` runs once at element creation. With media queries:
1. Detect which elements have media-dependent styles
2. Re-evaluate and re-apply only those on resize
3. Ensure layout recalculates after style changes

**Simple approach (Phase 1):** Re-apply ALL stylesheet rules on every resize. Inefficient but correct.

**Optimized approach (Future):** Track elements with media-dependent styles, update only those.

### Edge Cases to Handle

- Nested @media blocks (not supported initially)
- Multiple conditions: `@media (min-width: 60) and (max-width: 100)`
- Invalid conditions (graceful fallback)
- Elements created after initial stylesheet application

## Example Usage

```xml
<melker>
  <style>
    .sidebar {
      width: 30;
      border: thin;
    }

    @media (max-width: 80) {
      .sidebar {
        width: 20;
      }
    }

    @media (max-width: 60) {
      .sidebar {
        display: none;
      }
    }

    @media (max-height: 20) {
      .footer {
        display: none;
      }
    }
  </style>

  <container style="flex-direction: row">
    <container class="sidebar">Sidebar</container>
    <container class="main" style="width: fill">Main</container>
  </container>
  <container class="footer">Footer</container>
</melker>
```

## Future Enhancements

- `orientation: portrait | landscape` (height > width vs width > height)
- `aspect-ratio` queries
- Custom properties/CSS variables with media-dependent values
- `@container` queries (relative to parent, not viewport)
