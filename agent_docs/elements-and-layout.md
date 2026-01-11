# Elements and Layout

How Melker's element system and layout engine work.

## Element System

### Core Types (`src/types.ts`)

```
Element (abstract base class)
├── type: string         - Component type name
├── props: Record        - Component properties
├── children?: Element[] - Child elements
├── id: string           - Unique identifier (auto-generated if not provided)
├── _bounds: Bounds|null - Layout bounds (set during render)
├── getBounds()          - Get element's layout bounds after render
└── setBounds(bounds)    - Set element's layout bounds (called by renderer)
```

**Component Interfaces:**
- `Renderable` - Has `render()` and `intrinsicSize()` methods
- `Focusable` - Can receive keyboard focus
- `Clickable` - Handles click events with `onClick()`
- `Interactive` - Handles keyboard events with `handleKeyPress()`
- `TextSelectable` - Supports text selection
- `Draggable` - Handles mouse drag (scrollbars, resizers, dialogs)
- `Wheelable` - Handles mouse wheel events (scrollable tbody)

**Type Guards:**
- `isRenderable(el)`, `isFocusable(el)`, `isClickable(el)`, etc.
- `isScrollableType(type)` - Returns true for 'container' or 'tbody'

### Element Creation (`src/element.ts`)

```typescript
// Create elements via createElement()
const button = createElement('button', { title: 'Click' });
const container = createElement('container', { style: { display: 'flex' } }, button);
```

**Key functions:**
- `createElement(type, props, ...children)` - Create element (uses component registry)
- `registerComponent(definition)` - Register custom component class
- `findElementById(root, id)` - Find element in tree
- `cloneElement(element, newProps)` - Clone with merged props
- `traverseElements(root, callback)` - Walk element tree

### Component Registry

Components are registered with `registerComponent()`. Registered components use their class constructor; unregistered types become `BasicElement`.

See `src/components/*.ts` for component implementations.

## Document Model (`src/document.ts`)

The `Document` class manages runtime state:

```typescript
const doc = new Document(rootElement);
doc.getElementById('myButton');    // Lookup by ID
doc.getElementsByType('button');   // Find all of type
doc.focus('inputId');              // Focus element
doc.focusedElement;                // Current focus
```

**Features:**
- Element registry (id → Element map)
- Focus tracking
- Event listener management

## Layout Engine (`src/layout.ts`)

### Layout Process

1. **Style computation** - Merge element style with parent inheritance
2. **Layout props** - Extract layout-related properties
3. **Bounds calculation** - Determine position and size
4. **Box model** - Calculate content/padding/border/margin
5. **Children layout** - Recursively layout children (flex or block)

### LayoutNode Structure

```
LayoutNode
├── element: Element
├── bounds: { x, y, width, height }      - Element position/size
├── contentBounds: Bounds                 - Inner content area
├── visible: boolean
├── children: LayoutNode[]
├── computedStyle: Style
├── layoutProps: AdvancedLayoutProps
├── boxModel: BoxModel
└── zIndex: number
```

### Flexbox Layout

Default layout is flexbox with column direction.

**Container properties:**
- `display`: `'flex'` | `'block'`
- `flexDirection`: `'row'` | `'column'` | `'row-reverse'` | `'column-reverse'`
- `flexWrap`: `'nowrap'` | `'wrap'` | `'wrap-reverse'`
- `justifyContent`: `'flex-start'` | `'center'` | `'flex-end'` | `'space-between'` | `'space-around'`
- `alignItems`: `'stretch'` | `'flex-start'` | `'center'` | `'flex-end'`

**Item properties:**
- `flex`: Shorthand (`'1'`, `'1 1 auto'`, `'0 0 auto'`)
- `flexGrow`, `flexShrink`, `flexBasis`: Individual flex properties
- `alignSelf`: Override parent's alignItems

### Flex Layout Gotchas

**1. `display: 'flex'` is auto-inferred** *(Build 142+)*

When flex container properties are present (`flexDirection`, `justifyContent`, `alignItems`, `alignContent`, `flexWrap`, `gap`), `display: 'flex'` is automatically inferred:

```typescript
// Both work - display: flex is auto-inferred from flexDirection
{ flexDirection: 'column', width: 'fill', height: 'fill' }
{ display: 'flex', flexDirection: 'column', width: 'fill', height: 'fill' }
```

Note: Flex *item* properties (`flex`, `flexGrow`, `flexShrink`, `flexBasis`) don't trigger auto-inference.

**2. `flexDirection: 'row'` must be explicit for horizontal layouts**

The layout code checks `flexDirection === 'row'` explicitly. If `flexDirection` is undefined, it's treated as column layout:

```typescript
// In layout.ts:
const isRow = flexProps.flexDirection === 'row' || flexProps.flexDirection === 'row-reverse';
// undefined !== 'row', so isRow = false
```

For `justifyContent: 'flex-end'` to align items horizontally (right), you need explicit row direction:

```typescript
// WRONG - justifyContent works vertically (column is assumed)
{ display: 'flex', justifyContent: 'flex-end' }

// CORRECT - justifyContent works horizontally
{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end' }
```

**3. Container needs width for horizontal justification**

For `justifyContent` to work, the container needs space to distribute. Add `width: 'fill'`:

```typescript
// Right-aligned button in a footer
{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', width: 'fill' }
```

**4. Complete example: Footer with right-aligned button**

```typescript
const footer = createElement('container', {
  style: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    width: 'fill',
    height: 1,
    flexShrink: 0  // Prevent shrinking in column parent
  }
}, closeButton);
```

### Sizing (`src/sizing.ts`)

Uses **border-box** model by default (like modern CSS):
- `width`/`height` include padding and border
- Content area = total - padding - border

**Size values:**
- Number: Fixed character width/height (e.g., `width="40"`)
- `'auto'`: Size to content
- `'fill'`: Expand to fill *remaining* available space
- `'NN%'`: Percentage of parent's available space (e.g., `width="50%"`)

**`fill` vs percentage:**
- `fill` is context-aware - takes remaining space after siblings
- `100%` always means 100% of parent, regardless of siblings

```xml
<!-- fill takes remaining 80% -->
<container style="display: flex; flexDirection: row">
  <text width="20%">Sidebar</text>
  <container width="fill">Main content</container>
</container>

<!-- 100% would cause overflow (20% + 100% = 120%) -->
```

**Table column widths:**
Use `width` on `<th>` elements for O(1) column sizing (skips row sampling):
```xml
<thead>
  <tr>
    <th width="20%">Name</th>
    <th width="10%">Status</th>
    <th width="fill">Description</th>
  </tr>
</thead>
```

### Box Model

```
┌─────────────────────────────┐
│         margin              │
│  ┌───────────────────────┐  │
│  │       border          │  │
│  │  ┌─────────────────┐  │  │
│  │  │    padding      │  │  │
│  │  │  ┌───────────┐  │  │  │
│  │  │  │  content  │  │  │  │
│  │  │  └───────────┘  │  │  │
│  │  └─────────────────┘  │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

### Chrome Collapse

When an element has insufficient space for content due to border and padding consuming all available space, Melker progressively collapses "chrome" (padding first, then border) to preserve minimum content space.

**Collapse Order:**
1. **Padding collapse** - Reduced proportionally per side
2. **Border collapse** - Individual borders removed if still insufficient

**Behavior:**
- Silent collapse with debug logging (`SizingModel: Chrome collapsed: bounds=...`)
- Inner containers collapse before outer (natural with recursive layout)
- Minimum content area: 1 character
- No visual indicator - collapsed elements simply render smaller

**Example:**
```xml
<!-- With height: 3, border: thin (2), padding: 1 (2) = 4 chars chrome -->
<!-- Only 3 available, so padding collapses to fit -->
<container style="width: 12; height: 3; border: thin; padding: 1;">
  <text>Content</text>
</container>
```

**Implementation:**
- `src/sizing.ts`: `ChromeCollapseState` interface, `calculateContentBounds()` logic
- `src/layout.ts`: `chromeCollapse` field in `LayoutNode`
- `src/rendering.ts`: `_renderBorder()` skips collapsed borders

## Tabs Component

The `<tabs>` component provides a tabbed interface with clickable tab headers.

### Usage

```xml
<tabs id="settings" activeTab="0">
  <tab title="General">
    <text>General settings content</text>
  </tab>
  <tab title="Advanced">
    <text>Advanced settings content</text>
  </tab>
  <tab title="About">
    <text>About content</text>
  </tab>
</tabs>
```

### Props

**Tabs container:**
- `id` - Element identifier
- `activeTab` - Index of active tab (0-based)
- `onTabChange` - Handler called when tab changes

**Tab panel:**
- `title` - Tab header text (required)
- `disabled` - Disable tab selection

### Behavior

- Tab headers render as a button row: `│ General │ Advanced │ About │`
- Active tab is bold, focused tab is underlined
- Navigate with Tab/Shift+Tab, activate with Enter or click
- Default tab style includes `border: thin; margin-top: 1`

## Table Component

The `<table>` component provides data tables with optional scrollable body.

### Usage

```xml
<table id="users" style="width: fill; height: 20;">
  <thead>
    <tr>
      <th>Name</th>
      <th>Email</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody scrollable="true">
    <tr>
      <td>Alice</td>
      <td>alice@example.com</td>
      <td>Active</td>
    </tr>
    <tr>
      <td>Bob</td>
      <td>bob@example.com</td>
      <td>Inactive</td>
    </tr>
  </tbody>
</table>
```

### Structure

- `<table>` - Root container, handles column width calculation
- `<thead>` - Fixed header section (not scrollable)
- `<tbody>` - Data rows, supports `scrollable="true"` for scrolling
- `<tfoot>` - Fixed footer section (not scrollable)
- `<tr>` - Table row
- `<td>` / `<th>` - Table cells (th renders bold)

### Props

**Table:**
- `style.width` / `style.height` - Table dimensions
- Standard container styling

**tbody:**
- `scrollable` - Enable vertical scrolling when content exceeds height

### Behavior

- Column widths are calculated from max content width across all sections
- tbody scrolling uses the same scrollbar system as containers
- Wheel events are handled by the tbody element (Wheelable interface)
- Click events on cells bubble to the table element for hit testing

### Implementation Files

| File | Purpose |
|------|---------|
| `src/components/table.ts` | Table container, column width calc |
| `src/components/table-section.ts` | thead/tbody/tfoot sections |
| `src/components/table-row.ts` | Row container |
| `src/components/table-cell.ts` | td/th cells |

## Dialog Component

The `<dialog>` component provides modal overlay dialogs.

### Usage

```xml
<dialog id="settings" title="Settings" open=${true} modal=${true}>
  <text>Dialog content</text>
  <button title="Close" onClick="dialog.props.open = false" />
</dialog>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | string | - | Title bar text |
| `open` | boolean | false | Whether dialog is visible |
| `modal` | boolean | true | Block interaction with background |
| `backdrop` | boolean | true | Show semi-transparent backdrop |
| `width` | number | 80% | Width (0-1 = percentage, >1 = chars) |
| `height` | number | 70% | Height (0-1 = percentage, >1 = chars) |
| `draggable` | boolean | false | Allow dragging by title bar |
| `offsetX` | number | 0 | Horizontal offset from center |
| `offsetY` | number | 0 | Vertical offset from center |

### Draggable Dialogs

When `draggable={true}`, users can click and drag the title bar to move the dialog:

```xml
<dialog id="movable" title="Drag me!" draggable=${true} open=${true}>
  <text>This dialog can be moved around</text>
</dialog>
```

The dialog position is stored in `offsetX` and `offsetY` props, which persist the drag offset from the centered position.

## Filterable List Components

A family of searchable/selectable list components built on a shared `FilterableListCore` base.

See `agent_docs/filterable-list-architecture.md` for implementation details.

### Components

| Component | Description |
|-----------|-------------|
| `<combobox>` | Inline dropdown with text filter |
| `<select>` | Dropdown picker without filter |
| `<autocomplete>` | Combobox with async loading |
| `<command-palette>` | Modal command picker |

### Child Elements

| Element | Description |
|---------|-------------|
| `<option>` | Selectable item (value, disabled, shortcut) |
| `<group>` | Groups options under a header |

### Quick Examples

```xml
<!-- Combobox with text filtering -->
<combobox placeholder="Select country..." onSelect="$app.setCountry(event.value)">
  <option value="us">United States</option>
  <option value="uk">United Kingdom</option>
</combobox>

<!-- Simple select dropdown -->
<select value="medium" onSelect="$app.setSize(event.value)">
  <option value="small">Small</option>
  <option value="medium">Medium</option>
  <option value="large">Large</option>
</select>

<!-- Autocomplete with async search -->
<autocomplete
  placeholder="Search users..."
  onSearch="$app.searchUsers(event.query)"
  onSelect="$app.selectUser(event)"
  debounce="300"
/>

<!-- Command palette -->
<command-palette open="${$app.showPalette}" onSelect="$app.runCommand(event.value)">
  <group label="File">
    <option value="file.new" shortcut="Ctrl+N">New File</option>
  </group>
</command-palette>
```

### Key Props (shared)

| Prop | Type | Description |
|------|------|-------------|
| `open` | boolean | Dropdown visibility |
| `filter` | string | 'fuzzy', 'prefix', 'contains', 'exact', 'none' |
| `maxVisible` | number | Max dropdown height (default: 8) |
| `onSelect` | function | Called when option selected |

### Implementation Files

| File | Purpose |
|------|---------|
| `src/components/filterable-list/core.ts` | Shared base class |
| `src/components/filterable-list/combobox.ts` | Combobox component |
| `src/components/filterable-list/select.ts` | Select component |
| `src/components/filterable-list/autocomplete.ts` | Autocomplete component |
| `src/components/filterable-list/command-palette.ts` | Command palette component |
| `src/components/filterable-list/filter.ts` | Fuzzy/prefix/contains matching |

## File Browser Component

The `<file-browser>` component provides file system navigation for selecting files and directories.

### Usage

```xml
<dialog id="file-dialog" title="Open File" open="false" modal="true" width="70" height="20">
  <file-browser
    id="fb"
    selectionMode="single"
    selectType="file"
    onSelect="$app.handleSelect(event)"
    onCancel="$app.closeDialog()"
    maxVisible="12"
  />
</dialog>
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `path` | string | cwd | Initial directory |
| `selectionMode` | string | 'single' | 'single' or 'multiple' |
| `selectType` | string | 'file' | 'file', 'directory', or 'both' |
| `filter` | string | 'fuzzy' | Filter mode |
| `showHidden` | boolean | false | Show dotfiles |
| `maxVisible` | number | 10 | Visible rows |

### Events

| Event | Properties | Description |
|-------|------------|-------------|
| `onSelect` | path, paths, isDirectory | File/dir selected |
| `onCancel` | - | Cancelled |
| `onNavigate` | path | Navigated to directory |
| `onError` | code, message | Error occurred |

### Keyboard

- Arrow keys: Navigate list
- Enter: Open directory / select file
- Backspace: Parent directory
- Escape: Cancel
- Type: Filter entries

### Implementation Files

| File | Purpose |
|------|---------|
| `src/components/file-browser/file-browser.ts` | Main component |
| `src/components/file-browser/file-entry.ts` | Type definitions |
| `src/components/file-browser/file-utils.ts` | Directory loading utilities |

See `agent_docs/file-browser-architecture.md` for detailed architecture.

## Progress Component

The `<progress>` component displays a progress bar using canvas pixels for smooth sub-character fill.

### Usage

```xml
<progress value="50" width="25" />
<progress value="75" showValue="true" />
<progress indeterminate="true" fillColor="cyan" />
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | number | 0 | Current progress value |
| `max` | number | 100 | Maximum value |
| `min` | number | 0 | Minimum value |
| `width` | number | 20 | Bar width in terminal columns |
| `height` | number | 1 | Bar height in terminal rows |
| `showValue` | boolean | false | Display percentage text after bar |
| `indeterminate` | boolean | false | Show animated loading state |
| `fillColor` | string | theme | Color for filled portion |
| `emptyColor` | string | theme | Color for empty portion |
| `animationSpeed` | number | 50 | Indeterminate animation speed (ms) |

### Behavior

- Extends `CanvasElement` for pixel-level rendering (2x3 pixels per character)
- Uses sextant characters for smooth sub-character fill resolution
- Theme-aware defaults: B&W uses black/white, color uses green/#aaa
- `flexShrink: 0` prevents layout compression below specified dimensions
- Indeterminate mode shows animated sliding pulse

### Methods

```typescript
const progress = document.getElementById('myProgress');
progress.setValue(75);           // Set progress value
progress.getValue();             // Get current value
progress.setIndeterminate(true); // Enable/disable indeterminate mode
```

## Slider Component

The `<slider>` component allows numeric value selection within a range using keyboard or mouse.

### Usage

```xml
<!-- Basic slider -->
<slider min="0" max="100" value="50" onChange="$app.handleChange(event)" />

<!-- With step increments -->
<slider min="0" max="10" step="1" value="5" showValue="true" />

<!-- With snap points -->
<slider min="0" max="100" snaps="[0, 25, 50, 75, 100]" value="25" />

<!-- Vertical orientation -->
<slider min="0" max="100" value="50" orientation="vertical" style="height: 8;" />
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `min` | number | 0 | Minimum value |
| `max` | number | 100 | Maximum value |
| `value` | number | 0 | Current value |
| `step` | number | - | Discrete step size (e.g., 5 = values 0,5,10...) |
| `snaps` | number[] | - | Array of specific snap points |
| `orientation` | string | 'horizontal' | 'horizontal' or 'vertical' |
| `showValue` | boolean | false | Display value label after slider |
| `onChange` | function | - | Called when value changes |

### Keyboard Navigation

| Key | Action |
|-----|--------|
| Arrow Left/Down | Decrease by step (or to previous snap) |
| Arrow Right/Up | Increase by step (or to next snap) |
| Page Down | Decrease by 10% of range |
| Page Up | Increase by 10% of range |
| Home | Jump to minimum |
| End | Jump to maximum |

### Visual

```
▓▓▓▓▓▓▓●────────── 50    (horizontal with showValue)
```

- Focused slider shows thumb with reverse video (inverted colors)
- Theme-aware: Unicode characters for color themes, ASCII for B&W

### Methods

```typescript
const slider = document.getElementById('mySlider');
slider.setValue(75);    // Set value programmatically
slider.getValue();      // Get current value
```

## Image Component

The `<img>` component displays images in the terminal using sextant characters (2x3 pixels per cell).

### Usage

```xml
<!-- Fixed dimensions -->
<img src="media/image.png" width="30" height="15" />

<!-- Percentage dimensions (responsive) -->
<img src="media/image.png" width="100%" height="10" />

<!-- With object-fit mode -->
<img src="media/image.png" width="40" height="20" objectFit="contain" />
```

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | string | - | Image source path (required) |
| `alt` | string | - | Alternative text for accessibility |
| `width` | number \| string | 30 | Width in columns or percentage (e.g., "50%") |
| `height` | number \| string | 15 | Height in rows or percentage (e.g., "50%") |
| `objectFit` | string | 'fill' | How image fits: 'contain' (preserve aspect), 'fill' (stretch), 'cover' (crop) |
| `dither` | string | 'auto' | Dithering mode for limited-color themes |
| `ditherBits` | number | - | Color depth for dithering (1-8) |
| `onLoad` | function | - | Called when image loads successfully |
| `onError` | function | - | Called when image fails to load |
| `onShader` | function | - | Per-pixel shader callback (see Shaders section) |
| `shaderFps` | number | 30 | Shader frame rate |
| `shaderRunTime` | number | - | Stop shader after this many ms, freeze final frame as image |

### Shaders

The `<img>` and `<canvas>` components support per-pixel shader callbacks for animated effects:

```xml
<img
  src="image.png"
  width="100%"
  height="100%"
  onShader="$app.myShader"
  shaderFps="30"
  shaderRunTime="5000"
/>
```

The shader callback receives:
- `x, y`: Pixel coordinates
- `time`: Elapsed time in seconds
- `resolution`: `{ width, height, pixelAspect }` - pixelAspect is ~0.5 (pixels are taller than wide)
- `source`: Image accessor with `getPixel(x, y)`, `mouse`, `mouseUV`
- `utils`: Built-in functions: `noise2d`, `fbm`, `palette`, `smoothstep`, `mix`, `fract`

Returns `[r, g, b]` or `[r, g, b, a]` (0-255 range).

**Aspect-correct circles/shapes**: Divide y by `pixelAspect`:
```typescript
const dist = Math.sqrt(dx*dx + (dy/resolution.pixelAspect)**2);
```

**shaderRunTime**: When set, the shader stops after the specified milliseconds and the final frame is preserved as a static image that supports resize.

**Permission**: Requires `"shader": true` in the app's policy.

### Behavior

- Extends `CanvasElement` - inherits all canvas rendering capabilities
- Supports percentage dimensions for responsive sizing (recalculates on container resize)
- Pre-blends semi-transparent pixels with black background during image load
- `objectFit: 'fill'` stretches to fill dimensions (default, like HTML img)
- `objectFit: 'contain'` preserves aspect ratio within bounds
- `objectFit: 'cover'` fills dimensions, cropping as needed
- `dither: 'auto'` applies appropriate dithering based on theme (sierra-stable for B&W/color, none for fullcolor)
- Fixed-dimension images use `flexShrink: 0` to prevent layout compression
- Percentage-dimension images are responsive and shrink with container

### Supported Formats

- **PNG** - Full support including alpha transparency and 16-bit depth (decoded via `npm:fast-png`)
- **JPEG** - Full support (decoded via `npm:jpeg-js`)
- **GIF** - Static images, first frame only (decoded via `npm:omggif`)

All decoders are pure JavaScript - no native dependencies or Deno internal APIs.

### Path Resolution

- Absolute paths (starting with `/`) are used as-is
- HTTP/HTTPS URLs are fetched directly
- Relative paths are resolved from the .melker file's directory

### Implementation

Located in `src/components/img.ts`. Subclass of `CanvasElement` that provides an HTML-like API for image display. Image decoding is in `src/components/canvas.ts`.

## Rendering Pipeline

1. **Layout calculation** → LayoutNode tree
2. **Store bounds** → `_currentLayoutContext` map (id → LayoutNode)
3. **Render pass** → Write to dual buffer
4. **Modal pass** → Render dialogs last
5. **Selection pass** → Apply text selection highlighting
6. **Buffer diff** → Output ANSI sequences

## Style Inheritance

Only these properties inherit from parent:
- `color`
- `backgroundColor`
- `fontWeight`
- `borderColor`

Layout properties (padding, margin, border widths) do NOT inherit.

## Key Files Reference

| File | Responsibility |
|------|----------------|
| `src/types.ts` | Core interfaces: Element, Style, Bounds, Props |
| `src/element.ts` | createElement, component registry |
| `src/document.ts` | Document class, element registry, focus |
| `src/layout.ts` | LayoutEngine, flexbox algorithm |
| `src/sizing.ts` | SizingModel, box model calculations |
| `src/rendering.ts` | RenderingEngine, layout-to-buffer |
| `src/viewport.ts` | ViewportManager, scrolling support |
| `src/viewport-buffer.ts` | ViewportBufferProxy, ViewportDualBuffer |
| `src/content-measurer.ts` | ContentMeasurer, intrinsic size calculation |
| `src/focus.ts` | FocusManager, tab navigation |
| `src/events.ts` | EventManager, event dispatching |
