# Melker Component Reference

## Layout Components

### container

Flexbox layout container. The primary building block for layouts.

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
- `style` - CSS-like styling
- `scrollable` - Enable scrolling (`true`|`false`)

**Style properties:**
- `display`: `flex` | `block` (auto-inferred as `flex` when flex container properties present)
- `flex-direction`: `row` | `column`
- `flex`: grow factor (e.g., `1`)
- `justify-content`: `flex-start` | `center` | `flex-end` | `space-between` | `space-around`
- `align-items`: `flex-start` | `center` | `flex-end` | `stretch`
- `gap`: spacing between children
- `width`, `height`: number, percentage (`50%`), or `fill`
  - `fill` takes *remaining* space after siblings
  - `100%` takes 100% of parent (may overflow with siblings)
- `padding`, `margin`: spacing (single number or `padding-top`, etc.)
- `border`: `none` | `thin` | `thick` | `double` | `rounded` | `dashed` | `dashed-rounded` | `ascii` | `ascii-rounded` | `block`
- `overflow`: `visible` | `hidden` | `auto` | `scroll`

### text

Display text content.

```xml
<text style="font-weight: bold;">
  Hello World
</text>
```

**Props:**
- `id` - Element ID
- `style` - Styling
- `text` - Alternative to inner content

**Style properties:**
- `font-weight`: `normal` | `bold`
- `text-align`: `left` | `center` | `right`
- `text-wrap`: `wrap` | `nowrap`

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

Modal dialog overlay.

```xml
<dialog
  id="myDialog"
  title="Dialog Title"
  open="false"
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
- `width`, `height` - Dialog dimensions

**Pattern:**
```xml
<script>
  export function openDialog() {
    $melker.getElementById('myDialog').props.open = true;
    $melker.render();
  }
  export function closeDialog() {
    $melker.getElementById('myDialog').props.open = false;
    $melker.render();
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

**Permission:** Requires `read` permission in policy.

## Tabs

### tabs / tab

Tabbed interface.

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

### command-palette

Modal command picker (opens with Ctrl+K).

```xml
<command-palette
  id="palette"
  open="false"
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

## Media Components

### canvas

Pixel graphics using Unicode sextant characters (2x3 pixels per cell).

```xml
<canvas
  id="myCanvas"
  width="60"
  height="20"
  onPaint="$app.draw(event.canvas)"
/>
```

**Props:**
- `width`, `height` - Dimensions in terminal cells
- `dither`: `auto` | `sierra-stable` | `floyd-steinberg` | `ordered` | `none`
- `ditherBits` - Color depth (1-8)
- `gfxMode`: `sextant` | `block` | `pattern` | `luma` - Per-element graphics mode
- `onPaint` - Draw callback (`event.canvas`)

**Canvas API:**
```typescript
// Buffer info
canvas.getBufferSize();      // { width, height } in pixels
canvas.getBufferWidth();     // Buffer width in pixels
canvas.getBufferHeight();    // Buffer height in pixels
canvas.getVisualSize();      // Aspect-corrected size
canvas.getPixelAspectRatio(); // ~0.67 for sextant (pixels are taller than wide)

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
canvas.decodeImageBytes(bytes);  // Uint8Array -> { width, height, data, bytesPerPixel }
```

**Graphics modes** (per-element `gfxMode` prop or global `--gfx-mode` flag):
- `sextant` - Unicode sextant chars (default, highest resolution)
- `block` - Colored spaces (no Unicode needed)
- `pattern` - ASCII chars with spatial mapping
- `luma` - ASCII chars based on brightness

Global `MELKER_GFX_MODE` env var or `--gfx-mode` flag overrides per-element prop.

### img

Image display (PNG, JPEG, GIF). Supports file paths, HTTP/HTTPS URLs, and data URLs.

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
- `objectFit`: `contain` | `cover` | `fill`
- `dither` - Dithering mode
- `gfxMode` - Graphics mode: `sextant` (default), `block`, `pattern`, `luma` (global `MELKER_GFX_MODE` overrides)
- `onLoad`, `onError` - Load callbacks
- `onShader`, `shaderFps`, `shaderRunTime` - Animation (see Shaders)

**Methods:**
- `setSource(url)` - Change image source (clears existing image and triggers reload)
- `clearImage()` - Clear the loaded image
- `loadImage(url)` - Load image directly (async, no auto re-render)

**Dynamic image switching:**
```typescript
// Use setSource() to change images dynamically
const img = $melker.getElementById('my-image');
img.setSource('https://example.com/image.png');  // or file path or data URL
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
- `utils` - `noise2d`, `fbm`, `palette`, `smoothstep`, `mix`, `fract`

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
<slider min="0" max="100" value="50" orientation="vertical" style="height: 8;" />
```

**Props:**
- `min` / `max` - Range (default: 0-100)
- `value` - Current value
- `step` - Discrete increments (e.g., 5 = 0,5,10...)
- `snaps` - Array of snap points `[0, 25, 50, 75, 100]`
- `orientation` - `horizontal` (default) or `vertical`
- `showValue` - Display value label

**Keyboard:** Arrow keys (small step), Page Up/Down (10%), Home/End (min/max)

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

### Colors
**Avoid specifying colors** - Let the theme engine handle colors for best appearance across themes.

Only use colors for canvas drawing or very intentional effects. If needed, use named colors: `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `gray`

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
