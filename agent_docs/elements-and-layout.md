# Elements and Layout

How Melker's element system and layout engine work.

## Element System

### Core Types (`src/types.ts`)

```
Element (abstract base class)
├── type: string        - Component type name
├── props: Record       - Component properties
├── children?: Element[] - Child elements
└── id: string          - Unique identifier (auto-generated if not provided)
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

## Rendering Pipeline

1. **Layout calculation** → LayoutNode tree
2. **Store bounds** → `_currentLayoutContext` map (id → LayoutNode)
3. **Render pass** → Write to dual buffer
4. **Overlay pass** → Render menus on top
5. **Modal pass** → Render dialogs last
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
