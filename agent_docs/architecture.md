# Architecture

## Summary

- Melker renders a tree of **elements** (like HTML) to the terminal using a **dual-buffer** system (character + style buffers) — only changed rows are re-output
- Layout uses **flexbox** (column default) with border-box sizing, percentage/fill/auto widths, and flex-wrap
- Elements are created with `createElement(type, props, ...children)` and held in a `Document`
- The **render pipeline** runs at ~60fps: event → state change → layout → buffer render → diff → ANSI output
- A **fast render** path gives ~2ms latency for text input (skips full layout, uses cached bounds)
- **Theming** is CSS-based with `var()` custom properties; apps don't need to specify colors
- **Animations** use a centralized timer (`UIAnimationManager`) with adaptive tick rates and drift correction
- Style **inheritance** is limited: only `color`, `backgroundColor`, `fontWeight`, `fontStyle`, `textDecoration`, `dim`, `reverse`, `borderColor`

## Core Concepts

- **Document Model**: HTML-inspired elements with React-like createElement pattern, JSON serializable
- **Dual-Buffer Rendering**: Character buffer + style buffer for efficient ANSI output, with dirty row tracking
- **Flexbox Layout**: Single layout engine with flex-wrap, border-box sizing
- **Theming**: Configurable via `--theme` flag, `MELKER_THEME` env, or config file

## Element System

### Core Types (`src/types.ts`)

```
Element (abstract base class)
├── type: string         - Component type name
├── props: Record        - Component properties
├── children?: Element[] - Child elements
├── id: string           - Unique identifier
├── _bounds: Bounds|null - Layout bounds (set during render)
├── getBounds()          - Get element's layout bounds
└── setBounds(bounds)    - Set element's layout bounds
```

**Interfaces:**
- `Renderable` - Has `render()` and `intrinsicSize()` methods
- `Focusable` - Can receive keyboard focus
- `Clickable` - Handles click events
- `Draggable` - Handles mouse drag
- `Wheelable` - Handles mouse wheel events

**Type Guards:**
- `isRenderable(el)`, `isFocusable(el)`, `isClickable(el)`, etc.
- Use duck-typing: check if method exists, then call it

The `Element` abstract base class is defined in `src/types.ts`. The concrete `BasicElement` implementation and `createElement()` factory live in `src/element.ts`.

### Element Creation (`src/element.ts`)

```typescript
const button = createElement('button', { label: 'Click' });
const container = createElement('container', { style: { display: 'flex' } }, button);
```

**Key functions:**
- `createElement(type, props, ...children)` - Create element
- `registerComponent(definition)` - Register custom component
- `findElementById(root, id)` - Find element in tree
- `cloneElement(element, newProps)` - Clone with merged props

### Document Model (`src/document.ts`)

```typescript
const doc = new Document(rootElement);
doc.getElementById('myButton');
doc.getElementsByType('button');
doc.focus('inputId');
```

## Layout Engine (`src/layout.ts`)

### Layout Process

1. **Style computation** - Merge element style with parent inheritance
2. **Layout props** - Extract layout-related properties
3. **Bounds calculation** - Determine position and size
4. **Box model** - Calculate content/padding/border/margin
5. **Children layout** - Recursively layout children

### Flexbox

The root viewport, `container`, `dialog`, and `tab` elements all default to `display: flex` with `flexDirection: column`.

**Container properties:**
- `display`: `'flex'` | `'block'`
- `flexDirection`: `'row'` | `'column'` | `'row-reverse'` | `'column-reverse'`
- `flexWrap`: `'nowrap'` | `'wrap'` | `'wrap-reverse'`
- `justifyContent`: `'flex-start'` | `'center'` | `'flex-end'` | `'space-between'` | `'space-around'`
- `alignItems`: `'stretch'` | `'flex-start'` | `'center'` | `'flex-end'`

**Item properties:**
- `flex`: Shorthand (`'1'`, `'1 1 auto'`)
- `flexGrow`, `flexShrink`, `flexBasis`
- `alignSelf`: Override parent's alignItems

**Note:** `display: 'flex'` is auto-inferred when flex container properties are present.

### Sizing (`src/sizing.ts`)

Uses **border-box** model (width/height include padding and border).

**Size values:**
- Number: Fixed character width/height
- `'auto'`: Size to content
- `'fill'`: Expand to fill remaining space
- `'NN%'`: Percentage of parent

**`fill` vs percentage:**
- `fill` takes remaining space after siblings
- `100%` always means 100% of parent

### Box Model

```
┌─────────────────────────────────┐
│           margin                │
│  ┌───────────────────────────┐  │
│  │         border            │  │
│  │  ┌─────────────────────┐  │  │
│  │  │      padding        │  │  │
│  │  │  ┌───────────────┐  │  │  │
│  │  │  │    content    │  │  │  │
│  │  │  └───────────────┘  │  │  │
│  │  └─────────────────────┘  │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

## Render Pipeline

Two render paths:

**Full Render** (debounced 16ms):
```
Event → State change → Layout → Buffer render → Swap → Terminal
```

**Fast Render** (immediate, for Input/Textarea):
```
Keystroke → Update state → Render to buffer (cached bounds) → Output diff
                         ↓
                         Schedule full render (16ms debounce)
```

Fast render provides ~2ms latency. See [fast-input-render.md](fast-input-render.md).

**Dirty row tracking:** Only changed rows are scanned during diff. See [dirty-row-tracking.md](dirty-row-tracking.md).

## UI Animation Manager (`src/ui-animation-manager.ts`)

Centralized timer for UI animations. Components register callbacks instead of creating individual timers.

**Benefits:**
- Single timer reduces overhead
- Batched render calls
- Adaptive tick interval based on registered animations
- Drift correction maintains timing accuracy

**Adaptive Tick (Nyquist-based):**
```
tick = max(MIN_TICK, min(all intervals) / 2)
```

| Scenario                     | Min interval | Tick interval |
|------------------------------|--------------|---------------|
| Fast animation (scroll 24ms) | 24ms         | 12ms          |
| Slow animations only (50ms+) | 50ms         | 25ms          |
| No animations                | --           | Timer stopped |

**Drift Correction:**

Animations stay on schedule despite timing jitter:
```
lastTick += interval    // Advance by interval (drift correction)
if (now - lastTick > interval)
  lastTick = now        // Reset if >1 interval behind (avoid catch-up spam)
```

| Scenario                   | Behavior                           |
|----------------------------|------------------------------------|
| Normal jitter (< interval) | Catches up to ideal schedule       |
| Major delay (> interval)   | Fires once, resets, no rapid-fire  |

**Usage:**
```typescript
const manager = getUIAnimationManager();
const unregister = manager.register('my-animation', (elapsed) => {
  updateFrame();
  manager.requestRender();
}, 100); // 100ms interval

// Cleanup
unregister();
```

**Components using UIAnimationManager:**
- `spinner` - Rotating indicator (`spinning` prop)
- `progress` - Indeterminate mode (`indeterminate` prop)
- `segment-display` - Scrolling text (`scroll` prop)

## Style Inheritance

Only these properties inherit to children:
- `color`, `backgroundColor`, `fontWeight`, `fontStyle`, `textDecoration`, `dim`, `reverse`, `borderColor`

Layout properties (borders, padding, margin) do NOT cascade.

## Critical Implementation Notes

### Initialization Order

**CRITICAL**: Raw mode MUST be enabled BEFORE terminal setup.

```
1. Enable raw mode - _inputProcessor.startListening()
2. Setup event handlers - _setupEventHandlers()
3. Terminal setup LAST - _setupTerminal()
```

Wrong order causes `ENOTTY` errors.

### Engine Stop Sequence

When `stop()` is called:
1. `_isInitialized` set to `false` FIRST
2. Video elements stopped
3. Input/resize/debug stopped
4. Terminal cleanup

**Render guards** check `_isInitialized` before all output to prevent garbage after exit.

### Error Handling

- Exit with full stack traces on fatal errors
- Restore terminal before error output
- Rate-limit component errors (5/sec max)

## Components

| Component       | File                                 | Notes                              |
|-----------------|--------------------------------------|------------------------------------|
| Container       | `container.ts`                       | Flexbox layout, scrolling          |
| Text            | `text.ts`                            | Text display with wrapping         |
| Input           | `input.ts`                           | Single-line text input             |
| Textarea        | `textarea.ts`                        | Multi-line text input              |
| Button          | `button.ts`                          | Uses `label` prop or content       |
| Dialog          | `dialog.ts`                          | Modal overlay, draggable           |
| Canvas          | `canvas.ts`                          | Pixel graphics, onPaint, onShader  |
| Img             | `img.ts`                             | Image display (PNG/JPEG/GIF/WebP)  |
| Video           | `video.ts`                           | Video playback via FFmpeg          |
| Markdown        | `markdown.ts`                        | Markdown with image support        |
| Checkbox        | `checkbox.ts`                        | Toggle checkbox                    |
| Radio           | `radio.ts`                           | Radio button                       |
| List/Li         | `list.ts`, `li.ts`                   | List container and items           |
| Table           | `table.ts`, `table-*.ts`             | Data table with sections           |
| Data Table      | `data-table.ts`                      | High-performance array-based       |
| Tabs/Tab        | `tabs.ts`, `tab.ts`                  | Tabbed interface                   |
| Progress        | `progress.ts`                        | Progress bar, indeterminate mode   |
| Spinner         | `spinner.ts`                         | Loading indicator                  |
| Segment Display | `segment-display/segment-display.ts` | LCD-style digits, scrolling        |
| Slider          | `slider.ts`                          | Range input                        |
| Combobox        | `filterable-list/combobox.ts`        | Dropdown with filter               |
| Select          | `filterable-list/select.ts`          | Dropdown picker                    |
| Autocomplete    | `filterable-list/autocomplete.ts`    | Async search                       |
| Command Palette | `filterable-list/command-palette.ts` | Modal commands                     |
| File Browser    | `file-browser/file-browser.ts`       | Directory navigation               |

## Key Files

| File                              | Purpose                                    |
|-----------------------------------|--------------------------------------------|
| `src/engine.ts`                   | Main engine, lifecycle, render orchestration |
| `src/engine-keyboard-handler.ts`  | Keyboard event handling                    |
| `src/engine-mouse-handler.ts`     | Mouse and wheel event handling             |
| `src/engine-buffer-overlays.ts`   | Buffer overlay rendering pipeline          |
| `src/engine-dialog-utils.ts`      | Dialog traversal and focus trap utilities   |
| `src/engine-system-palette.ts`    | System command palette logic               |
| `src/command-palette-components.ts` | Palette component discovery, shortcuts   |
| `src/graphics-overlay-manager.ts` | Sixel/Kitty/iTerm2 graphics overlay management |
| `src/terminal-size-manager.ts`    | Terminal size detection, tracking, resize   |
| `src/dialog-coordinator.ts`       | Alert, confirm, prompt dialog lifecycle    |
| `src/base-dialog.ts`             | Base class for dialog managers             |
| `src/scroll-handler.ts`          | Scroll event handling for containers       |
| `src/element-click-handler.ts`   | Element click routing and focus            |
| `src/focus-navigation-handler.ts` | Tab, arrow key, and geometric focus navigation |
| `src/text-selection-handler.ts`  | Mouse text selection and hover tracking    |
| `src/state-persistence-manager.ts`| App state auto-save/restore                |
| `src/layout.ts`                   | Flexbox layout calculations                |
| `src/rendering.ts`                | Render pipeline, overlays                  |
| `src/buffer.ts`                   | Dual-buffer system, `DiffCollector`        |
| `src/renderer.ts`                 | ANSI terminal output                       |
| `src/focus.ts`                    | Focus management, geometric navigation     |
| `src/theme.ts`                    | Theming system                             |
| `src/input.ts`                    | Raw terminal input, mouse, modifier parsing |
| `src/template.ts`                 | .melker file parsing                       |
| `src/element.ts`                  | Element creation, registry                 |
| `src/document.ts`                 | Document class                             |
| `src/events.ts`                   | Event system                               |
| `src/types.ts`                    | Core type definitions                      |
| `src/sizing.ts`                   | Box model                                  |
| `src/viewport.ts`                 | Scrolling support                          |
| `src/ui-animation-manager.ts`     | Centralized animation timer                |

## See Also

- [component-reference.md](component-reference.md) — Component details, layout gotchas
- [fast-input-render.md](fast-input-render.md) — Fast render path
- [dirty-row-tracking.md](dirty-row-tracking.md) — Buffer optimization
- [graphics-architecture.md](graphics-architecture.md) — Graphics pipeline
- [benchmark-architecture.md](benchmark-architecture.md) — Performance benchmarking
