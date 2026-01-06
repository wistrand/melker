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

**1. `display: 'flex'` must be explicit**

The default display is `'block'`, not `'flex'`. Setting `flexDirection` alone does NOT enable flex layout:

```typescript
// WRONG - flex properties won't work (block layout)
{ flexDirection: 'column', width: 'fill', height: 'fill' }

// CORRECT - flex layout enabled
{ display: 'flex', flexDirection: 'column', width: 'fill', height: 'fill' }
```

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
- Number: Fixed character width/height
- `'auto'`: Size to content
- `'fill'`: Expand to fill available space

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

### Path Resolution

- Absolute paths (starting with `/`) are used as-is
- HTTP/HTTPS URLs are fetched directly
- Relative paths are resolved from the .melker file's directory

### Implementation

Located in `src/components/img.ts`. Subclass of `CanvasElement` that provides an HTML-like API for image display.

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
