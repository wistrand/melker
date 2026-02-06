# Split Pane Component Architecture

The `<split-pane>` component splits its children horizontally (default) or vertically with draggable, focusable divider bars. Supports N children with N-1 dividers. Leverages existing flexbox layout.

## Overview

| Property     | Value                                                        |
|--------------|--------------------------------------------------------------|
| Type         | `split-pane`                                                 |
| File         | [src/components/split-pane.ts](../src/components/split-pane.ts) |
| Internal     | `SplitPaneDivider` extends `SeparatorElement` (not registered) |
| Layout       | Flexbox — row (horizontal) or column (vertical)              |
| Interaction  | Mouse drag, keyboard arrows, Tab focus                       |

## Props

| Prop            | Type               | Default        | Description                                         |
|-----------------|--------------------|----------------|-----------------------------------------------------|
| `sizes`         | `string`           | equal          | Comma-separated proportions, e.g. `"1,2,1"`         |
| `dividerTitles` | `string`           | -              | Comma-separated divider titles, e.g. `"Nav,Info"`   |
| `onResize`      | `handler`          | -              | Fired on resize: `{ sizes, dividerIndex, targetId }` |

## Styles

These style properties are set on the `<split-pane>` element:

| Style            | Type          | Default        | Description                                    |
|------------------|---------------|----------------|------------------------------------------------|
| `direction`      | `string`      | `'horizontal'` | Split direction: `horizontal` (left/right) or `vertical` (top/bottom) |
| `min-pane-size`  | `number`      | `3`            | Minimum pane size in characters                |
| `divider-style`  | `BorderStyle` | `'thin'`       | Line style: `thin`, `thick`, `double`, `dashed`, etc. |
| `divider-color`  | `ColorInput`  | inherited      | Divider foreground color                       |

All are defined on the `Style` interface in [src/types.ts](../src/types.ts), so they work in inline styles, CSS classes, and `@media` queries.

## Usage

```html
<!-- Horizontal split (left/right), equal sizes -->
<split-pane style="width: fill; height: fill;">
  <container><text>Left</text></container>
  <container><text>Right</text></container>
</split-pane>

<!-- Vertical split (top/bottom) via style, custom proportions -->
<split-pane sizes="1,2,1" style="width: fill; height: fill; direction: vertical;">
  <container><text>Top (25%)</text></container>
  <container><text>Middle (50%)</text></container>
  <container><text>Bottom (25%)</text></container>
</split-pane>

<!-- Styled dividers with color, style, titles, and min-pane-size -->
<split-pane
  sizes="1,2,1"
  dividerTitles="A,B"
  style="width: fill; height: fill; divider-style: thick; divider-color: cyan; min-pane-size: 5;"
>
  <container><text>Left</text></container>
  <container><text>Center</text></container>
  <container><text>Right</text></container>
</split-pane>

<!-- Media query: flip direction on narrow terminals -->
<style>
  .responsive-split { direction: horizontal; }
  @media (max-width: 60) {
    .responsive-split { direction: vertical; }
  }
</style>
<split-pane class="responsive-split" style="width: fill; height: fill;">
  <container><text>Pane A</text></container>
  <container><text>Pane B</text></container>
</split-pane>
```

## Example Rendering

### Horizontal split (default), 2 panes

```
┌─────────────────────────────────────────────────┐
│                        │                        │
│   Left pane content    │   Right pane content   │
│                        │                        │
│                        │  <- divider (1 char)   │
│                        │                        │
└─────────────────────────────────────────────────┘
```

### Vertical split, 2 panes

```
┌─────────────────────────────────────────────────┐
│              Top pane content                   │
├─────────────────────────────────────────────────┤ <- divider (1 row)
│              Bottom pane content                │
└─────────────────────────────────────────────────┘
```

### Horizontal split, 3 panes with titles

```
┌────────────┬─────────────────────────┬────────────┐
│            │                         │            │
│  Pane 0    A       Pane 1            B  Pane 2    │
│            │                         │            │
└────────────┴─────────────────────────┴────────────┘
```

### Nested: IDE-style layout

```
┌─────────────────────────────────────────────────┐
│                  Header pane                    │
─────────────────────────────────────────────────── <- vertical divider
│                    │                            │
│   Sidebar          │      Main content          │ <- horizontal divider
│                    │                            │
─────────────────────────────────────────────────── <- vertical divider
│                  Footer pane                    │
└─────────────────────────────────────────────────┘
```

### Focused divider (reverse video)

```
   Left pane     |||    Right pane
                  |
            focused divider
         (rendered with reverse)
```

## Architecture

### Internal Divider Elements

The split-pane creates internal `SplitPaneDivider` element instances interleaved between user children:

```
this.children = [pane0, divider0, pane1, divider1, pane2]
```

`SplitPaneDivider` **subclasses `SeparatorElement`** ([src/components/separator.ts](../src/components/separator.ts)) for line/label rendering and adds `Focusable`, `Draggable`, and `Interactive` interfaces. This reuses the separator's `intrinsicSize()` (orientation detection from parent flex-direction) and `render()` (line drawing with `BORDER_CHARS`, centered label). The subclass overrides `render()` to sync parent styling, apply theme border color defaults, handle focus highlighting, clear bounds, and inset the line.

`SplitPaneDivider` is **not registered** as a component (no `registerComponent()` call). It is created only internally by `SplitPaneElement` and uses type string `'split-pane-divider'` for identification. `SeparatorElement` accepts an optional `type` parameter in its constructor to support this.

```
SplitPaneDivider extends SeparatorElement
  _splitPane     back-reference to parent SplitPaneElement
  _dividerIndex  index in the divider array
  _lastBounds    last rendered bounds (for drag/click)
  _dragging      drag state flag
  props.label    optional title string (inherited from SeparatorProps)

Inherited from SeparatorElement: intrinsicSize(), render() (called via super)
Added interfaces: Focusable, Draggable, Interactive
```

### Layout Strategy

Leverages existing flexbox:

1. Split-pane sets `flexDirection: 'row'` (horizontal) or `'column'` (vertical) on itself
2. Each pane child gets `flexGrow: normalizedSize[i]`, `flexShrink: 1`, `flexBasis: 0`
3. Each divider gets fixed 1-char size (`width: 1` or `height: 1`), `flexGrow: 0`, `flexShrink: 0`
4. Layout engine handles all positioning

`_updateFlexProperties()` is called from the constructor (initial setup) and from drag/keyboard handlers (on resize). Not from `intrinsicSize()` to avoid mutating child props during layout calculation.

The layout engine in [src/layout.ts](../src/layout.ts) recognizes `split-pane` as a container type (alongside `container`, `dialog`, `tab`) and applies flex display defaults.

### Rendering

- **SplitPaneElement.render()**: Stores bounds only. Children render via normal tree traversal.
- **SplitPaneDivider.render()** (overrides `SeparatorElement.render()`):
  1. Syncs parent's `dividerStyle` and `dividerColor` into `this.props.style` so `super.render()` uses them
  2. Falls back to `getThemeColor('border')` when no explicit `dividerColor` is set
  3. Applies `reverse: true` when focused
  4. **Clears full bounds** with spaces before drawing — the rendering pipeline passes the element's full allocated bounds to `render()`, not content bounds (padding only affects child positioning), so the inset padding cells and stale focus-reversed cells must be explicitly cleared
  5. **Insets the line** by 1 char at each end (top/bottom for horizontal splits, left/right for vertical splits) for visual breathing room
  6. Delegates to `super.render()` with the inset bounds for actual line/label drawing

### Mouse Drag

Dividers implement the `Draggable` interface (same pattern as slider):

- `getDragZone(x, y)` returns `'divider'` if within bounds
- `handleDragStart/Move/End` delegate to `SplitPaneElement._handleDividerDrag(index, x, y)`

The drag handler converts the absolute mouse position to a proportion delta between adjacent panes, enforces `minPaneSize`, updates `_normalizedSizes`, calls `_updateFlexProperties()`, requests a force render, and fires `onResize`.

### Keyboard

Dividers implement `handleKeyInput(key, ctrlKey, altKey)`:

- Horizontal: `ArrowLeft`/`ArrowRight` move divider by 1 char
- Vertical: `ArrowUp`/`ArrowDown` move divider by 1 char
- Delegates to `SplitPaneElement._handleDividerKeyboardMove(index, charDelta)`

Both drag and keyboard handlers call `requestForceRender()` after updating flex properties. This ensures the buffer does a full diff on the next render, since dirty-row tracking may miss rows where pane content disappeared (the buffer `clear()` at frame start doesn't mark rows dirty, so rows that had content but are now empty would be skipped by the optimization).

Keyboard routing is handled in [src/engine-keyboard-handler.ts](../src/engine-keyboard-handler.ts) alongside the slider routing block, matching on `focusedElement.type === 'split-pane-divider'`.

### Focus

Each `SplitPaneDivider` implements `Focusable` with `canReceiveFocus() -> true` and `tabIndex: 0`. The focus system discovers them automatically during tree traversal. Tab order is position-based (y then x), so dividers fall naturally between pane content.

### Divider Titles

Titles are parsed from the `dividerTitles` prop (comma-separated string) and passed to each `SplitPaneDivider` at construction time. Rendering:

- **Horizontal split** (vertical divider, 1 char wide): title rendered vertically, one character per row, centered along the divider height
- **Vertical split** (horizontal divider, 1 row tall): title rendered horizontally, centered along the divider width

Titles are rendered in bold over the divider line characters.

### Resize Event

```typescript
interface SplitPaneResizeEvent {
  type: 'resize';
  sizes: number[];       // normalized proportions (sum = 1.0)
  dividerIndex: number;  // which divider was moved
  targetId: string;      // split-pane element ID
}
```

## Edge Cases

| Case                    | Behavior                                           |
|-------------------------|----------------------------------------------------|
| 1 child                 | No dividers created, acts as simple flex container  |
| 0 children              | Renders nothing                                    |
| `sizes` length mismatch | Falls back to equal distribution (with logger warn) |
| Minimum enforcement     | Drag/keyboard clamped to prevent panes < `minPaneSize` |
| Terminal resize         | Proportions are normalized ratios, adapt automatically |
| Nested split-panes      | Work naturally (each is a flex container)           |
| BW theme                | Uses ASCII `|` and `-` instead of box-drawing chars (via `SeparatorElement`) |

## Files

| File                                                                            | Role                                          |
|---------------------------------------------------------------------------------|-----------------------------------------------|
| [src/components/split-pane.ts](../src/components/split-pane.ts)                 | Component implementation + registration       |
| [src/components/separator.ts](../src/components/separator.ts)                   | Base class for `SplitPaneDivider`             |
| [src/components/mod.ts](../src/components/mod.ts)                               | Export                                        |
| [src/types.ts](../src/types.ts)                                                 | `SplitPaneProps` in type maps, `dividerColor`/`dividerStyle` on `Style` |
| [src/layout.ts](../src/layout.ts)                                               | Container-type recognition for flex defaults  |
| [src/engine-keyboard-handler.ts](../src/engine-keyboard-handler.ts)             | Keyboard routing for `split-pane-divider`     |
| [examples/components/split-pane-demo.melker](../examples/components/split-pane-demo.melker)           | Feature demo                     |
| [examples/components/split-pane-nested.melker](../examples/components/split-pane-nested.melker)       | Nested IDE-style layout demo     |
| [examples/components/split-pane-responsive.melker](../examples/components/split-pane-responsive.melker) | Responsive direction via `@media` queries |
