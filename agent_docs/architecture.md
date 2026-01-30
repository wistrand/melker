# Architecture

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

Default layout is flexbox with column direction.

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

## Style Inheritance

Only these properties inherit to children:
- `color`, `backgroundColor`, `fontWeight`, `borderColor`

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

| Component       | File                                 | Notes                             |
|-----------------|--------------------------------------|-----------------------------------|
| Container       | `container.ts`                       | Flexbox layout, scrolling         |
| Text            | `text.ts`                            | Text display with wrapping        |
| Input           | `input.ts`                           | Single-line text input            |
| Textarea        | `textarea.ts`                        | Multi-line text input             |
| Button          | `button.ts`                          | Uses `label` prop or content      |
| Dialog          | `dialog.ts`                          | Modal overlay, draggable          |
| Canvas          | `canvas.ts`                          | Pixel graphics, onPaint, onShader |
| Img             | `img.ts`                             | Image display (PNG/JPEG/GIF)      |
| Video           | `video.ts`                           | Video playback via FFmpeg         |
| Markdown        | `markdown.ts`                        | Markdown with image support       |
| Checkbox        | `checkbox.ts`                        | Toggle checkbox                   |
| Radio           | `radio.ts`                           | Radio button                      |
| List/Li         | `list.ts`, `li.ts`                   | List container and items          |
| Table           | `table.ts`                           | Data table with sections          |
| Data Table      | `data-table.ts`                      | High-performance array-based      |
| Tabs/Tab        | `tabs.ts`, `tab.ts`                  | Tabbed interface                  |
| Progress        | `progress.ts`                        | Progress bar                      |
| Slider          | `slider.ts`                          | Range input                       |
| Combobox        | `filterable-list/combobox.ts`        | Dropdown with filter              |
| Select          | `filterable-list/select.ts`          | Dropdown picker                   |
| Autocomplete    | `filterable-list/autocomplete.ts`    | Async search                      |
| Command Palette | `filterable-list/command-palette.ts` | Modal commands                    |
| File Browser    | `file-browser/file-browser.ts`       | Directory navigation              |

## Key Files

| File               | Purpose                        |
|--------------------|--------------------------------|
| `src/engine.ts`    | Main engine, lifecycle, events |
| `src/layout.ts`    | Flexbox layout calculations    |
| `src/rendering.ts` | Render pipeline, overlays      |
| `src/buffer.ts`    | Dual-buffer system             |
| `src/renderer.ts`  | ANSI terminal output           |
| `src/focus.ts`     | Focus management               |
| `src/theme.ts`     | Theming system                 |
| `src/input.ts`     | Raw terminal input, mouse      |
| `src/template.ts`  | .melker file parsing           |
| `src/element.ts`   | Element creation, registry     |
| `src/document.ts`  | Document class                 |
| `src/events.ts`    | Event system                   |
| `src/types.ts`     | Core type definitions          |
| `src/sizing.ts`    | Box model                      |
| `src/viewport.ts`  | Scrolling support              |

## See Also

- [component-reference.md](component-reference.md) — Component details, layout gotchas
- [fast-input-render.md](fast-input-render.md) — Fast render path
- [dirty-row-tracking.md](dirty-row-tracking.md) — Buffer optimization
- [graphics-architecture.md](graphics-architecture.md) — Graphics pipeline
