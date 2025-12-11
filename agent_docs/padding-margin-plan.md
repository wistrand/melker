# Plan: Generic Padding/Margin Support

**Status: IMPLEMENTED**

Implementation completed in `src/layout.ts` by adding `_normalizeBoxSpacing()` method
that consolidates individual CSS properties (paddingLeft, marginTop, etc.) into
BoxSpacing objects when computing styles.

## Current State Analysis

**What works:**
- Border affects layout size (handled in layout system generically)
- Container elements have some internal padding support

**What doesn't work:**
- Padding on leaf elements (text, button, etc.)
- Margin on any elements

## Implementation Strategy

### Phase 1: Understand Current Border Implementation

1. Study how border affects layout in `src/layout.ts`
2. Identify where border width is added to element size
3. Identify where content bounds are reduced for border
4. Use this pattern as template for padding/margin

### Phase 2: Implement Generic Padding

**In layout.ts:**

1. When calculating element's intrinsic size:
   - Get padding values from element styles (padding, padding-left, padding-right, padding-top, padding-bottom)
   - Add horizontal padding to width, vertical padding to height
   - Similar to how border is handled

2. When assigning render bounds to element:
   - Create "content bounds" = assigned bounds minus padding
   - Pass content bounds to element's render method
   - Element renders within content bounds, unaware of padding

**Key principle:** Padding is handled entirely by layout system. Components don't need changes.

### Phase 3: Implement Generic Margin

**In layout.ts:**

1. When positioning children in flex layout:
   - Read margin from each child element
   - Add margin-left to starting X position
   - Add margin-top to starting Y position
   - Add margin-right/bottom to space before next sibling

2. When calculating total space needed:
   - Include margins in size calculations
   - Handle margin between siblings (not collapsed, simple additive)

**Key principle:** Margin is handled entirely by layout system. Components don't need changes.

### Phase 4: Style Parsing

Ensure style system parses:
- `padding` (shorthand)
- `padding-left`, `padding-right`, `padding-top`, `padding-bottom`
- `margin` (shorthand)
- `margin-left`, `margin-right`, `margin-top`, `margin-bottom`

Check `src/styles.ts` or template parsing to confirm these are already parsed or add support.

### Phase 5: Testing Strategy

**Before any changes:**
1. Run all existing tests: `deno task test`
2. Manually test key demos: `file_browser_demo`, `chat_demo`, `markdown_viewer`
3. Document current behavior as baseline

**After each phase:**
1. Run all existing tests - must pass
2. Test demos visually - layout must be unchanged
3. Only then proceed to next phase

**New tests to add:**
- Text element with padding-left
- Text element with margin-left
- Button with padding
- Container with margin between children
- Nested elements with combined padding/margin

### Implementation Order

1. Read and understand border implementation in layout.ts
2. Add padding to intrinsicSize calculation (mirror border approach)
3. Adjust content bounds passed to render (mirror border approach)
4. Test: existing layouts unchanged, padding now works
5. Add margin to position calculations in flex layout
6. Test: existing layouts unchanged, margin now works
7. Add comprehensive tests

### Risk Mitigation

- **Risk:** Existing layouts break due to elements suddenly having padding
  - **Mitigation:** Only apply padding if style explicitly sets it (default = 0)

- **Risk:** Performance impact from reading padding/margin on every layout
  - **Mitigation:** Cache computed styles, only recalculate on style change

- **Risk:** Interaction with existing container padding
  - **Mitigation:** Audit container component for existing padding logic, ensure no double-application

### Files to Modify

| File | Changes |
|------|---------|
| `src/layout.ts` | Add padding/margin to size calculations and positioning |
| `src/styles.ts` | Ensure padding/margin properties are parsed (verify first) |
| `src/types.ts` | Add types if needed for padding/margin values |

### Files NOT to Modify

- Individual components (text.ts, button.ts, etc.) - they should work automatically
- rendering.ts - unless content bounds need adjustment there
