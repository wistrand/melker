# Component Reference

Detailed documentation for Melker components.

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
- `TextSelectable` - Supports text selection (copy with Alt+C/Alt+N, requires `clipboard: true` in policy, shows toast on success/failure)
- `Draggable` - Handles mouse drag (scrollbars, resizers, dialogs)
- `Wheelable` - Handles mouse wheel events (scrollable tbody)

**Type Guards:**
- `isRenderable(el)`, `isFocusable(el)`, `isClickable(el)`, etc.
- `isScrollableType(type)` - Returns true for 'container' or 'tbody'

### Element Creation (`src/element.ts`)

```typescript
// Create elements via createElement()
const button = createElement('button', { label: 'Click' });
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

The root viewport, `container`, `dialog`, and `tab` elements all default to `display: flex` with `flexDirection: column`.

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

**Min/max constraints:**
- `minWidth`, `minHeight`: Minimum size (prevents shrinking below)
- `maxWidth`, `maxHeight`: Maximum size (prevents growing beyond)

```xml
<!-- Container that grows but caps at 80 characters -->
<container style="width: fill; max-width: 80;">
  <text>Content constrained to 80 chars max</text>
</container>

<!-- Flex item that won't shrink below 20 characters -->
<button style="min-width: 20; flex-shrink: 1;">Submit</button>
```

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
Use `width` (via `style` or `colWidth` prop) on `<th>` elements for O(1) column sizing (skips row sampling):
```xml
<thead>
  <tr>
    <th style="width: 20%">Name</th>
    <th style="width: 10%">Status</th>
    <th style="width: fill">Description</th>
  </tr>
</thead>
```

Both `style.width` and the `colWidth` prop work for percentages, fixed widths, and `fill`. The `style.width` approach is preferred as it's consistent with other elements.

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

### Single-Line Element Padding

For single-line elements (buttons, text, input) without borders, vertical padding is ignored in cross-axis sizing. This prevents buttons from expanding to multiple lines when padding is applied.

**Behavior:**
- Horizontal padding: Applied normally, adds space left/right
- Vertical padding: Ignored for elements with `intrinsicSize.height === 1` and no border

**Example:**
```xml
<!-- Button stays 1 line tall, horizontal padding adds 2 chars -->
<button label="Submit" style="padding: 1;" />

<!-- Bordered button respects vertical padding (3 lines) -->
<button label="Submit" style="padding: 1; border: thin;" />
```

This ensures default `[ ]` style buttons remain single-line while bordered buttons can expand.

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

The `<tabs>` component provides a tabbed interface with clickable tab headers. Each `<tab>` defaults to flex column layout.

### Usage

```xml
<tabs id="settings">
  <tab id="general" title="General">
    <text>General settings content</text>
  </tab>
  <tab id="advanced" title="Advanced">
    <text>Advanced settings content</text>
  </tab>
  <tab id="about" title="About">
    <text>About content</text>
  </tab>
</tabs>

<!-- To start on a specific tab, use activeTab with the tab's id -->
<tabs id="settings" activeTab="advanced">...</tabs>
```

### Props

**Tabs container:**
- `id` - Element identifier
- `activeTab` - ID of active tab (must match a tab's id attribute)
- `onChange` - Handler called when tab changes (`event.tabId`, `event.index`)

**Tab panel:**
- `id` - Tab identifier (used for activeTab reference)
- `title` - Tab header text (required)
- `disabled` - Disable tab selection

### Behavior

- Tab headers render as a button row: `│ General │ Advanced │ About │`
- Active tab is bold, focused tab is underlined
- Navigate with Tab/Shift+Tab, activate with Enter or click
- Default tab style includes `border: thin; margin-top: 1`

## Data Table Component

The `<data-table>` component is a high-performance table for displaying large datasets with simple array-based data.

### Usage

**Inline JSON (simplest for static data, parse errors logged):**

```xml
<data-table
  id="users"
  style="width: fill; height: 20;"
  selectable="single"
  sortColumn="0"
  sortDirection="asc"
>
{
  "columns": [
    { "header": "ID", "width": 5, "align": "right" },
    { "header": "Name", "width": "30%" },
    { "header": "Status", "width": 10 },
    { "header": "Description" }
  ],
  "rows": [
    [1, "Alice", "Active", "Engineer"],
    [2, "Bob", "Away", "Designer"]
  ]
}
</data-table>
```

### Props

| Prop                | Type                         | Default  | Description                          |
|---------------------|------------------------------|----------|--------------------------------------|
| `columns`           | DataTableColumn[]            | []       | Column definitions (set via script)  |
| `rows`              | CellValue[][]                | []       | Row data (set via script)            |
| `footer`            | CellValue[][]                | -        | Footer rows                          |
| `rowHeight`         | number                       | 1        | Lines per row                        |
| `showHeader`        | boolean                      | true     | Show header row                      |
| `showFooter`        | boolean                      | true     | Show footer if data exists           |
| `showColumnBorders` | boolean                      | false    | Show column separators               |
| `border`            | BorderStyle                  | 'thin'   | Table border style                   |
| `sortColumn`        | number                       | -        | Initial sort column index            |
| `sortDirection`     | `'asc'` \| `'desc'`          | -        | Initial sort direction               |
| `selectable`        | `'none'` \| `'single'` \| `'multi'` | 'none' | Selection mode                  |
| `onSelect`          | function                     | -        | Selection change handler             |
| `onActivate`        | function                     | -        | Enter/double-click handler           |
| `onSort`            | function                     | -        | Sort change notification (optional)  |

### Column Definition

```typescript
interface DataTableColumn {
  header: string;                              // Header text
  width?: number | `${number}%` | 'fill';     // Column width
  align?: 'left' | 'center' | 'right';        // Text alignment
  sortable?: boolean;                          // Enable sorting (default: true)
  comparator?: (a, b) => number;               // Custom sort function
}
```

### Behavior

- **Sorting**: Click headers to sort; handled internally, no handler needed
- **Selection**: Arrow keys navigate, Enter/double-click activates
- **Scrolling**: Mouse wheel, scrollbar drag, keyboard (PageUp/Down, Home/End)
- **Events**: Always report original row indices (not sorted positions)

### When to Use data-table vs table

| Use `<data-table>` when        | Use `<table>` when                       |
|--------------------------------|------------------------------------------|
| Large datasets (100+ rows)     | Complex cell content (buttons, inputs)   |
| Simple text/number cells       | Variable row heights                     |
| Performance is critical        | Need nested elements in cells            |
| Data is array-based            | Building table dynamically with elements |

### Implementation Files

| File                           | Purpose                  |
|--------------------------------|--------------------------|
| `src/components/data-table.ts` | Component implementation |

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
  <tbody style="overflow: scroll">
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
- `<thead>` - Fixed header section (non-scrolling)
- `<tbody>` - Data rows, supports `overflow: scroll` style for scrolling
- `<tfoot>` - Fixed footer section (non-scrolling)
- `<tr>` - Table row
- `<td>` / `<th>` - Table cells (th renders bold)

### Props

**Table:**
- `border` - Border style: `'single'` (default), `'double'`, `'rounded'`, `'none'`
- `columnBorders` - Show vertical column separators (default: `true`)
- `cellPadding` - Padding inside cells in characters (default: `1`)
- `style.width` / `style.height` - Table dimensions

**tbody:**
- `style="overflow: scroll"` - Enable vertical scrolling when content exceeds height
- `maxHeight` - Maximum visible rows when scrolling enabled

### Behavior

- Column widths are calculated from max content width across all sections
- tbody scrolling uses the same scrollbar system as containers
- Wheel events are handled by the tbody element (Wheelable interface)
- Click events on cells bubble to the table element for hit testing

### Implementation Files

| File                              | Purpose                      |
|-----------------------------------|------------------------------|
| `src/components/table.ts`         | Table container, column calc |
| `src/components/table-section.ts` | thead/tbody/tfoot sections   |
| `src/components/table-row.ts`     | Row container                |
| `src/components/table-cell.ts`    | td/th cells                  |

## Dialog Component

The `<dialog>` component provides modal overlay dialogs. Defaults to flex column layout.

### Usage

```xml
<dialog id="settings" title="Settings" open=${true} modal=${true}>
  <text>Dialog content</text>
  <button label="Close" onClick="dialog.props.open = false" />
</dialog>
```

### Props

| Prop        | Type           | Default | Description                                      |
|-------------|----------------|---------|--------------------------------------------------|
| `title`     | string         | -       | Title bar text                                   |
| `open`      | boolean        | false   | Whether dialog is visible                        |
| `modal`     | boolean        | true    | Block interaction with background                |
| `backdrop`  | boolean        | true    | Show semi-transparent backdrop                   |
| `width`     | number\|string | 80%     | Width: number, "50%", "fill", or 0<v<1 decimal   |
| `height`    | number\|string | 70%     | Height: number, "50%", "fill", or 0<v<1 decimal  |
| `draggable` | boolean        | false   | Allow dragging by title bar                      |
| `offsetX`   | number         | 0       | Horizontal offset from center                    |
| `offsetY`   | number         | 0       | Vertical offset from center                      |

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

| Component           | Description                      |
|---------------------|----------------------------------|
| `<combobox>`        | Inline dropdown with text filter |
| `<select>`          | Dropdown picker without filter   |
| `<autocomplete>`    | Combobox with async loading      |
| `<command-palette>` | Modal command picker             |

### Child Elements

| Element    | Description                              |
|------------|------------------------------------------|
| `<option>` | Selectable item (value, disabled, shortcut) |
| `<group>`  | Groups options under a header            |

### Quick Examples

```xml
<!-- Combobox with text filtering -->
<combobox placeholder="Select country..." onChange="$app.setCountry(event.value)">
  <option value="us">United States</option>
  <option value="uk">United Kingdom</option>
</combobox>

<!-- Simple select dropdown -->
<select value="medium" onChange="$app.setSize(event.value)">
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

| Prop         | Type     | Description                                    |
|--------------|----------|------------------------------------------------|
| `open`       | boolean  | Dropdown visibility                            |
| `filter`     | string   | 'fuzzy', 'prefix', 'contains', 'exact', 'none' |
| `maxVisible` | number   | Max dropdown height (default: 8)               |
| `onSelect`   | function | Called when option selected                    |

### Methods (shared)

All filterable list components provide consistent value access methods:

```typescript
const select = document.getElementById('mySelect');
select.getValue();         // Get selected value (string | undefined)
select.setValue('option1'); // Set selected value (scrolls to option)

// For combobox/autocomplete, setValue also updates the input display
const combo = document.getElementById('myCombo');
combo.setValue('us');      // Selects option and shows its label in input
```

### Implementation Files

| File                                              | Purpose                      |
|---------------------------------------------------|------------------------------|
| `src/components/filterable-list/core.ts`          | Shared base class            |
| `src/components/filterable-list/combobox.ts`      | Combobox component           |
| `src/components/filterable-list/select.ts`        | Select component             |
| `src/components/filterable-list/autocomplete.ts`  | Autocomplete component       |
| `src/components/filterable-list/command-palette.ts` | Command palette component  |
| `src/components/filterable-list/filter.ts`        | Fuzzy/prefix/contains matching |

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

| Prop            | Type    | Default  | Description                      |
|-----------------|---------|----------|----------------------------------|
| `path`          | string  | cwd      | Initial directory                |
| `selectionMode` | string  | 'single' | 'single' or 'multiple'           |
| `selectType`    | string  | 'file'   | 'file', 'directory', or 'both'   |
| `filter`        | string  | 'fuzzy'  | Filter mode                      |
| `showHidden`    | boolean | false    | Show dotfiles                    |
| `maxVisible`    | number  | 10       | Visible rows                     |

### Events

| Event        | Properties                 | Description            |
|--------------|----------------------------|------------------------|
| `onSelect`   | path, paths, isDirectory   | File/dir selected      |
| `onCancel`   | -                          | Cancelled              |
| `onNavigate` | path                       | Navigated to directory |
| `onError`    | code, message              | Error occurred         |

### Keyboard

- Arrow keys: Navigate list
- Enter: Open directory / select file
- Backspace: Parent directory
- Escape: Cancel
- Type: Filter entries

### Implementation Files

| File                                        | Purpose                     |
|---------------------------------------------|-----------------------------|
| `src/components/file-browser/file-browser.ts` | Main component            |
| `src/components/file-browser/file-entry.ts` | Type definitions            |
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

| Prop             | Type    | Default | Description                          |
|------------------|---------|---------|--------------------------------------|
| `value`          | number  | 0       | Current progress value               |
| `max`            | number  | 100     | Maximum value                        |
| `min`            | number  | 0       | Minimum value                        |
| `width`          | number  | 20      | Bar width in terminal columns        |
| `height`         | number  | 1       | Bar height in terminal rows          |
| `showValue`      | boolean | false   | Display percentage text after bar    |
| `indeterminate`  | boolean | false   | Show animated loading state          |
| `fillColor`      | string  | theme   | Color for filled portion             |
| `emptyColor`     | string  | theme   | Color for empty portion              |
| `animationSpeed` | number  | 50      | Indeterminate animation speed (ms)   |

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

## Spinner Component

The `<spinner>` component displays an animated loading indicator with optional text or cycling verbs. All spinners share a single animation timer for efficiency.

### Usage

```xml
<!-- Basic spinner -->
<spinner text="Loading..." />

<!-- Different variants -->
<spinner variant="dots" text="Processing" />
<spinner variant="braille" text="Computing" />
<spinner variant="pulse" text="Waiting" />

<!-- With cycling verbs (theme name) -->
<spinner variant="dots" verbs="thinking" />

<!-- With custom verbs (comma-separated) -->
<spinner variant="line" verbs="Analyzing, Optimizing, Finalizing" />

<!-- Text-only with animated shade (no spinner char) -->
<spinner variant="none" verbs="dreaming" shade="true" />

<!-- Spinner on right side of text -->
<spinner text="Working" textPosition="right" />
```

### Props

| Prop           | Type                    | Default  | Description                                   |
|----------------|-------------------------|----------|-----------------------------------------------|
| `text`         | string                  | -        | Text displayed beside spinner                 |
| `variant`      | SpinnerVariant          | 'line'   | Animation style                               |
| `speed`        | number                  | 100      | Frame interval in milliseconds                |
| `textPosition` | 'left' \| 'right'       | 'left'   | Spinner position relative to text             |
| `spinning`     | boolean                 | true     | Whether spinner is animating                  |
| `verbs`        | VerbTheme \| string     | -        | Cycling text: theme name or comma-separated   |
| `verbSpeed`    | number                  | 800      | Verb cycle interval in milliseconds           |
| `shade`        | boolean                 | false    | Enable animated brightness wave across text   |
| `shadeSpeed`   | number                  | 60       | Shade wave speed (ms per character)           |

### Variants

| Variant   | Frames                         | Description           |
|-----------|--------------------------------|-----------------------|
| `none`    | (no spinner)                   | Text only, no spinner |
| `line`    | `\| / - \`                     | Classic ASCII spinner |
| `dots`    | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`                  | Braille dots pattern  |
| `braille` | `⣷⣯⣟⡿⢿⣻⣽⣾`                     | Rotating braille      |
| `arc`     | `◜◠◝◞◡◟`                       | Curved arc rotation   |
| `bounce`  | `⠁⠂⠄⠂`                         | Bouncing dot          |
| `flower`  | `·✻✽✶✳✢`                       | Blooming flower       |
| `pulse`   | `·•●•`                         | Pulsating dot         |

### Verb Themes

Standard themes cycle through contextual variations:
- `loading`: Loading, Loading., Loading.., Loading...
- `thinking`: Thinking, Pondering, Contemplating, Reasoning
- `working`: Working, Processing, Computing, Calculating
- `waiting`: Please wait, Hold on, One moment, Almost there
- `fetching`: Fetching, Downloading, Retrieving, Receiving
- `saving`: Saving, Writing, Storing, Committing

Poetic themes have 8 words each:
- `dreaming`, `conjuring`, `brewing`, `weaving`, `unfolding`, `stargazing`

### Shade Effect

When `shade="true"`, text characters animate with a brightness gradient that moves left to right:
- Peak position: 100% brightness
- Adjacent characters: 75%, 50%, 50%...
- Creates a "spotlight" scanning effect

### Methods

```typescript
const spinner = document.getElementById('mySpinner');
spinner.start();           // Start animation
spinner.stop();            // Stop animation
spinner.getValue();        // Get text value
spinner.setValue('text');  // Set text value
```

### Behavior

- All spinners share a single 40ms timer (efficient for multiple spinners)
- Frame timing is calculated from elapsed time, not frame counters
- `none` variant displays text only (useful for animated verbs/shade without spinner character)
- Intrinsic width accounts for longest verb when verbs are set

## Canvas Component

The `<canvas>` component provides pixel graphics using Unicode sextant characters (2x3 pixels per cell).

### Canvas Methods

| Method                                               | Description                                                      |
|------------------------------------------------------|------------------------------------------------------------------|
| `clear()`                                            | Clear the canvas                                                 |
| `getBufferSize()`                                    | Get pixel buffer dimensions `{ width, height }`                  |
| `getBufferWidth()`                                   | Get buffer width in pixels                                       |
| `getBufferHeight()`                                  | Get buffer height in pixels                                      |
| `getVisualSize()`                                    | Get aspect-corrected visual size                                 |
| `getPixelAspectRatio()`                              | Get pixel aspect ratio (~0.67 for sextant)                       |
| `setPixel(x, y)`                                     | Set a pixel at coordinates                                       |
| `fillRect(x, y, w, h)`                               | Fill a rectangle                                                 |
| `drawLine(x1, y1, x2, y2)`                           | Draw a line between two points                                   |
| `drawCircleCorrected(x, y, radius)`                  | Draw aspect-corrected circle                                     |
| `drawSquareCorrected(x, y, size)`                    | Draw aspect-corrected square                                     |
| `drawImage(image, dx, dy, dw, dh)`                   | Draw full image at position                                      |
| `drawImageRegion(image, sx, sy, sw, sh, dx, dy, dw, dh)` | Draw portion of image                                        |
| `decodeImageBytes(bytes)`                            | Decode PNG/JPEG/GIF bytes to `{ width, height, data, bytesPerPixel }` |
| `markDirty()`                                        | Mark canvas for re-render                                        |

### drawImageRegion

Draw a portion of an image to the canvas with scaling:

```typescript
canvas.drawImageRegion(
  image,     // Image data or Uint8Array (PNG/JPEG bytes)
  sx, sy,    // Source rectangle top-left corner
  sw, sh,    // Source rectangle dimensions
  dx, dy,    // Destination position
  dw, dh     // Destination dimensions (scales if different from sw, sh)
);
```

Useful for tile-based rendering where you need to draw portions of larger images.

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

| Prop          | Type     | Default      | Description                                  |
|---------------|----------|--------------|----------------------------------------------|
| `min`         | number   | 0            | Minimum value                                |
| `max`         | number   | 100          | Maximum value                                |
| `value`       | number   | 0            | Current value                                |
| `step`        | number   | -            | Discrete step size (e.g., 5 = values 0,5,10...) |
| `snaps`       | number[] | -            | Array of specific snap points                |
| `orientation` | string   | 'horizontal' | 'horizontal' or 'vertical'                   |
| `showValue`   | boolean  | false        | Display value label after slider             |
| `onChange`    | function | -            | Called when value changes                    |

### Keyboard Navigation

| Key              | Action                                   |
|------------------|------------------------------------------|
| Arrow Left/Down  | Decrease by step (or to previous snap)   |
| Arrow Right/Up   | Increase by step (or to next snap)       |
| Page Down        | Decrease by 10% of range                 |
| Page Up          | Increase by 10% of range                 |
| Home             | Jump to minimum                          |
| End              | Jump to maximum                          |

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

## Separator Component

The `<separator>` component renders a horizontal or vertical line with optional centered label text. Orientation is automatically determined by the parent's flex direction.

### Usage

```xml
<!-- Horizontal separator (default, in column flex) -->
<separator />

<!-- With label -->
<separator label="Settings" />

<!-- With style -->
<separator label="Advanced" style="border-style: double; color: blue;" />

<!-- Vertical separator (automatic in row flex) -->
<container style="flex-direction: row; height: 5;">
  <text>Left</text>
  <separator label="OR" />
  <text>Right</text>
</container>
```

### Props

| Prop    | Type   | Default | Description                        |
|---------|--------|---------|-----------------------------------|
| `label` | string | -       | Optional text centered in the line |
| `style` | Style  | -       | Standard style object              |

### Style Properties

| Property       | Values      | Default | Description                                  |
|----------------|-------------|---------|----------------------------------------------|
| `border-style` | BorderStyle | 'thin'  | Line style: thin, thick, double, dashed, etc. |
| `color`        | ColorInput  | theme   | Line and label color                         |

### Automatic Orientation

The separator detects its parent's flex direction and renders accordingly:

| Parent flex-direction | Separator  | Line char | Size                     |
|-----------------------|------------|-----------|--------------------------|
| `column` (default)    | Horizontal | `─`       | width: fill, height: 1   |
| `row`                 | Vertical   | `│`       | width: 1, height: fill   |

### Visual Examples

**Horizontal (column flex):**
```
───────────────────────────────────────
─────────────── Settings ──────────────
═══════════════ Advanced ══════════════
```

**Vertical (row flex):**
```
Left │ Middle │ Right
     │        O
     │        R
     │        │
```

### Behavior

- Self-closing element (no children allowed)
- Fills available space in its orientation
- Label text renders vertically when separator is vertical
- Inherits theme colors by default

## Split Pane Component

The `<split-pane>` component splits its children horizontally (default) or vertically with draggable, focusable divider bars. Supports N children with N-1 dividers.

### Usage

```xml
<!-- Horizontal split (left/right), equal sizes -->
<split-pane style="width: fill; height: fill;">
  <container><text>Left</text></container>
  <container><text>Right</text></container>
</split-pane>

<!-- Vertical split, custom proportions, styled dividers -->
<split-pane
  direction="vertical"
  sizes="1,2,1"
  dividerTitles="Header,Footer"
  style="width: fill; height: fill; divider-style: thick; divider-color: cyan;"
>
  <container><text>Top (25%)</text></container>
  <container><text>Middle (50%)</text></container>
  <container><text>Bottom (25%)</text></container>
</split-pane>
```

### Props

| Prop            | Type     | Default        | Description                                              |
|-----------------|----------|----------------|----------------------------------------------------------|
| `direction`     | `string` | `'horizontal'` | `'horizontal'` (left/right) or `'vertical'` (top/bottom) |
| `sizes`         | `string` | equal          | Comma-separated proportions, e.g. `"1,2,1"`              |
| `minPaneSize`   | `number` | `3`            | Minimum pane size in characters                           |
| `dividerTitles` | `string` | -              | Comma-separated divider titles, e.g. `"Nav,Info"`        |
| `onResize`      | handler  | -              | Fired on resize: `{ sizes, dividerIndex, targetId }`     |

### Styles

| Style           | Type          | Default    | Description                                            |
|-----------------|---------------|------------|--------------------------------------------------------|
| `divider-style` | `BorderStyle` | `'thin'`   | Line style: `thin`, `thick`, `double`, `dashed`, etc.  |
| `divider-color` | `ColorInput`  | inherited  | Divider foreground color                               |

### Interaction

- **Mouse drag**: Drag dividers to resize adjacent panes
- **Keyboard**: Tab to focus a divider, then arrow keys to move it (Left/Right for horizontal, Up/Down for vertical)
- **Focus**: Dividers show reverse video when focused

### Implementation Notes

- Dividers are internal `SplitPaneDivider` elements interleaved between children
- Layout uses flexbox (`flexGrow` proportions on panes, fixed 1-char dividers)
- Nested split-panes work naturally
- See [split-pane-architecture.md](split-pane-architecture.md) for full details

## Connector Component

The `<connector>` component draws a line between two elements identified by their IDs. Uses box-drawing characters for orthogonal routing.

### Usage

```xml
<!-- Basic connector between two elements -->
<container style="flex-direction: row; gap: 4">
  <container id="box-a" style="border: single; padding: 1">Source</container>
  <container id="box-b" style="border: single; padding: 1">Target</container>
  <connector from="box-a" to="box-b" arrow="end" />
</container>

<!-- Vertical connector -->
<container style="flex-direction: column; gap: 2; align-items: center">
  <container id="top" style="border: single; padding: 1">Top</container>
  <container id="bottom" style="border: single; padding: 1">Bottom</container>
  <connector from="top" to="bottom" arrow="both" />
</container>

<!-- With label and custom style -->
<connector from="start" to="end" label="flow" style="color: green; lineStyle: double" />
```

### Props

| Prop       | Type   | Default      | Description                                                        |
|------------|--------|--------------|-------------------------------------------------------------------|
| `from`     | string | **required** | ID of the source element                                           |
| `to`       | string | **required** | ID of the target element                                           |
| `fromSide` | string | `'auto'`     | Side to connect from: `'top'`, `'bottom'`, `'left'`, `'right'`, `'center'`, `'auto'` |
| `toSide`   | string | `'auto'`     | Side to connect to: `'top'`, `'bottom'`, `'left'`, `'right'`, `'center'`, `'auto'` |
| `arrow`    | string | `'end'`      | Arrow style: `'none'`, `'start'`, `'end'`, `'both'`                |
| `label`    | string | -            | Optional label text at midpoint                                    |
| `routing`  | string | `'orthogonal'` | Line routing: `'direct'` or `'orthogonal'`                       |

### Style Properties

| Property    | Values                                | Description        |
|-------------|---------------------------------------|--------------------|
| `color`     | color                                 | Line color         |
| `lineStyle` | `'thin'`, `'thick'`, `'double'`, `'dashed'` | Line drawing style |

### Visual Examples

**Horizontal connector:**
```
┌────────┐          ┌────────┐
│ Source │─────────▶│ Target │
└────────┘          └────────┘
```

**Vertical connector with both arrows:**
```
┌─────┐
│ Top │
└──┬──┘
   ▲
   │
   ▼
┌─────┐
│ Bot │
└─────┘
```

**Orthogonal routing (auto-bends):**
```
┌───┐
│ A │──┐
└───┘  │
       │  ┌───┐
       └─▶│ B │
          └───┘
```

### Behavior

- Connector takes minimal layout space (1x1) but draws based on connected elements' positions
- Elements must have `id` attributes to be referenced
- Side selection defaults to 'auto' which chooses the best side based on relative positions
- Lines are drawn using box-drawing characters (─ │ ┌ ┐ └ ┘)
- Arrow heads use Unicode triangles (▶ ◀ ▲ ▼)
- Labels are automatically clipped to fit within the horizontal span of the line

## Graph Component

The `<graph>` component renders diagrams from Mermaid syntax or JSON input. Supports flowcharts, sequence diagrams, and class diagrams.

### Usage

```xml
<!-- Flowchart -->
<graph>
  flowchart LR
    A[Start] --> B{Decision}
    B -->|Yes| C[Done]
    B -->|No| D[Retry]
</graph>

<!-- Sequence diagram -->
<graph>
  sequenceDiagram
    participant U as User
    participant S as Server
    U->>S: Request
    S-->>U: Response
</graph>

<!-- Class diagram -->
<graph>
  classDiagram
    class Animal {
      +name: String
      +makeSound()
    }
    class Dog
    Animal <|-- Dog
</graph>

<!-- Load from URL -->
<graph src="./diagrams/flow.mmd" />

<!-- JSON input -->
<graph type="json">
  {
    "direction": "TB",
    "nodes": [
      { "id": "a", "label": "Node A", "shape": "rect" },
      { "id": "b", "label": "Node B", "shape": "diamond" }
    ],
    "edges": [
      { "from": "a", "to": "b", "arrow": "end" }
    ]
  }
</graph>
```

### Props

| Prop         | Type    | Default | Description                                               |
|--------------|---------|---------|-----------------------------------------------------------|
| `type`       | string  | auto    | Parser type: 'mermaid' or 'json' (auto-detected from content) |
| `src`        | string  | -       | Load content from URL                                     |
| `text`       | string  | -       | Inline content (alternative to children)                  |
| `style`      | Style   | -       | Container styling; use `overflow: scroll` for scrolling   |

### Content Priority

1. `src` attribute (loads from URL)
2. `text` attribute
3. Children text content

### Diagram Types (Auto-Detected)

| Type      | Mermaid Keywords       |
|-----------|------------------------|
| Flowchart | `flowchart`, `graph`   |
| Sequence  | `sequenceDiagram`      |
| Class     | `classDiagram`         |

### Supported Mermaid Syntax

**Flowcharts:**
- Directions: `TB`, `LR`, `BT`, `RL`
- Node shapes: `[rect]`, `{diamond}`, `((circle))`, `{{hexagon}}`
- Edges: `-->`, `---`, `-.->`, `==>`, with labels `-->|label|`
- Subgraphs: `subgraph name ... end`

**Sequence Diagrams:**
- Participants: `participant A as Alias`
- Messages: `->>`, `-->>`, `-x`, `--x`
- Notes: `Note over A: text`
- Fragments: `alt`, `opt`, `loop`, `par`

**Class Diagrams:**
- Classes: `class Name { +attr: Type; +method() }`
- Relationships: `<|--` (inheritance), `*--` (composition), `o--` (aggregation), `-->` (association)
- Annotations: `<<interface>>`, `<<abstract>>`

### Styling

The graph generates internal CSS classes that can be overridden. Use `style` prop for container-level overrides:

```xml
<graph style="border: none; padding: 2;">
  flowchart LR
    A --> B
</graph>
```

### Implementation Files

| File                                      | Purpose                                  |
|-------------------------------------------|------------------------------------------|
| `src/components/graph/graph.ts`           | GraphElement component                   |
| `src/components/graph/graph-to-melker.ts` | Converts parsed graph to melker elements |
| `src/components/graph/layout.ts`          | Graph layout algorithm                   |
| `src/components/graph/parsers/`           | Mermaid and JSON parsers                 |
| `src/components/graph/types.ts`           | GraphDefinition interfaces               |

## Segment Display Component

The `<segment-display>` component renders LCD/LED-style digits and text using Unicode characters with multiple visual styles.

### Usage

```xml
<!-- Basic clock display -->
<segment-display value="12:45:30" style="height: 5; color: green;" />

<!-- Different renderers -->
<segment-display value="1234567890" renderer="rounded" style="color: cyan;" />
<segment-display value="HELLO" renderer="geometric" style="height: 7; color: yellow;" />

<!-- With scrolling -->
<segment-display value="HELLO WORLD" scroll="true" scrollSpeed="24" style="width: 50;" />

<!-- LCD style with off-segments visible -->
<segment-display value="88:88" style="color: #00ff00; off-color: #003300;" />
```

### Props

| Prop          | Type    | Default       | Description                                           |
|---------------|---------|---------------|-------------------------------------------------------|
| `value`       | string  | -             | Text to display                                       |
| `renderer`    | string  | 'box-drawing' | Visual style: 'box-drawing', 'rounded', 'geometric'   |
| `scroll`      | boolean | false         | Enable horizontal scrolling                           |
| `scrollSpeed` | number  | 24            | Scroll speed in milliseconds                          |
| `scrollGap`   | number  | 3             | Gap between repeated text when scrolling              |

### Style Properties

| Property           | Values    | Description                                      |
|--------------------|-----------|--------------------------------------------------|
| `height`           | 5, 7      | Display height in rows (only 5 or 7 supported)   |
| `color`            | any color | Color for "on" segments                          |
| `off-color`        | any color | Color for "off" segments (dimmed LCD effect)     |
| `background-color` | any color | Background color                                 |
| `width`            | number    | Width limit for scrolling                        |

### Renderers

| Renderer      | Characters       | Description                    |
|---------------|------------------|--------------------------------|
| `box-drawing` | ━ ┃              | Clean thin lines (default)     |
| `rounded`     | ╭ ╮ ╰ ╯ ━ ┃     | Rounded corners, modern look   |
| `geometric`   | ▬ ▮ ▯            | Chunky LCD aesthetic           |

### Character Support

The component supports the full ASCII character set with best-effort 7-segment approximations:
- **Digits**: 0-9
- **Letters**: A-Z (uppercase and lowercase)
- **Special**: : . , - _ = " ' [ ] ( ) / \ ? ! + * # % & @ ^ < > |
- **Accented**: Å Ä Ö É È (and lowercase variants)

### 7-Segment Layout

```
   aaaa
  f    b
  f    b
   gggg
  e    c
  e    c
   dddd
```

### Methods

```typescript
const display = document.getElementById('myDisplay');
display.setValue('12:34');  // Set value programmatically
display.getValue();         // Get current value
```

### Visual Example

**"42" with box-drawing renderer (5-row):**
```
      ━━━━
     ┃     ┃
 ━━━━ ━━━━
┃        ┃
 ━━━━
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

<!-- Data URL (inline base64-encoded image) -->
<img src="data:image/png;base64,iVBORw0KGgo..." width="20" height="10" />
```

### Props

| Prop             | Type             | Default | Description                                                              |
|------------------|------------------|---------|--------------------------------------------------------------------------|
| `src`            | string           | -       | Image source path or data URL (required)                                 |
| `alt`            | string           | -       | Alternative text for accessibility                                       |
| `width`          | number \| string | 30      | Width in columns or percentage (e.g., "50%")                             |
| `height`         | number \| string | 15      | Height in rows or percentage (e.g., "50%")                               |
| `objectFit`      | string           | 'fill'  | How image fits: 'contain' (preserve aspect), 'fill' (stretch), 'cover' (crop) |
| `dither`         | string           | 'auto'  | Dithering mode for limited-color themes                                  |
| `ditherBits`     | number           | -       | Color depth for dithering (1-8)                                          |
| `onLoad`         | function         | -       | Called when image loads successfully                                     |
| `onError`        | function         | -       | Called when image fails to load                                          |
| `onShader`       | function         | -       | Per-pixel shader callback (see Shaders section)                          |
| `shaderFps`      | number           | 30      | Shader frame rate                                                        |
| `shaderRunTime`  | number           | -       | Stop shader after this many ms, freeze final frame as image              |

### Methods

| Method            | Description                                                          |
|-------------------|----------------------------------------------------------------------|
| `setSrc(url)`     | Load image immediately (async, last call wins if called rapidly)     |
| `setSource(url)`  | Set props.src and clear existing image (loads during next render)    |
| `clearImage()`    | Clear the loaded image                                               |
| `loadImage(url)`  | Low-level async load (same as setSrc)                                |
| `refreshImage()`  | Re-render the loaded image (e.g., after resize)                      |

```typescript
// Preferred: setSrc loads immediately
const img = $melker.getElementById('my-image');
await img.setSrc('https://example.com/image.png');  // or file path or data URL
```

### Shaders

The `<img>` and `<canvas>` components support per-pixel shader callbacks for animated effects. **Prefer `<img>` over `<canvas>`** for shaders - images scale better on resize.

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
- `utils`: Built-in functions: `noise2d`, `simplex2d`, `simplex3d`, `perlin2d`, `perlin3d`, `fbm`, `fbm3d`, `palette`, `smoothstep`, `mix`, `fract`

Returns `[r, g, b]` or `[r, g, b, a]` (0-255 range).

**Mouse tracking**: Automatic for elements with `onShader`. The `source.mouse` (pixel coords) and `source.mouseUV` (normalized 0-1) update automatically as the mouse moves over the element. Values are -1 when mouse is not over the element.

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

- **PNG** - Full support including alpha transparency and 16-bit depth (fast-png)
- **JPEG** - Full support (jpeg-js)
- **GIF** - Static images, first frame only (omggif)

All decoders are pure JavaScript (centralized in `src/deps.ts`) - no native dependencies or Deno internal APIs.

### Path Resolution

- Data URLs (`data:image/png;base64,...`) are decoded directly (no file access)
- Absolute paths (starting with `/`) are used as-is
- HTTP/HTTPS URLs are fetched directly
- Relative paths are resolved from the .melker file's directory

### Implementation

Located in `src/components/img.ts`. Subclass of `CanvasElement` that provides an HTML-like API for image display. Image decoding is in `src/components/canvas-image.ts`, with decoders imported from `src/deps.ts`.

## Video Component

Video playback component using FFmpeg for decoding. Extends Canvas.

### Basic Usage

```xml
<video
  src="video.mp4"
  width="80"
  height="40"
  autoplay="true"
/>
```

### Supported Sources

| Source Type  | Example                                       | Notes                                    |
|--------------|-----------------------------------------------|------------------------------------------|
| Local files  | `src="video.mp4"`                             | Relative or absolute paths               |
| HTTP/HTTPS   | `src="https://example.com/video.mp4"`         | Requires `net` permission                |
| RTSP streams | `src="rtsp://192.168.1.191:8080/h264.sdp"`    | Live streaming, requires `net` permission |

### RTSP Streaming Example

```bash
./melker.ts examples/canvas/video/video-demo.melker rtsp://192.168.1.191:8080/h264.sdp
```

RTSP streams work with all themes and graphics modes:
- Themes: `fullcolor-dark`, `gray-std`, `bw-std`, etc.
- Graphics modes: `sextant` (default), `block`, `pattern`, `luma`

### Props

| Prop       | Type    | Description                                              |
|------------|---------|----------------------------------------------------------|
| `src`      | string  | Video source (file path, URL, or RTSP URL)               |
| `width`    | number  | Pixel buffer width                                       |
| `height`   | number  | Pixel buffer height                                      |
| `autoplay` | boolean | Start playing immediately                                |
| `loop`     | boolean | Loop playback                                            |
| `muted`    | boolean | Mute audio                                               |
| `dither`   | string  | Dithering algorithm (`auto`, `none`, `sierra-stable`, etc.) |

### Implementation

Located in `src/components/video.ts`. Uses FFmpeg (`src/video/ffmpeg.ts`) for decoding. Video playback is automatically stopped when the engine exits to prevent render-after-cleanup issues.

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
- `fontStyle`
- `textDecoration`
- `dim`
- `reverse`
- `borderColor`

Layout properties (padding, margin, border widths) do NOT inherit.

## Key Files Reference

| File                      | Responsibility                               |
|---------------------------|----------------------------------------------|
| `src/types.ts`            | Core interfaces: Element, Style, Bounds, Props |
| `src/element.ts`          | createElement, component registry            |
| `src/document.ts`         | Document class, element registry, focus      |
| `src/layout.ts`           | LayoutEngine, flexbox algorithm              |
| `src/sizing.ts`           | SizingModel, box model calculations          |
| `src/rendering.ts`        | RenderingEngine, layout-to-buffer            |
| `src/viewport.ts`         | ViewportManager, scrolling support           |
| `src/viewport-buffer.ts`  | ViewportBufferProxy, ViewportDualBuffer      |
| `src/content-measurer.ts` | ContentMeasurer, intrinsic size calculation  |
| `src/focus.ts`            | FocusManager, tab navigation                 |
| `src/events.ts`           | EventManager, event dispatching              |

## See Also

- [architecture.md](architecture.md) — Core architecture, layout engine
- [filterable-list-architecture.md](filterable-list-architecture.md) — Combobox, select, autocomplete internals
- [file-browser-architecture.md](file-browser-architecture.md) — File browser internals
- [data-table.md](data-table.md) — Data table component
- [data-bars.md](data-bars.md) — Bar chart components
- [data-heatmap-architecture.md](data-heatmap-architecture.md) — Heatmap with isolines
- [spinner-architecture.md](spinner-architecture.md) — Spinner component internals
- [toast-architecture.md](toast-architecture.md) — Toast notification system
- [tooltip-architecture.md](tooltip-architecture.md) — Tooltip system
