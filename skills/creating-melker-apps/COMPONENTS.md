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
- `display`: `flex` | `block`
- `flex-direction`: `row` | `column`
- `flex`: grow factor (e.g., `1`)
- `justify-content`: `flex-start` | `center` | `flex-end` | `space-between` | `space-around`
- `align-items`: `flex-start` | `center` | `flex-end` | `stretch`
- `gap`: spacing between children
- `width`, `height`: number, percentage (`100%`), or `fill`
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

Clickable button. **Uses `title` not `label`**.

```xml
<button
  id="submit"
  title="Submit"
  onClick="$app.handleSubmit()"
/>
```

**Props:**
- `id` - Element ID
- `title` - Button text (NOT `label`)
- `onClick` - Click handler
- `style` - Styling

**Note:** Buttons render with `[ ]` brackets by default. Don't add `border` to buttons or you'll get double brackets like `[ [ Button ] ]`. Let the theme engine handle button styling.

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
    <button title="Close" onClick="$app.closeDialog()" />
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
<tabs id="settings" activeTab="0" onTabChange="$app.onTabChange(event.index)">
  <tab title="General">
    <text>General settings content</text>
  </tab>
  <tab title="Advanced">
    <text>Advanced settings content</text>
  </tab>
  <tab title="About" disabled="true">
    <text>About content</text>
  </tab>
</tabs>
```

**tabs Props:**
- `id` - Element ID
- `activeTab` - Active tab index (0-based)
- `onTabChange` - Called on tab switch (`event.index`)

**tab Props:**
- `title` - Tab label
- `disabled` - Disable tab

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

### select

Simple dropdown picker (no filter).

```xml
<select id="size" value="medium" onSelect="$app.onSelect(event.value)">
  <option value="small">Small</option>
  <option value="medium">Medium</option>
  <option value="large">Large</option>
</select>
```

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
- `onPaint` - Draw callback (`event.canvas`)

**Canvas API:**
```typescript
canvas.clear();
canvas.getBufferSize();  // { width, height } in pixels
canvas.getVisualSize();  // Aspect-corrected size
canvas.drawCircleCorrected(x, y, radius);
canvas.drawSquareCorrected(x, y, size);
canvas.drawLine(x1, y1, x2, y2);
canvas.fillRect(x, y, width, height);
canvas.setPixel(x, y);
canvas.markDirty();
```

### img

Image display (PNG, JPEG, GIF).

```xml
<img
  src="./image.png"
  width="40"
  height="20"
  objectFit="contain"
  dither="auto"
  onLoad="$app.onImageLoad()"
  onError="$app.onImageError(event.error)"
/>
```

**Props:**
- `src` - Image path
- `width`, `height` - Dimensions
- `objectFit`: `contain` | `cover` | `fill`
- `dither` - Dithering mode
- `onLoad`, `onError` - Load callbacks

### markdown

Render markdown content.

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

### video

Video playback (requires ffmpeg).

```xml
<video
  src="./video.mp4"
  width="80"
  height="24"
  autoplay="true"
  controls="true"
/>
```

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
- Percentages: `100%`, `50%`
- Fill: `fill` (expand to available space)
