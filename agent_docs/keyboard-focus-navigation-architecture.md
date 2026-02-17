# Keyboard, Focus & Navigation Architecture

## Summary

- **Tab/Shift+Tab** cycles through focusable elements sorted by position
- **Arrow keys** scroll if inside a scrollable container, otherwise jump to the nearest element in that direction (geometric navigation)
- **Shift+Arrow** bypasses scrolling and jumps directly to the next element
- **Ctrl+K** opens the command palette, which auto-discovers all interactive elements and lets users search/activate them
- Elements can declare global shortcuts via `palette-shortcut` (e.g. `Ctrl+S`)
- Modals trap focus — Tab and arrows stay inside the modal
- The command palette is draggable by its title bar

## Overview

Melker's keyboard and focus system handles key event dispatch, focus management, tab order, geometric (directional) navigation, scroll interaction, and focus trapping for modals.

## Key Files

| File                                 | Purpose                                              |
|--------------------------------------|------------------------------------------------------|
| `src/engine-keyboard-handler.ts`     | Top-level key event dispatch chain                   |
| `src/focus.ts`                       | `FocusManager` — focus state, tab order, geometric nav |
| `src/focus-navigation-handler.ts`    | `FocusNavigationHandler` — element discovery, Tab/arrow nav |
| `src/scroll-handler.ts`              | Scroll handling for arrow keys and mouse wheel       |
| `src/input.ts`                       | Terminal input parsing (escape sequences, modifiers)  |
| `src/types.ts`                       | `Focusable`, `KeyboardElement`, `hasKeyPressHandler`  |
| `src/command-palette-components.ts`  | Palette component discovery, shortcuts, label resolution |
| `src/engine-system-palette.ts`       | System palette injection, component command injection |

## Keyboard Event Dispatch Chain

`handleKeyboardEvent()` in `engine-keyboard-handler.ts` processes keys in strict priority order. The first handler that returns `true` wins:

| Priority | Handler                            | Keys                          | Gate                                           |
|----------|------------------------------------|-------------------------------|-------------------------------------------------|
| 1        | Ctrl+C exit                        | Ctrl+C                        | Always                                          |
| 2        | Tab navigation                     | Tab, Shift+Tab                | Always                                          |
| 3        | Arrow with no focus                | Arrow keys                    | No element currently focused                    |
| 4        | System keys                        | F12, F6, Ctrl+K, Escape, etc. | Various                                         |
| 4.5      | Palette shortcuts                  | User-defined                  | Shortcut registered via `palette-shortcut` prop |
| 5        | Command palette capture            | All keys                      | Command palette is open                         |
| 6        | Function keys (AI/accessibility)   | F7, F8, F9, Ctrl+/            | Various                                         |
| 7        | Clipboard copy                     | Alt+N, Alt+C                  | Always                                          |
| 8        | Focused element keyboard input     | All keys                      | Element handles own keys (see below)            |
| 9        | Scroll handler                     | Arrow keys                    | Scrollable parent found, scroll succeeded       |
| 10       | Geometric focus navigation         | Arrow keys                    | `focusInDirection` finds a candidate            |

### Focused Element Input (Priority 8)

`handleFocusedElementInput()` dispatches to the focused element in this order:

1. **split-pane-divider** — `handleKeyInput()` (always consumes)
2. **slider** — `handleKeyInput()` (always consumes)
3. **input / textarea** — `handleKeyInput()` with fast-render path
4. **KeyboardElement** — `handlesOwnKeyboard() && onKeyPress()` (data-table, filterable-list, file-browser, data-tree)
5. **button** — Enter triggers click
6. **Clickable** — Enter/Space triggers click (checkbox, radio)
7. **hasKeyPressHandler** — generic `onKeyPress()` fallback

## Focus Management (`src/focus.ts`)

### FocusManager

Central focus state holder. Tracks:
- `_focusedElementId` — currently focused element
- `_focusableElementIds` — registered set of focusable element IDs
- `_tabOrder` — sorted list of focusable IDs (by tabIndex, then y, then x)
- `_focusTraps` — stack of modal focus traps
- `_boundsProvider` — callback to get layout bounds from the rendering engine

### Tab Order

Computed by `_updateTabOrder()`:
1. For each registered ID, resolve `FocusableElement` (bounds, disabled, visible)
2. Elements without layout bounds are excluded (e.g., inactive tabs)
3. Sort by `tabIndex` ascending, then `y`, then `x`

### Focus Trapping (Modals)

`trapFocus(options)` pushes a trap onto the stack. While active:
- `_getAccessibleTabOrder()` only returns elements inside the trap container
- `_isElementAccessible()` rejects elements outside the trap
- Both Tab and geometric navigation respect the trap

`releaseFocusTrap(containerId)` removes the trap.

### Element Discovery

`FocusNavigationHandler.findFocusableElements()` walks the element tree:
- Skips invisible branches (`visible: false`, closed dialogs)
- Checks `Focusable` interface (`canReceiveFocus()`)
- Falls back to `isInteractiveElement()` for elements without the interface
- Also searches mermaid subtrees inside markdown components

`syncFocusableElements()` is called each render to keep the registry in sync.

## Geometric Focus Navigation

Arrow keys move focus to the nearest focusable element in the pressed direction. This activates only when no higher-priority handler consumed the arrow key.

### Algorithm (`FocusManager.focusInDirection`)

1. **`arrow-nav` check** — walks ancestors; if any has `arrowNav: 'none'`, returns false
2. **Bounds fallback** — if focused element has no layout bounds, falls back to `focusFirst()`
3. **Enclosure skip** — candidates whose bounds fully contain the current element are skipped (prevents scrollable parents from capturing focus with score 0)
4. **Half-plane filter** — candidate center must be in the correct direction (center-to-center)
5. **Edge-to-edge distance** — compute nearest-edge distances (`edgeDx`, `edgeDy`) between the two element rectangles. Overlapping ranges produce distance 0.
6. **Row/column alignment preference** — if any candidates have `edgeDy === 0` (horizontal nav) or `edgeDx === 0` (vertical nav), meaning their cross-axis ranges overlap, only those are considered
7. **Weighted distance** — `edgeDx + 3·edgeDy` for horizontal, `3·edgeDx + edgeDy` for vertical. Lowest score wins.

Edge-to-edge distance gives better results than center-to-center for elements of different sizes — a large element adjacent to the current one scores lower than a small element far away, even if the small element's center happens to be closer.

The alignment preference prevents pressing Right from jumping to a closer element on a different row (e.g., a wide button below vs a same-row button further right).

### Shift+Arrow Bypass

Shift+Arrow skips the scroll handler (priority 9) and goes directly to geometric navigation. This lets users escape scrollable containers without pressing repeatedly to the scroll boundary.

### `arrow-nav` Style Property

| Value       | Meaning                                                         |
|-------------|------------------------------------------------------------------|
| `geometric` | Default. Arrow keys fall through to geometric nav when unhandled |
| `none`      | Disable geometric nav for elements inside this container         |

CSS usage: `arrow-nav: none` in `<style>` blocks or `style="arrow-nav: none"` inline.

### Component Interaction

| Component                  | Handles own keyboard          | Geometric nav fires? |
|----------------------------|-------------------------------|----------------------|
| input, textarea            | Yes (explicit type check)     | Never                |
| slider, split-pane-divider | Yes (explicit type check)     | Never                |
| data-table, data-tree      | `handlesOwnKeyboard() = true` | Never                |
| filterable-list (open)     | `handlesOwnKeyboard() = true` | Never                |
| file-browser               | `handlesOwnKeyboard() = true` | Never                |
| container (scrollable)     | No — arrows handled by scroll | After scroll boundary |
| button                     | No keyboard interface         | **Yes**              |
| checkbox, radio            | No keyboard interface         | **Yes**              |

### Edge Cases

| Case                             | Behavior                                             |
|----------------------------------|------------------------------------------------------|
| No element focused               | Focus first element (same as Tab)                    |
| Focused element has no bounds    | Fall back to `focusFirst()`                          |
| No candidate in direction        | Do nothing (don't wrap)                              |
| Focus trap active (modal)        | Only consider elements inside trap container         |
| Same position (overlap)          | Edge-to-edge resolves; nearest wins                  |
| Single-column layout             | Up/Down like Shift+Tab/Tab; Left/Right no-op         |
| Single-row layout                | Left/Right like Shift+Tab/Tab; Up/Down no-op         |
| `tabIndex: -1`                   | Excluded (same as Tab)                               |
| Scroll boundary                  | Plain arrows fall through to geometric nav naturally |
| Shift+Arrow                      | Bypasses scroll, goes straight to geometric nav      |
| Scrollable parent without bounds | Skipped by `findScrollableParent`                    |

## Focusable Scrollable Containers

Scrollable containers (`overflow: scroll` on either axis) implement `Focusable` and appear in tab order. This enables keyboard-only scroll access, even for containers with no interactive children.

### How It Works

`ContainerElement.canReceiveFocus()` returns `true` when `isScrollingEnabled(this)` — i.e., when any axis has `overflow: scroll` or the legacy `scrollable: true` prop. Non-scrollable containers remain non-focusable.

### Focus Indicator

When a scrollable container has focus, its scrollbar gutter highlights using the theme's `focusBorder` color (both thumb and track). The `_renderScrollbars` method in `rendering.ts` compares `element.id` with `context.focusedElementId` and passes a `focused` flag to the scrollbar renderers.

### Keyboard Behavior When Container Is Focused

| Key         | Action                                                  |
|-------------|---------------------------------------------------------|
| Arrow keys  | Scroll the container (via scroll handler, priority 9)   |
| Shift+Arrow | Bypass scroll, geometric nav to another element         |
| Tab         | Move to next focusable element (may be a child inside)  |

### Containers with Focusable Children

Both the container and its children are separate tab stops, sorted by position. This matches web browser behavior where scrollable divs are tab stops.

- **Container focused**: arrows scroll, gutter highlighted
- **Child focused**: arrows scroll parent container (via `findScrollableParent`), gutter NOT highlighted

## Scroll Interaction

`ScrollHandler.findScrollableParent()` walks up the element tree to find the nearest scrollable ancestor. It verifies the container has layout bounds before returning it — containers in inactive tabs or collapsed sections are skipped.

`handleArrowKeyScroll()` returns `true` only if the scroll position actually changed. At a scroll boundary (e.g., already at the bottom), it returns `false`, allowing the arrow key to fall through to geometric navigation. This provides a natural "escape" from scrollable regions.

## Terminal Input Parsing (`src/input.ts`)

### Modifier Encoding

Xterm and Kitty protocol use `1 + bitmask` for modifier parameters:

| Modifier   | Param | Bits (param - 1) |
|------------|-------|-------------------|
| Shift      | 2     | `0001`            |
| Alt        | 3     | `0010`            |
| Shift+Alt  | 4     | `0011`            |
| Ctrl       | 5     | `0100`            |
| Shift+Ctrl | 6     | `0101`            |

The code subtracts 1 before checking bits: `const modBits = param - 1`.

### Escape Sequences

| Sequence          | Meaning                   |
|-------------------|---------------------------|
| `\x1b[A`          | Arrow Up                  |
| `\x1b[1;2A`       | Shift+Arrow Up            |
| `\x1b[1;3A`       | Alt+Arrow Up              |
| `\x1b[1;5A`       | Ctrl+Arrow Up             |
| `\x1b[Z`          | Shift+Tab (hardcoded)     |
| `\x1b[<keycode>;Nu` | Kitty extended key protocol |

## Interfaces

### Focusable (`src/types.ts`)

```typescript
interface Focusable {
  canReceiveFocus(): boolean;
}
```

Elements implementing this are auto-discovered by `findFocusableElements()`.

### KeyboardElement (`src/types.ts`)

```typescript
interface KeyboardElement {
  handlesOwnKeyboard(): boolean;
  onKeyPress(event: KeyPressEvent): boolean;
}
```

When `handlesOwnKeyboard()` returns `true`, the element receives all key events before scroll or geometric nav. Components: data-table, data-tree, filterable-list, file-browser.

### FocusableElement (`src/focus.ts`)

```typescript
interface FocusableElement {
  id: string;
  tabIndex: number;
  disabled: boolean;
  visible: boolean;
  x: number; y: number;
  width: number; height: number;
}
```

Resolved on-demand from the element registry + bounds provider. Used for tab order sorting and geometric distance calculations.

## Command Palette Component Integration

Interactive elements (buttons, inputs, tabs, etc.) are auto-discovered and injected into the command palette (Ctrl+K). The palette can be dragged by its title bar; position resets to center when reopened. When selected, each performs its natural action (click, focus, toggle, switch tab).

### Discovery

`discoverPaletteItems()` in `src/command-palette-components.ts` walks the document tree, collecting qualifying elements:

| Element Type                    | Action           | Group      |
|---------------------------------|------------------|------------|
| `button`, `checkbox`, `radio`   | Trigger onClick  | Actions    |
| `tab`                           | Switch to tab    | Navigation |
| `input`, `textarea`, `slider`   | Focus            | Fields     |
| `select`, `combobox`            | Focus + open     | Fields     |
| `data-table`, `data-tree`       | Focus            | Fields     |

**Label resolution priority:** `palette` prop > `label` > `title` > `aria-label` > `placeholder` > humanized ID. Elements with no resolvable label are skipped.

### Timing

- **`updateUI()`**: Runs discovery + builds shortcut map. Shortcuts work immediately.
- **`toggleCommandPalette()`**: Runs full discovery + injection. Catches dynamic elements (e.g., alert dialog buttons).
- No discovery in the render hot path.

### Palette Shortcuts (Priority 4.5)

Elements can declare global keyboard shortcuts via `palette-shortcut`:

```html
<button label="Save" palette-shortcut="Ctrl+S" onClick=${save}>
```

Shortcuts are normalized (lowercase, sorted modifiers: `alt+ctrl+s`). Conflicts with system keys are logged and skipped. Duplicate component shortcuts: first in tree order wins.

### Props

| Prop               | Type              | Description                                    |
|--------------------|-------------------|------------------------------------------------|
| `palette`          | `boolean\|string` | `false` to exclude; string to set custom label |
| `palette-shortcut` | `string`          | Global keyboard shortcut (e.g., `"Ctrl+S"`)   |
| `palette-group`    | `string`          | Override default group name                    |

See [`examples/basics/palette-demo.melker`](../examples/basics/palette-demo.melker) for a working demo.

## Future Enhancements

- **Nested scroll chain** — Walk up multiple scrollable parents before falling through to geometric nav
