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

## Rendering Pipeline

1. **Layout calculation** → LayoutNode tree
2. **Store bounds** → `_currentLayoutContext` map (id → LayoutNode)
3. **Render pass** → Write to dual buffer
4. **Overlay pass** → Render menus on top
5. **Modal pass** → Render dialogs last
6. **Selection pass** → Apply text selection highlighting
7. **Buffer diff** → Output ANSI sequences

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
