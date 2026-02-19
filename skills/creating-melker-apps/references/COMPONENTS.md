# Melker Component Reference

## Layout Components

### container

Flexbox layout container. The primary building block for layouts. Defaults to `display: flex` with `flex-direction: column` (same as `dialog`, `tab`, and the root viewport).

```xml
<container style="
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  border: thin;
  padding: 1;
  gap: 1;
  overflow: auto;
">
  <!-- children -->
</container>
```

**Props:**
- `style` - CSS-like styling (use `overflow: scroll` or `overflow: auto` for scrolling; scrollable containers are keyboard-focusable with highlighted scrollbar)

**Style properties:**
- `display`: `flex` | `block` | `none` (auto-inferred as `flex` when flex container properties present)
- `flex-direction`: `row` | `column`
- `flex`: grow factor (e.g., `1`)
- `justify-content`: `flex-start` | `center` | `flex-end` | `space-between` | `space-around`
- `align-items`: `flex-start` | `center` | `flex-end` | `stretch`
- `gap`: spacing between children
- `width`, `height`: number, percentage (`50%`), or `fill`
  - `fill` takes *remaining* space after siblings
  - `100%` takes 100% of parent (may overflow with siblings)
- `min-width`, `max-width`, `min-height`, `max-height`: constrain sizing
- `padding`, `margin`: spacing (single number or `padding-top`, etc.)
- `border`: `none` | `thin` | `thick` | `double` | `rounded` | `dashed` | `dashed-rounded` | `ascii` | `ascii-rounded` | `block`
- `overflow`: `visible` | `hidden` | `auto` | `scroll`
- `overflow-x`, `overflow-y`: axis-specific overflow (overrides `overflow` shorthand)
- `arrow-nav`: `geometric` (default) | `none` — controls arrow key focus navigation for descendants
- `position`: `relative` (offset without affecting siblings), `absolute`, `fixed`
- `top`, `right`, `bottom`, `left`: numeric offset (used with `position: relative`)
- `container-type`: `inline-size` (enable `@container` width queries) | `size` (width + height)

### text

Display text content. HTML entities are automatically unescaped.

```xml
<text style="font-weight: bold;">
  Hello World
</text>

<!-- HTML entities work -->
<text>Use &lt;button&gt; for actions</text>  <!-- Displays: Use <button> for actions -->
```

**Props:**
- `id` - Element ID
- `style` - Styling
- `text` - Alternative to inner content

**Style properties:**
- `font-weight`: `normal` | `bold`
- `text-align`: `left` | `center` | `right`
- `text-wrap`: `wrap` | `nowrap`

**HTML entities:** `&lt;` `&gt;` `&amp;` `&quot;` `&apos;` and numeric (`&#60;` `&#x3C;`)

Note: Avoid setting `color` - let the theme engine handle it.

## Input Components

### input

Single-line text input.

```xml
<input
  id="username"
  placeholder="Enter username"
  value=""
  format="text"
  onInput="$app.handleInput(event.value)"
  onKeyPress="if (event.key === 'Enter') $app.submit()"
/>
```

**Props:**
- `id` - Element ID
- `placeholder` - Placeholder text
- `value` - Current value
- `format`: `text` | `password` (masks with `*`)
- `onInput` - Called on value change (`event.value`)
- `onKeyPress` - Called on key press (`event.key`)
- `onFocus`, `onBlur` - Focus events

**Methods:**
- `getValue()` - Get current value
- `setValue(value)` - Set value

### textarea

Multi-line text input.

```xml
<textarea
  id="notes"
  placeholder="Enter notes..."
  rows="5"
  cols="40"
  wrap="soft"
  maxLength="1000"
/>
```

**Props:**
- `id`, `placeholder`, `value` - Same as input
- `rows` - Number of visible rows
- `cols` - Number of visible columns
- `wrap`: `soft` | `hard` | `off`
- `maxLength` - Maximum characters

### checkbox

Toggle checkbox.

```xml
<checkbox
  id="agree"
  title="I agree to terms"
  checked="false"
  onChange="$app.handleChange(event.checked)"
/>
```

**Props:**
- `id` - Element ID
- `title` - Label text
- `checked` - Boolean state
- `onChange` - Called on toggle (`event.checked`)

### radio

Radio button (use `name` for grouping).

```xml
<radio id="opt1" title="Option 1" name="options" value="1" />
<radio id="opt2" title="Option 2" name="options" value="2" />
<radio id="opt3" title="Option 3" name="options" value="3" checked="true" />
```

**Props:**
- `id` - Element ID
- `title` - Label text
- `name` - Group name (only one can be selected per group)
- `value` - Value when selected
- `checked` - Selected state
- `onChange` - Called on selection

## Button & Dialog

### button

Clickable button. Supports content syntax or `label` prop.

```xml
<!-- Content syntax (preferred) -->
<button onClick="$app.handleSubmit()">Submit</button>

<!-- Prop syntax -->
<button label="Submit" onClick="$app.handleSubmit()" />
```

**Props:**
- `id` - Element ID
- `label` - Button text (can also use content: `<button>Label</button>`)
- `onClick` - Click handler
- `style` - Styling

**Notes:**
- Buttons render with `[ ]` brackets by default. Don't add `border` to buttons or you'll get double brackets like `[ [ Button ] ]`.
- For default `[ ]` buttons, vertical padding is ignored (buttons stay single-line). Horizontal padding adds space around the brackets.
- Let the theme engine handle button styling.

### dialog

Modal dialog overlay. Defaults to flex column layout.

```xml
<dialog
  id="myDialog"
  title="Dialog Title"
    modal="true"
  backdrop="true"
  draggable="true"
  width="40"
  height="20"
>
  <container style="padding: 1;">
    <text>Dialog content</text>
    <button label="Close" onClick="$app.closeDialog()" />
  </container>
</dialog>
```

**Props:**
- `id` - Element ID
- `title` - Dialog title bar text
- `open` - Visibility (`true`|`false`)
- `modal` - Block interaction with background
- `backdrop` - Show darkened backdrop
- `draggable` - Allow dragging by title bar
- `width`, `height` - Dialog dimensions (number, "50%", or "fill")

**Methods:**
- `show()` - Open the dialog
- `hide()` - Close the dialog
- `setVisible(bool)` - Set visibility

**Pattern:**
```xml
<script>
  export function openDialog() {
    $melker.getElementById('myDialog').show();
  }
  export function closeDialog() {
    $melker.getElementById('myDialog').hide();
  }
</script>
```

### file-browser

File system browser for selecting files and directories. Auto-initializes when rendered.

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

**Props:**
- `path` - Initial directory (default: current working directory)
- `selectionMode` - `single` | `multiple`
- `selectType` - `file` | `directory` | `both`
- `filter` - `fuzzy` | `prefix` | `contains` | `exact` | `none`
- `showHidden` - Show dotfiles
- `extensions` - Filter by extensions, e.g. `['.ts', '.js']`
- `showFilter` - Show filter input (default: true)
- `showBreadcrumb` - Show path bar (default: true)
- `showButtons` - Show Cancel/Open buttons (default: true)
- `showSize` - Show file sizes (default: true)
- `maxVisible` - Visible rows (default: 10)
- `selectLabel` - Open button label (default: "Open")
- `cancelLabel` - Cancel button label (default: "Cancel")

**Events:**
- `onSelect` - `event.path` (string), `event.paths` (array), `event.isDirectory`
- `onCancel` - Called when cancelled
- `onNavigate` - Called when navigating to new directory
- `onError` - `event.code`, `event.message`

**Keyboard:**
- Arrow keys - navigate list
- Enter - open directory / select file
- Backspace - go to parent directory
- Escape - cancel
- Type to filter

**Permission:** Requires `read` permission. Apps without policy have `read: ["cwd"]` by default; use `read: ["*"]` for full filesystem access.

## Tabs

### tabs / tab

Tabbed interface. Each `tab` defaults to flex column layout.

```xml
<tabs id="settings" onChange="$app.onChange(event.tabId, event.index)">
  <tab id="general" title="General">
    <text>General settings content</text>
  </tab>
  <tab id="advanced" title="Advanced">
    <text>Advanced settings content</text>
  </tab>
  <tab id="about" title="About" disabled="true">
    <text>About content</text>
  </tab>
</tabs>

<!-- To start on a specific tab -->
<tabs id="settings" activeTab="advanced">...</tabs>
```

**tabs Props:**
- `id` - Element ID
- `activeTab` - Active tab id (must match a tab's id attribute)
- `onChange` - Called on tab switch (`event.tabId`, `event.index`)

**tab Props:**
- `id` - Tab ID (used for activeTab reference)
- `title` - Tab label
- `disabled` - Disable tab

## Data Table

### data-table

High-performance table for large datasets with simple array-based data.

**Inline JSON (simplest):**
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
    { "header": "Notes" }
  ],
  "rows": [
    [1, "Alice", "Active", "Engineer"],
    [2, "Bob", "Away", "Designer"],
    [3, "Carol", "Active", "Manager"]
  ]
}
</data-table>
```

**Dynamic data via script:**
```xml
<script type="typescript">
  export const columns = [
    { header: 'ID', width: 5, align: 'right' as const },
    { header: 'Name', width: '30%' as const },
  ];
  export let rows: (string | number)[][] = [];

  export async function loadData() {
    // Fetch data from API, populate rows
    rows = [[1, 'Alice'], [2, 'Bob']];
    const table = $melker.getElementById('users');
    if (table) {
      table.setValue(rows);
      $melker.render();
    }
  }
</script>

<script type="typescript" async="ready">
  const table = $melker.getElementById('users');
  if (table) table.props.columns = $app.columns;  // columns still use props
</script>

<data-table id="users" style="width: fill; height: 20;" selectable="single" />
```

**Props:**
- `columns` - Column definitions (set via script, not attribute)
- `rows` - Row data as 2D array (set via script)
- `footer` - Footer rows (optional)
- `rowHeight` - Lines per row (default: 1)
- `showHeader` - Show header (default: true)
- `showFooter` - Show footer (default: true)
- `showColumnBorders` - Column separators (default: false)
- `border` - Border style (default: 'thin')
- `sortColumn` - Initial sort column index
- `sortDirection` - `asc` | `desc`
- `selectable` - `none` | `single` | `multi`
- `onSelect` - Selection handler (`event.rowIndex`, `event.selectedRows`)
- `onActivate` - Enter/double-click handler (`event.rowIndex`)
- `onSort` - Sort notification (optional, sorting works without it)

**Column definition:**
```typescript
{ header: 'Name', width: '20%', align: 'right', sortable: true }
```
- `width`: number (chars), `'20%'`, or `'fill'`
- `align`: `'left'` | `'center'` | `'right'`
- `sortable`: boolean (default: true)

**Notes:**
- Use inline JSON for static data (simplest), script for dynamic data
- Can mix: inline columns + script-set rows
- JSON parse errors are logged to the logging system
- Sorting is automatic - click headers to sort, no handler needed
- Events report original row indices (not sorted positions)
- Use for large datasets; use `<table>` for complex cell content

### data-bars

Data-driven bar charts with support for horizontal/vertical orientation, stacked/grouped bars, and sparkline mode.

```xml
<!-- Simple horizontal bars -->
<data-bars
  series='[{"name": "Sales"}]'
  bars='[[100], [150], [80], [120]]'
  labels='["Q1", "Q2", "Q3", "Q4"]'
  showValues="true"
/>

<!-- Grouped bars (multiple series) -->
<data-bars
  series='[{"name": "2023"}, {"name": "2024"}]'
  bars='[[50, 65], [60, 80], [45, 70]]'
  labels='["Q1", "Q2", "Q3"]'
  showValues="true"
/>

<!-- Stacked bars -->
<data-bars
  series='[{"name": "A", "stack": "total"}, {"name": "B", "stack": "total"}]'
  bars='[[30, 20], [25, 35], [40, 25]]'
  labels='["Jan", "Feb", "Mar"]'
  showValues="true"
  valueFormat="sum"
/>

<!-- Vertical bars -->
<data-bars
  series='[{"name": "Sales"}]'
  bars='[[40], [75], [55], [90]]'
  labels='["Q1", "Q2", "Q3", "Q4"]'
  showValues="true"
  style="orientation: vertical; height: 10"
/>

<!-- Sparkline (no labels, height: 1) -->
<data-bars
  series='[{"name": "CPU"}]'
  bars='[[10], [25], [40], [55], [70], [85], [75], [60]]'
  showValues="true"
  style="orientation: vertical; height: 1; gap: 0"
/>
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `series` | `DataBarSeries[]` | required | Series definitions |
| `bars` | `number[][][]` | required | 2D array: `bars[entry][series]` |
| `labels` | `string[]` | - | Category labels |
| `showLabels` | `boolean` | `true` | Show labels |
| `showValues` | `boolean` | `false` | Show values |
| `valueFormat` | `string` | auto | `'value'` \| `'sum'` \| `'last/max'` \| `'percent'` |
| `showLegend` | `boolean` | `false` | Show series legend |
| `min` | `number` | auto | Minimum scale value |
| `max` | `number` | auto | Maximum scale value |
| `selectable` | `boolean` | `false` | Enable bar selection |
| `onHover` | `handler` | - | Hover event |
| `onSelect` | `handler` | - | Selection event |

**Style props** (via `style=""`):

| Style | Type | Default | Description |
|-------|------|---------|-------------|
| `orientation` | `string` | `'horizontal'` | `'horizontal'` \| `'vertical'` |
| `barWidth` | `number` | `1` | Bar thickness in chars |
| `gap` | `number` | `1` | Gap between entries |
| `barStyle` | `string` | `'solid'` | `'solid'` \| `'led'` (LED meter style) |
| `ledWidth` | `number` | `3`/`1` | LED segment width (default: 3 horizontal, 1 vertical) |
| `highValue` | `number` | `80` | Threshold % for warning color (LED mode) |
| `ledColorLow` | `string` | `'yellow'` | Color below threshold (LED mode) |
| `ledColorHigh` | `string` | `'red'` | Color at/above threshold (LED mode) |

**LED mode example:**
```xml
<data-bars
  series='[{"name": "CPU"}]'
  bars='[[85]]'
  labels='["Usage"]'
  showValues="true"
  style="bar-style: led"
/>
```
Output: `Usage ██▊██▊██▊██▊██▊██▊██▊██▊██▊  85%` (yellow up to 80%, red above)

LED mode creates retro LED meter visuals with gaps between segments. Each segment = (ledWidth-1) full blocks + 1 partial LED char (`▊` horizontal, `▆` vertical). The gap comes from the partial character shape. **Defaults to 0-100 scale** (no need to set `min`/`max`). Color transitions from `ledColorLow` to `ledColorHigh` at `highValue` threshold (default: 80%). Works for single-series and grouped multi-series (stacked bars fall back to solid).

**LED with custom colors:**
```xml
<data-bars
  series='[{"name": "Temp"}]'
  bars='[[70]]'
  labels='["CPU"]'
  style="bar-style: led; high-value: 60; led-color-low: green; led-color-high: orange"
/>
```

**Series definition:**
```typescript
{ name: 'Series A', color: '#ff0000', stack: 'group1' }
```
- `name`: Series label
- `color`: Optional color override
- `stack`: Stack group ID (series with same stack are stacked)

**Streaming API (for real-time sparklines):**
```typescript
const sparkline = $melker.getElementById('mySparkline');
sparkline.appendEntry([value]);  // Add new data point
sparkline.shiftEntry();          // Remove oldest point
sparkline.getValue();            // Get current bars array
$melker.render();
```

**Text Selection:**
- Supports mouse text selection - copies selected entries as JSON to clipboard
- Output format matches input: `{ series, bars, labels }` but only for selected entries
- Horizontal bars: selection uses Y coordinates (row-based)
- Vertical bars: selection uses X coordinates (column-based)

**Notes:**
- In BW mode, multi-series uses patterns (█▓▒░) instead of colors
- Sparkline mode: omit `labels`, set `height: 1`, `gap: 0`
- Stacked bars: use same `stack` value on series to stack them
- Auto-detects valueFormat: `'sum'` for stacked, `'last/max'` for sparklines

### data-heatmap

Data-driven heatmap for 2D value grids with color scales and optional isolines (contour lines).

```xml
<!-- Simple heatmap -->
<data-heatmap
  grid='[[1, 2, 3], [4, 5, 6], [7, 8, 9]]'
  rowLabels='["A", "B", "C"]'
  colLabels='["X", "Y", "Z"]'
/>

<!-- With isolines -->
<data-heatmap
  grid='[[10, 20, 30], [25, 50, 35], [30, 40, 20]]'
  isolines='[{"value": 25, "label": "25"}, {"value": 40, "label": "40"}]'
  showIsolineLabels="true"
  colorScale="thermal"
/>

<!-- With values displayed -->
<data-heatmap
  grid='[[12, 45, 78], [23, 56, 89], [34, 67, 99]]'
  showValues="true"
  valueFormat="d"
  showLegend="true"
/>

<!-- Inline JSON -->
<data-heatmap>
{
  "grid": [[1, 2], [3, 4]],
  "rowLabels": ["Row1", "Row2"],
  "colLabels": ["Col1", "Col2"]
}
</data-heatmap>

<!-- Isolines only (no cell backgrounds) -->
<data-heatmap
  grid='[[10, 20, 30, 40], [20, 40, 50, 60], [30, 50, 70, 80], [40, 60, 80, 90]]'
  isolines='[{"value": 35}, {"value": 55}, {"value": 75}]'
  showCells="false"
  showIsolineLabels="true"
/>

<!-- Auto-generated isolines -->
<data-heatmap
  grid='[[10, 20, 30], [40, 50, 60], [70, 80, 90]]'
  isolineCount="3"
  isolineMode="nice"
  showIsolineLabels="true"
/>
```

**Props:**
- `grid` - 2D array: `grid[row][col]` (null = missing data)
- `rows`, `cols` - Initial dimensions (for sizing when grid is empty)
- `rowLabels`, `colLabels` - Axis labels
- `min`, `max` - Value range (auto-calculated if not specified)
- `colorScale` - `viridis` (default), `plasma`, `inferno`, `thermal`, `grayscale`, `diverging`, `greens`, `reds`
- `isolines` - Array of `{value, color?, label?}` for contour lines (manual)
- `isolineCount` - Auto-generate N isolines (overrides `isolines` if set)
- `isolineMode` - Algorithm for auto-generation: `equal` (default), `quantile`, `nice`
- `showIsolineLabels` - Show labels on isolines
- `showCells` - Show cell backgrounds (default: true). Set to false for isolines-only display
- `showValues` - Display numeric values in cells
- `valueFormat` - `d`, `.1f`, `.2f`, `.0%`, `.1%`
- `minCellWidth` - Minimum cell width in characters
- `showLegend` - Show color scale legend
- `showAxis` - Show axis labels (default: true)
- `selectable` - Enable cell selection
- `onHover`, `onSelect` - Event handlers

**Style props:**
- `cellWidth` - Cell width in characters (default: 2, auto-sizes for values)
- `cellHeight` - Cell height in characters (default: 1)
- `gap` - Gap between cells (default: 0, min 1 when isolines present)

**API:**
```typescript
const hm = $melker.getElementById('heatmap');
hm.getValue();                    // Get entire grid
hm.setValue(grid);                // Set entire grid
hm.getCell(row, col);             // Get single cell
hm.setCell(row, col, value);      // Set single cell
hm.setRow(row, values);           // Set entire row
hm.setColumn(col, values);        // Set entire column
```

**Notes:**
- Isolines use marching squares algorithm with box-drawing characters
- Box-drawing characters are placed at cell centers
- Auto-isolines: `isolineCount` with `isolineMode` (`equal`, `quantile`, `nice`) generates isolines automatically
- In BW mode, uses pattern characters (░▒▓█) instead of colors
- Supports text selection - copies selected region as JSON

### data-tree

Data-driven tree view for hierarchical data with expand/collapse, selection, keyboard navigation, multi-column support, and virtual scrolling.

```xml
<!-- Single-column tree -->
<data-tree
  selectable="single"
  expandAll="true"
  tooltip="auto"
  onChange="$app.handleSelect(event)"
  onActivate="$app.handleActivate(event)"
>
{
  "nodes": [
    {
      "label": "src",
      "children": [
        { "label": "engine.ts", "value": "12,450 B" },
        { "label": "layout.ts", "value": "8,200 B" }
      ]
    },
    { "label": "README.md", "value": "580 B" }
  ]
}
</data-tree>

<!-- Multi-column tree -->
<data-tree
  columns='[{"header": "Size", "width": 10, "align": "right"}, {"header": "Type", "width": 6}]'
  showColumnBorders="true"
  selectable="single"
>
{
  "nodes": [
    {
      "label": "src",
      "values": ["", "dir"],
      "children": [
        { "label": "engine.ts", "values": ["12,450 B", "ts"] }
      ]
    }
  ]
}
</data-tree>
```

**Props:**
- `nodes` - Array of TreeNode objects (or inline JSON with `{ "nodes": [...] }`)
- `showConnectors` - Show branch connector lines (default: true)
- `indent` - Characters per indent level (default: 2)
- `expandAll` - Start fully expanded (default: false)
- `showValues` - Show value column in single-column mode (default: false)
- `border` - Border style (default: 'thin')
- `columns` - Additional value columns (tree column is implicit first)
- `showColumnBorders` - Show column separators (default: false)
- `showHeader` - Show column headers (default: true when columns defined)
- `selectable` - 'none', 'single', 'multi' (default: 'none')
- `selectedNodes` - Controlled selection by node ID
- `onChange`, `onActivate`, `onExpand`, `onCollapse` - Event handlers

**Style props:**
- `border-color` - Color for box border
- `connector-color` - Color for tree connector lines and icons (default: gray)

**TreeNode:**
```typescript
{ id?, label, value?, values?, children?, expanded?, disabled? }
```

**API:**
```typescript
const tree = $melker.getElementById('tree');
tree.getValue();                      // Get TreeNode[]
tree.setValue(nodes);                  // Set tree data
tree.expandNode(nodeId);              // Expand node
tree.collapseNode(nodeId);            // Collapse node
tree.expandAll();                     // Expand all
tree.collapseAll();                   // Collapse all
tree.setChildren(nodeId, children);   // Replace children (lazy loading)
tree.getSelectedNodes();              // Get selected IDs
tree.scrollToNode(nodeId);            // Scroll to node
```

**Notes:**
- Node IDs auto-generated from label path (e.g., `src/engine.ts`) if `id` omitted
- `setChildren()` enables lazy loading — listen for `onExpand`, fetch data, call `setChildren()`
- Keyboard: Arrow keys navigate, Left/Right expand/collapse, Enter activates, Space toggles
- Supports tooltip with `tooltip="auto"` showing node path and values

### table / thead / tbody / tr / th / td

HTML-like table for complex cell content (buttons, inputs, etc.).

```xml
<table border="thin" style="width: 60;">
  <thead>
    <tr>
      <th width="20">Name</th>
      <th width="fill">Actions</th>
    </tr>
  </thead>
  <tbody selectable="single" onSelect="$app.handleSelect(event)">
    <tr data-id="1">
      <td>Alice</td>
      <td><button label="Edit" onClick="$app.edit(1)" /></td>
    </tr>
    <tr data-id="2">
      <td>Bob</td>
      <td><button label="Edit" onClick="$app.edit(2)" /></td>
    </tr>
  </tbody>
</table>
```

**Table props:**
- `border` - Border style (thin, thick, double, etc.)
- `columnBorders` - Show internal column borders (default: true)
- `resizable` - Allow column resizing (default: false)
- `sortColumn`, `sortDirection`, `onSort` - Sorting

**Cell props (th/td):**
- `width` - Column width: number (chars), percentage, or `'fill'`
- `align` - `left` | `center` | `right`
- `valign` - `top` | `center` | `bottom`
- `colspan`, `rowspan` - Cell spanning
- `sortable` - Enable sorting on this column (th only)

**tbody props:**
- `selectable` - `none` | `single` | `multi`
- `maxHeight` - Scrollable height
- `onSelect`, `onActivate` - Selection callbacks

**Notes:**
- Use `data-table` for simple array data; use `table` for complex cells
- Row `data-id` is returned in selection events

## Lists

### list / li

List container with items.

```xml
<list style="border: thin; height: 10;">
  <li style="padding: 0 1;">Item 1</li>
  <li style="padding: 0 1;">Item 2</li>
  <li style="padding: 0 1;">Item 3</li>
</list>
```

## Filterable Lists

**Note:** In column containers, these components stretch to full width by default. Wrap in a row container to use intrinsic width:

```xml
<container style="flex-direction: column">
  <container style="flex-direction: row">
    <select>...</select>
  </container>
</container>
```

### combobox

Dropdown with text filter.

```xml
<combobox
  id="country"
  placeholder="Select country..."
  filter="fuzzy"
  maxVisible="8"
  onSelect="$app.onSelect(event.value, event.label)"
>
  <group label="North America">
    <option value="us">United States</option>
    <option value="ca">Canada</option>
  </group>
  <group label="Europe">
    <option value="uk">United Kingdom</option>
    <option value="de">Germany</option>
  </group>
</combobox>
```

**Props:**
- `placeholder` - Placeholder text
- `filter`: `fuzzy` | `prefix` | `contains` | `exact`
- `maxVisible` - Max visible options
- `onSelect` - Selection handler (`event.value`, `event.label`)
- `width` or `style.width` - Explicit width (dropdown can expand to fit content)
- `dropdownWidth` - Override dropdown width

**Methods:**
- `getValue()` - Get selected value
- `setValue(value)` - Set selected value (also updates input display)

### select

Simple dropdown picker (no filter).

```xml
<select id="size" value="medium" onChange="$app.onSelect(event.value)">
  <option value="small">Small</option>
  <option value="medium">Medium</option>
  <option value="large">Large</option>
</select>
```

**Props:**
- `value` - Selected value
- `onChange` - Selection handler (`event.value`)
- `width` or `style.width` - Explicit width (dropdown can expand to fit content)
- `dropdownWidth` - Override dropdown width

**Methods:**
- `getValue()` - Get selected value
- `setValue(value)` - Set selected value

### autocomplete

Async search dropdown.

```xml
<autocomplete
  id="search"
  placeholder="Search..."
  onSearch="$app.search(event.query)"
  onSelect="$app.onSelect(event.value)"
  debounce="300"
  minChars="2"
/>
```

**Props:**
- `onSearch` - Called with query (`event.query`)
- `debounce` - Debounce delay in ms
- `minChars` - Minimum chars before search

**Methods:**
- `getValue()` - Get selected value
- `setValue(value)` - Set selected value (also updates input display)

### command-palette

Modal command picker (opens with Ctrl+K).

```xml
<command-palette
  id="palette"
    onSelect="$app.runCommand(event.value)"
  width="50"
>
  <group label="File">
    <option value="new" shortcut="Ctrl+N">New File</option>
    <option value="open" shortcut="Ctrl+O">Open File</option>
  </group>
</command-palette>
```

### option / group

Children of filterable lists.

```xml
<option value="id" disabled="false" shortcut="Ctrl+X">Label</option>
<group label="Group Name">
  <!-- options -->
</group>
```

## Diagram Components

### connector

Draw lines between elements. Uses box-drawing characters for clean orthogonal routing.

```xml
<container style="flex-direction: row; gap: 4">
  <container id="box-a" style="border: thin; padding: 1">Source</container>
  <container id="box-b" style="border: thin; padding: 1">Target</container>
  <connector from="box-a" to="box-b" arrow="end" />
</container>
```

**Props:**
- `from` - Source element ID (required)
- `to` - Target element ID (required)
- `fromSide`: `auto` | `top` | `bottom` | `left` | `right` | `center`
- `toSide`: `auto` | `top` | `bottom` | `left` | `right` | `center`
- `arrow`: `none` | `start` | `end` | `both` (default: `end`)
- `label` - Text at midpoint
- `routing`: `direct` | `orthogonal` (default: `orthogonal`)
- `style` - `color`, `lineStyle` (`thin`, `thick`, `double`, `dashed`)

### graph

Render diagrams from Mermaid syntax or JSON. Auto-detects diagram type.

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
    Animal <|-- Dog
</graph>

<!-- Load from URL -->
<graph src="./flow.mmd" />
```

**Props:**
- `type`: `mermaid` | `json` (auto-detected)
- `src` - Load from URL
- `text` - Inline content
- `style` - Container styling (use `overflow: scroll` for scrolling)

**Supported Mermaid:**
- Flowcharts: `flowchart TB/LR/BT/RL`, nodes `[rect]` `{diamond}` `((circle))`, edges `-->` `-.->` `==>`, labels `-->|text|`, subgraphs
- Sequence: `sequenceDiagram`, participants, messages `->>` `-->>`, notes, fragments `alt`/`opt`/`loop`
- Class: `classDiagram`, classes with members, relationships `<|--` `*--` `o--` `-->`

## Media Components

### canvas

Pixel graphics using Unicode characters. Sextant (2x3 per cell) on full Unicode terminals, half-block (1x2 per cell) on basic terminals (TERM=linux), block (1x1) on ASCII terminals.

```xml
<canvas
  id="myCanvas"
  width="60"
  height="20"
  onPaint="$app.draw(event.canvas)"
/>
```

**Important:** Use `width`/`height` **props** (not `style.width`/`style.height`) to set the pixel buffer size. `style.width` only affects layout positioning, not the actual buffer resolution. The `img` component supports responsive prop values like `"100%"` and `"fill"` that auto-resize on container changes.

**Props:**
- `width`, `height` - Dimensions in terminal cells (defines pixel buffer size)
- `dither`: `auto` | `sierra-stable` | `floyd-steinberg` | `ordered` | `none`
- `ditherBits` - Color depth (1-8)
- `gfxMode`: `sextant` | `halfblock` | `block` | `pattern` | `luma` | `sixel` | `kitty` | `iterm2` | `hires`
- `onPaint` - Draw callback (`event.canvas`)
- `onShader` - Per-pixel shader callback, runs every frame (see Shaders section)
- `onFilter` - One-time filter callback, runs once when image loads (same signature as onShader, time=0)

**Canvas API:**
```typescript
// Buffer info
canvas.getBufferSize();      // { width, height } in pixels
canvas.getBufferWidth();     // Buffer width in pixels
canvas.getBufferHeight();    // Buffer height in pixels
canvas.getVisualSize();      // Aspect-corrected size
canvas.getPixelAspectRatio(); // ~0.67 for sextant, ~1.0 for halfblock

// Drawing
canvas.clear();
canvas.setPixel(x, y);
canvas.drawLine(x1, y1, x2, y2);
canvas.fillRect(x, y, width, height);
canvas.drawCircleCorrected(x, y, radius);  // Aspect-corrected circle
canvas.drawSquareCorrected(x, y, size);    // Aspect-corrected square
canvas.drawImage(image, dx, dy, dw, dh);
canvas.drawImageRegion(image, sx, sy, sw, sh, dx, dy, dw, dh);
canvas.markDirty();  // Mark for re-render

// Image decoding
canvas.decodeImageBytes(bytes);            // sync: PNG/JPEG/GIF -> { width, height, data, bytesPerPixel }
await canvas.decodeImageBytesAsync(bytes); // async: all formats including WebP

// Polygon drawing
canvas.fillPoly(points);                   // Fill polygon (scanline, even-odd rule)
canvas.drawPoly(points);                   // Draw polygon outline
canvas.fillPolyColor(points, color);       // Fill polygon with specific color
canvas.drawPolyColor(points, color);       // Draw polygon outline with specific color
canvas.fillCircleCorrectedColor(x, y, r, color);  // Fill aspect-corrected circle with color
```

**Tooltip support:**

Canvas supports `onTooltip` for contextual hover tooltips. The handler receives `event.context` with `pixelX`, `pixelY` (buffer pixel coordinates) and `color` (packed RGBA).

```xml
<canvas id="chart" width="60" height="20" onPaint="$app.draw(event.canvas)" onTooltip="$app.chartTooltip(event)" />
```

```javascript
export function chartTooltip(event) {
  if (!event.context) return undefined;
  const { pixelX, pixelY, color } = event.context;
  return `**Pixel** (${pixelX}, ${pixelY})`;
}
```

**Graphics modes** (per-element `gfxMode` prop or global `--gfx-mode` flag):
- `sextant` - Unicode sextant chars (default, 2x3 pixels per cell)
- `halfblock` - Half-block chars `▀▄█` (1x2 pixels per cell, auto on TERM=linux)
- `block` - Colored spaces (1x1 pixel per cell, ASCII fallback)
- `pattern` - ASCII chars with spatial mapping
- `luma` - ASCII chars based on brightness
- `sixel` - True pixels via Sixel protocol (requires terminal support)
- `kitty` - True pixels via Kitty protocol (requires terminal support)
- `iterm2` - True pixels via iTerm2 protocol (WezTerm, Rio, Konsole, iTerm2)
- `hires` - Auto-select best available (kitty → sixel → iterm2 → sextant/halfblock/block)

Global `MELKER_GFX_MODE` env var or `--gfx-mode` flag overrides per-element prop.

### img

Image display (PNG, JPEG, GIF, WebP). Supports file paths, HTTP/HTTPS URLs, and data URLs.

```xml
<!-- From file -->
<img src="./image.png" width="40" height="20" />

<!-- From HTTP/HTTPS URL (requires net permission) -->
<img src="https://example.com/image.png" width="40" height="20" />

<!-- From data URL (inline base64) -->
<img src="data:image/png;base64,iVBORw0KGgo..." width="40" height="20" />
```

**Props:**
- `src` - Image path, HTTP/HTTPS URL, or data URL
- `width`, `height` - Dimensions (number or percentage)
- `dither` - Dithering mode
- `gfxMode` - Graphics mode: `sextant`, `halfblock`, `block`, `pattern`, `luma`, `sixel`, `kitty`, `iterm2`, `hires` (global overrides)
- `onLoad`, `onError` - Load callbacks
- `onShader`, `shaderFps`, `shaderRunTime` - Animation (see Shaders)
- `onFilter` - One-time filter callback, runs once when image loads (same signature as onShader, time=0)

**Styles:**
- `object-fit` - `contain` | `cover` | `fill` (default for img: `fill`)

**Methods:**
- `setSrc(url)` - Load image immediately (async, last call wins if called rapidly)
- `setSource(url)` - Set props.src and clear existing image (loads during next render)
- `clearImage()` - Clear the loaded image
- `loadImage(url)` - Low-level async load (same as setSrc)
- `setSize(w, h)` - Resize canvas buffer (updates internal size, not props)

**Dynamic image switching:**
```typescript
// Preferred: setSrc loads immediately
const img = $melker.getElementById('my-image');
await img.setSrc('https://example.com/image.png');  // or file path or data URL
```

### Shaders (canvas/img)

Per-pixel shader callbacks for animated effects. **Prefer `<img>` over `<canvas>`** for shaders - images scale better on resize.

```xml
<img
  src="image.png"
  width="60"
  height="20"
  onShader="$app.waveEffect"
  shaderFps="30"
  shaderRunTime="5000"
/>
```

```typescript
export function waveEffect(x, y, time, resolution, source, utils) {
  // Distort source image with wave
  const offset = Math.sin(y * 0.1 + time * 2) * 3;
  return source.getPixel(x + offset, y);
}
```

**Shader callback params:**
- `x, y` - Pixel coordinates
- `time` - Elapsed seconds
- `resolution` - `{ width, height, pixelAspect }`
- `source` - `getPixel(x, y)`, `mouse`, `mouseUV`
- `utils` - `noise2d`, `simplex2d`, `simplex3d`, `perlin2d`, `perlin3d`, `fbm`, `fbm3d`, `palette`, `smoothstep`, `mix`, `fract`

**Mouse tracking:** Automatic. `source.mouse` (pixel coords) and `source.mouseUV` (0-1 normalized) update as mouse moves over the element. Values are -1 when mouse is outside.

**Props:**
- `onShader` - Shader function (returns RGBA packed int or `[r,g,b,a]`)
- `shaderFps` - Frame rate (default: 30)
- `shaderRunTime` - Stop after N ms (freeze final frame)

**Permission:** Requires `shader: true` in policy.

### markdown

Render markdown content with full CommonMark support including images.

```xml
<markdown
  src="./README.md"
  onLink="$app.handleLink(event.url)"
/>
<!-- or -->
<markdown text="# Heading\n\nParagraph text" />
```

**Props:**
- `src` - Markdown file path
- `text` - Inline markdown
- `onLink` - Link click handler (`event.url`)
- `enableGfm` - Enable GitHub Flavored Markdown (tables, strikethrough)

**Supported Syntax:**
- Headings, paragraphs, lists (ordered/unordered)
- Bold, italic, inline code
- Code blocks with syntax highlighting
- Blockquotes, horizontal rules
- Links (clickable via `onLink`)
- Images: `![alt text](path/to/image.png)` - rendered at full width, aspect ratio preserved
- Tables (with `enableGfm="true"`)
- HTML `<img>` tags with width/height attributes (e.g., `width="50%"`)

### video

Video playback (requires ffmpeg).

```xml
<video
  src="./video.mp4"
  width="80"
  height="24"
  autoplay="true"
  loop="false"
  audio="true"
/>
```

**Props:**
- `src` - Video file path
- `width`, `height` - Dimensions in terminal cells
- `autoplay` - Start playing automatically (default: true)
- `loop` - Loop playback (default: false)
- `fps` - Target frame rate (default: 24)
- `audio` - Enable audio via ffplay (default: false)
- `muted` - Mute audio (default: false)
- `volume` - Audio volume 0-100 (default: 100)
- `subtitle` - Path to .srt subtitle file
- `startTime` - Start time (e.g., "1:30", "0:05:30", "90")
- `dither` - Dithering mode for B&W themes
- `onFrame`, `onEnd` - Callbacks

### progress

Progress bar.

```xml
<progress
  id="loading"
  value="50"
  max="100"
  style="width: 30;"
/>
```

### spinner

Animated loading indicator with optional text or cycling verbs.

```xml
<!-- Basic spinner -->
<spinner text="Loading..." />

<!-- Different variants -->
<spinner variant="dots" text="Processing" />
<spinner variant="braille" text="Computing" />
<spinner variant="pulse" text="Waiting" />

<!-- With cycling verb theme -->
<spinner variant="dots" verbs="thinking" />

<!-- With custom verbs (comma-separated) -->
<spinner variant="line" verbs="Analyzing, Optimizing, Finalizing" />

<!-- Text-only with animated shade (no spinner char) -->
<spinner variant="none" verbs="dreaming" shade="true" />

<!-- Spinner on right side of text -->
<spinner text="Working" textPosition="right" />
```

**Props:**
- `text` - Text displayed beside spinner
- `variant` - Animation style: `none`, `line` (default), `dots`, `braille`, `arc`, `bounce`, `flower`, `pulse`
- `speed` - Frame interval in ms (default: 100)
- `textPosition` - `left` (default) or `right`
- `spinning` - Whether animating (default: true)
- `verbs` - Cycling text: theme name or comma-separated strings
  - Themes: `loading`, `thinking`, `working`, `waiting`, `fetching`, `saving`, `dreaming`, `conjuring`, `brewing`, `weaving`, `unfolding`, `stargazing`
- `verbSpeed` - Verb cycle interval in ms (default: 800)
- `shade` - Enable animated brightness wave across text
- `shadeSpeed` - Shade wave speed in ms per character (default: 60)

**Methods:**
- `start()` - Start animation
- `stop()` - Stop animation
- `getValue()` - Get text value
- `setValue(text)` - Set text value

**Notes:**
- All spinners share a single timer for efficiency
- `none` variant shows text/verbs only (no spinner character)
- Shade effect creates a "spotlight" scanning across text

### slider

Numeric value selection with keyboard/mouse.

```xml
<!-- Basic slider -->
<slider min="0" max="100" value="50" onChange="$app.handleChange(event)" />

<!-- With step increments -->
<slider min="0" max="10" step="1" value="5" showValue="true" />

<!-- With snap points -->
<slider min="0" max="100" snaps="[0, 25, 50, 75, 100]" value="25" />

<!-- Vertical -->
<slider min="0" max="100" value="50" style="orientation: vertical; height: 8;" />
```

**Props:**
- `min` / `max` - Range (default: 0-100)
- `value` - Current value
- `step` - Discrete increments (e.g., 5 = 0,5,10...)
- `snaps` - Array of snap points `[0, 25, 50, 75, 100]`
- `showValue` - Display value label

**Styles:**
- `orientation` - `horizontal` (default) or `vertical`

**Keyboard:** Arrow keys (small step), Page Up/Down (10%), Home/End (min/max)

### split-pane

Resizable split panels with draggable dividers. Supports N children with N-1 dividers.

```xml
<!-- Horizontal split (default), equal sizes -->
<split-pane style="width: fill; height: fill;">
  <container><text>Left</text></container>
  <container><text>Right</text></container>
</split-pane>

<!-- Vertical split, custom proportions -->
<split-pane sizes="1,2,1" style="width: fill; height: fill; direction: vertical;">
  <container><text>Top</text></container>
  <container><text>Middle</text></container>
  <container><text>Bottom</text></container>
</split-pane>

<!-- Styled dividers with titles -->
<split-pane
  sizes="1,3"
  dividerTitles="Nav"
  style="width: fill; height: fill; divider-style: thick; divider-color: cyan;"
>
  <container><text>Sidebar</text></container>
  <container><text>Content</text></container>
</split-pane>

<!-- Nested: IDE layout -->
<split-pane sizes="1,6,1" style="direction: vertical;">
  <container><text>Header</text></container>
  <split-pane sizes="1,3">
    <container><text>Sidebar</text></container>
    <container><text>Editor</text></container>
  </split-pane>
  <container><text>Footer</text></container>
</split-pane>
```

**Props:**
- `sizes` - Comma-separated proportions, e.g. `"1,2,1"` for 25%/50%/25%
- `dividerTitles` - Comma-separated titles for dividers, e.g. `"Nav,Info"`
- `onResize` - Handler: `{ sizes: number[], dividerIndex: number, targetId: string }`

**Styles:**
- `direction` - `'horizontal'` (default, left/right) or `'vertical'` (top/bottom)
- `min-pane-size` - Minimum pane size in characters (default: 3)
- `divider-style` - Line style: `thin` (default), `thick`, `double`, `dashed`
- `divider-color` - Divider foreground color

**Keyboard:** Tab to focus divider, Left/Right (horizontal) or Up/Down (vertical) to resize

### segment-display

LCD/LED-style digit and text display using Unicode characters.

```xml
<!-- Basic clock -->
<segment-display value="12:45:30" style="height: 5; color: green;" />

<!-- Different renderers -->
<segment-display value="1234567890" renderer="rounded" style="color: cyan;" />
<segment-display value="HELLO" renderer="geometric" style="height: 7; color: yellow;" />

<!-- Pixel renderer (bitmap font glyphs) -->
<segment-display value="Hello World" renderer="pixel" style="height: 5;" />
<segment-display value="Hello World" renderer="pixel" style="height: 7;" />

<!-- Scrolling text -->
<segment-display value="HELLO WORLD" scroll="true" scrollSpeed="24" style="width: 50;" />

<!-- LCD style with off-segments -->
<segment-display value="88:88" style="color: #00ff00; off-color: #003300;" />

<!-- Pixel with custom chars and colors -->
<segment-display value="MELKER" renderer="pixel" style="height: 7; color: cyan; off-color: #003333; pixel-char: #; off-pixel-char: .;" />
```

**Props:**
- `value` - Text to display
- `renderer` - Style: `box-drawing` (default), `rounded`, `geometric`, `pixel`
- `scroll` - Enable horizontal scrolling
- `scrollSpeed` - Speed in ms (default: 24)
- `scrollGap` - Gap between repeated text (default: 3)

**Style:**
- `height` - 5 or 7 rows (default: 5)
- `color` - "On" segment color
- `off-color` - Panel background / "off" segment color (dimmed LCD effect)
- `background-color` - Background (overrides off-color if both set)
- `pixel-char` - Custom "on" character for pixel renderer (default: `█`)
- `off-pixel-char` - Custom "off" character for pixel renderer (default: `░`)

**Character support:** Full A-Z, 0-9, symbols (: . , - _ = " ' [ ] ? ! etc.), accented chars (ISO 8859-1 in pixel mode; Å Ä Ö É È in 7-segment renderers)

**Methods:**
- `getValue()` - Get current value
- `setValue(value)` - Set value

## Command Element

The `<command>` element is a non-visual, declarative keyboard shortcut binding. Commands are auto-discovered by the command palette and AI assistant.

```xml
<!-- Focus-scoped: fires when parent container (or descendants) has focus -->
<container style="border: thin; padding: 1;">
  <command key="Delete,Backspace" label="Delete Item" onExecute="$app.deleteItem()" />
  <command key="n" label="New File" onExecute="$app.newFile()" />
  <text>Editor panel</text>
</container>

<!-- Global: fires regardless of focus -->
<command key="Ctrl+s" label="Save" global onExecute="$app.save()" />
<command key="ArrowLeft,a" label="Move Left" global onExecute="$app.moveLeft()" />

<!-- Disabled command -->
<command key="x" label="Danger" disabled onExecute="$app.danger()" />
```

**Props:**

| Prop        | Type    | Default    | Description                                          |
|-------------|---------|------------|------------------------------------------------------|
| `key`       | string  | -          | Keyboard shortcut, comma-separated for multiple keys |
| `label`     | string  | -          | Human-readable name (shown in palette)               |
| `onExecute` | handler | -          | Callback when command fires                          |
| `group`     | string  | 'Commands' | Palette group name                                   |
| `global`    | boolean | false      | Fire regardless of focus                             |
| `disabled`  | boolean | false      | Temporarily disable                                  |

**Key format:** Comma-separated for multiple bindings. Special values and aliases:

| Value     | Meaning            |
|-----------|--------------------|
| `","`     | Literal comma key  |
| `"comma"` | Alias for comma    |
| `" "`     | Space key          |
| `"Space"` | Alias for space    |
| `"+"`     | Plus key           |
| `"plus"`  | Alias for plus     |

Modifier combos: `Ctrl+S`, `Alt+X`, `Ctrl+Shift+Enter`. Letter keys are **case-insensitive** (`"p"`, `"P"`, `"Shift+P"` all match the same key). Shift is preserved for non-letter keys (`Shift+ArrowUp`, `Shift+Tab`).

**Behavior:**
- Non-visual (`display: none`), skipped by layout
- Focus-scoped commands use innermost-wins: overlapping keys in nested containers resolve naturally
- Containers with commands automatically become focusable via keyboard and mouse click (no manual `tabIndex` needed). Clicking a focusable child inside the container focuses the child, not the container.
- All commands appear as a single entry in the command palette with the key string as a hint
- Global commands are suppressed when overlays are open or when a focused input consumes keys

**When to use `<command>` vs `onKeyPress`:** Use `<command>` for container shortcuts and global app shortcuts. Use `onKeyPress` on input-like components for input-specific keys (e.g., Enter to submit) — input elements consume keys before command dispatch.

## Command Palette Integration

Interactive elements (buttons, inputs, tabs, etc.) are auto-discovered and shown in the command palette (Ctrl+K). The palette can be dragged by its title bar and resets to center when reopened. When selected, each performs its natural action (click, focus, toggle, switch tab).

**Qualifying types:** `button`, `checkbox`, `radio`, `input`, `textarea`, `slider`, `select`, `combobox`, `tab`, `data-table`, `data-tree`

**Props (available on all elements):**

| Prop               | Type              | Default   | Description                                    |
|--------------------|-------------------|-----------|------------------------------------------------|
| `palette`          | `boolean\|string` | `true`*   | `false` to exclude; string to set custom label |
| `palette-shortcut` | `string`          | undefined | Global keyboard shortcut (e.g., `"Ctrl+S"`)   |
| `palette-group`    | `string`          | auto      | Override default group name                    |

\* Default is `true` for qualifying types, `undefined` for non-qualifying types.

```xml
<!-- Auto-included with label "Submit" -->
<button label="Submit" onClick="handleSubmit()">

<!-- Excluded from palette -->
<button label="x" palette={false} onClick="closePanel()">

<!-- Custom label and shortcut -->
<button label="Save" palette="Save Document" palette-shortcut="Ctrl+S" onClick="save()">

<!-- Input with shortcut to jump to it -->
<input placeholder="Search..." palette-shortcut="Ctrl+F">

<!-- Custom group -->
<button label="Undo" palette-group="Edit" palette-shortcut="Ctrl+Z" onClick="undo()">
```

Shortcut conflicts with system keys (Ctrl+C, Tab, F12, etc.) are logged and skipped. Duplicate shortcuts: first in tree order wins.

## Styling Reference

### Border Types
- `none` - No border
- `thin` - Single line
- `thick` - Bold line
- `double` - Double line
- `rounded` - Rounded corners
- `dashed` - Dashed line
- `dashed-rounded` - Dashed with rounded corners
- `ascii` - ASCII characters
- `ascii-rounded` - ASCII with rounded corners
- `block` - Colored spaces (for terminals without Unicode support)

### Border Title
Use `borderTitle` to display a centered title in the top border:
```xml
<container style="border: thin; borderTitle: Settings;">
  <!-- content -->
</container>
```
Renders as: `┌─ Settings ─┐`

### Colors
**Avoid specifying colors** - Let the theme engine handle colors for best appearance across themes.

Only use colors for canvas drawing or very intentional effects. Supported formats: named colors (`black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `gray`, etc.), hex (`#rrggbb`), `rgb()`, `hsl()`, `oklch()`, `oklab()`

### Size Values
- Numbers: `40` (columns/rows)
- Percentages: `100%`, `50%` (works in `style.width`, `style.height`)
- Fill: `fill` (expand to *remaining* available space after siblings)

**Table column widths:**
Use `style.width` on `<th>` elements for column sizing:
```xml
<th style="width: 20%">Name</th>
<th style="width: fill">Description</th>
```
