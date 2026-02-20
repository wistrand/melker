# .melker File Format

**Melker** - *Run text with meaning*

The `.melker` file format is an HTML-like declarative syntax for building Melker terminal UIs.

**Encoding:** UTF-8 (supports international characters, symbols, and emoji in text content)

**Run with:**
```bash
# Direct execution (melker.ts has executable shebang)
./melker.ts <file>.melker
./melker.ts http://server/path/file.melker  # URL support

# Or via deno run
deno run --allow-all melker.ts <file>.melker
```

The launcher automatically adds `--unstable-bundle` if needed (for Deno's `Deno.bundle()` API).

## Structure

Files can use either a `<melker>` wrapper (for scripts/styles) or a direct root component:

```xml
<melker>
  <title>App Title</title>
  <policy>{"permissions": {...}}</policy>

  <style>
    /* Universal selector */
    * { color: white; }

    /* Type, ID, class selectors */
    button { background-color: blue; }
    #myId { color: red; }
    .myClass { border: thin; }

    /* Descendant combinator (space) - any nested element */
    .card text { font-weight: bold; }

    /* Child combinator (>) - direct children only */
    .nav > button { padding: 1; }
  </style>

  <!-- UI components -->
  <container>...</container>

  <!-- Scripts last -->
  <script type="typescript">
    // TypeScript code - export functions via: export { fn1, fn2 }
  </script>
</melker>
```

**Multiple top-level elements** are automatically wrapped in a flex column container:

```xml
<melker>
  <text>Header</text>
  <container style="flex: 1;">Content</container>
  <text>Footer</text>
</melker>
<!-- Becomes: <container style="display: flex; flex-direction: column; width: 100%; height: 100%;"> ... </container> -->
```

## Special Tags

| Tag        | Description                                            |
|------------|--------------------------------------------------------|
| `<melker>` | Root wrapper (optional)                                |
| `<title>`  | Window/terminal title                                  |
| `<help>`   | Markdown help text (shown in DevTools F12 > Help tab)  |
| `<style>`  | CSS-like stylesheet rules with `@media`, `@container`, `@keyframes` support |
| `<script>` | TypeScript/JavaScript code block                       |
| `<oauth>`  | OAuth2 PKCE configuration                              |
| `<policy>` | Permission policy declaration                          |

## Help Tag

The `<help>` tag provides usage documentation displayed in DevTools (F12 > Help tab).

Content is rendered as markdown:

```xml
<help>
## Usage

```
myapp.melker [options]
```

## Arguments

| Argument | Description |
|----------|-------------|
| `--foo` | Enable foo mode |

## Examples

```bash
myapp.melker --foo bar
```
</help>
```

## Script Lifecycle

Scripts can run at different times during app startup:

| Script Type              | When                  | Use Case                               |
|--------------------------|-----------------------|----------------------------------------|
| `<script>`               | Before render         | Define exports, setup state            |
| `<script async="init">`  | Before render (async) | Async initialization, data fetching    |
| `<script async="ready">` | After first render    | Access rendered elements, start timers |

### Initialization Pattern

**Preferred: Use `async="ready"` for post-render initialization:**

```xml
<script type="typescript">
  export function startClock(canvas: any) {
    setInterval(() => drawClock(canvas), 1000);
  }
</script>

<script type="typescript" async="ready">
  const canvas = $melker.getElementById('clock');
  $app.startClock(canvas);
</script>
```

**Alternative: `$melker.engine.onMount()` for programmatic registration:**

```xml
<script type="typescript">
  $melker.engine.onMount(() => {
    // Runs after first render
  });
</script>
```

Use `onMount()` when you need to conditionally register initialization or register from within functions. Prefer `async="ready"` for simpler, declarative initialization.

**Markdown format:** Use `// @melker script ready` directive in TypeScript blocks:

````markdown
```typescript
// @melker script ready
$app.init();
```
````

**Important:** Primitive exports (`export let count = 0`) are copied by value to `$app`. Use setter functions to modify them from other scripts: `export function setCount(n) { count = n; }`. See `agent_docs/dx-footguns.md` #17.

## Variable Substitution

Melker supports bash-style variable expansion for environment variables and command-line arguments during pre-processing:

### Environment Variables

| Syntax                 | Behavior                                            |
|------------------------|-----------------------------------------------------|
| `$ENV{VAR}`            | Value of VAR, or empty string if unset              |
| `$ENV{VAR:-default}`   | Value of VAR, or "default" if unset/empty           |
| `$ENV{VAR:+alternate}` | "alternate" if VAR is set and non-empty, else empty |
| `$ENV{VAR:?error msg}` | Value of VAR, or throws error if unset/empty        |

### Command-Line Arguments

`argv[0]` is the absolute path to the `.melker` file. User arguments start at `argv[1]`. This indexing is the same in both template substitutions and runtime `<script>` code.

| Syntax                  | Behavior                                        |
|-------------------------|-------------------------------------------------|
| `${argv[N]}`            | Argument at index N, or empty string            |
| `${argv[N]:-default}`   | Argument at index N, or "default" if missing    |
| `${argv[N]:+alternate}` | "alternate" if argument exists, else empty      |
| `${argv[N]:?error msg}` | Argument at index N, or throws error if missing |

In `<script>` blocks, `argv` is available as a `string[]` global with the same indexing:

```typescript
// argv[0] = "/path/to/app.melker"
// argv[1] = first user arg, argv[2] = second, etc.
const filePath = argv[1];
```

### Examples

```xml
<!-- Required API key -->
<text>Using API: $ENV{API_KEY:?API_KEY environment variable is required}</text>

<!-- Conditional debug output -->
<text>$ENV{DEBUG:+Debug mode enabled}</text>

<!-- File argument with default -->
<markdown src="${argv[1]:-README.md}" />

<!-- Required file argument -->
<markdown src="${argv[1]:?Usage: myapp.melker <filename>}" />
```

## Components

| Component                       | Key Props                                                                          | Notes                                     |
|---------------------------------|------------------------------------------------------------------------------------|-------------------------------------------|
| `<container>`                   | style                                                                              | Defaults to flex column (use `overflow: scroll` for scrolling) |
| `<text>`                        | id, style                                                                          | Inner content or `text` prop (HTML entities unescaped) |
| `<input>`                       | id, placeholder, value, format, onKeyPress, onInput                                | Single-line text input (format: 'text'\|'password') |
| `<textarea>`                    | id, placeholder, value, rows, cols, wrap, maxLength                                | Multi-line text input                     |
| `<button>`                      | id, label, onClick                                                                 | `<button>Label</button>` or `label="Label"` |
| `<dialog>`                      | id, title, open, modal, backdrop, draggable, width, height                         | Modal overlay, defaults to flex column    |
| `<checkbox>`                    | id, title, checked, onChange                                                       | Toggle checkbox                           |
| `<radio>`                       | id, title, value, checked, name, onChange                                          | Radio button                              |
| `<list>`                        | style                                                                              | List container                            |
| `<li>`                          | style                                                                              | List item                                 |
| `<tabs>`                        | id, activeTab, onChange                                                            | Tabbed container                          |
| `<tab>`                         | title, disabled                                                                    | Tab panel, defaults to flex column        |
| `<canvas>`                      | width, height, dither, ditherBits, onPaint, onShader, onFilter, shaderFps, shaderRunTime | Pixel graphics (sextant chars)      |
| `<img>`                         | src, alt, width, height, dither, onLoad, onError, onShader, onFilter, shaderFps, shaderRunTime | Image display (extends canvas) |
| `<markdown>`                    | src, text, onLink                                                                  | Markdown text rendering with image support |
| `<combobox>`                    | placeholder, filter, onSelect, maxVisible                                          | Dropdown with text filter                 |
| `<select>`                      | value, onSelect, maxVisible                                                        | Dropdown picker (no filter)               |
| `<autocomplete>`                | placeholder, onSearch, onSelect, debounce, minChars                                | Async search dropdown                     |
| `<command-palette>`             | open, onSelect, width                                                              | Modal command picker                      |
| `<option>`                      | value, disabled, shortcut                                                          | Child of combobox/select/autocomplete/command-palette |
| `<group>`                       | label, system                                                                      | Groups options under a header             |
| `<slider>`                      | min, max, value, step, snaps, showValue, onChange                                  | Range input                               |
| `<file-browser>`                | path, selectionMode, selectType, filter, showHidden, maxVisible, onSelect, onCancel | File/dir picker                          |
| `<data-table>`                  | columns, rows, footer, selectable, sortColumn, sortDirection, onSelect, onActivate | Array-based table                        |
| `<table>`                       | style                                                                              | HTML-like table container                 |
| `<thead>`, `<tbody>`, `<tfoot>` | style                                                                              | Table sections (tbody supports `overflow: scroll`) |
| `<tr>`                          | style                                                                              | Table row                                 |
| `<td>`, `<th>`                  | colspan, rowspan, align, valign                                                    | Table cells                               |
| `<progress>`                    | value, max, min, width, height, showValue, indeterminate                           | Progress bar                              |
| `<connector>`                   | from, to, fromSide, toSide, arrow, label, routing                                  | Draw lines between elements               |
| `<graph>`                       | type, src, text, style                                                             | Mermaid/JSON diagrams (flowchart, sequence, class) |

**HTML Entities in Text:** Text content automatically unescapes HTML entities:
- `&lt;` → `<`, `&gt;` → `>`, `&amp;` → `&`
- `&quot;` → `"`, `&apos;` → `'`
- Numeric: `&#60;` → `<`, `&#x3C;` → `<`

```xml
<text>Use &lt;button&gt; for actions</text>  <!-- Displays: Use <button> for actions -->
```

## System Command Palette

System commands are **automatically injected** into all command palettes. A "System" group is appended containing:

| Command            | Shortcut | Action                       |
|--------------------|----------|------------------------------|
| Exit               | Ctrl+C   | Exit the application         |
| AI Assistant       | F8       | Open AI accessibility dialog |
| Dev Tools          | F12      | Toggle Dev Tools overlay     |
| Performance Dialog | F6       | Toggle Performance stats     |

**Opt-out:** Add `system={false}` to disable system commands:
```xml
<command-palette system={false} onSelect="handleCommand(event.value)">
  <!-- Only custom commands, no system group -->
</command-palette>
```

**Control placement:** Use `<group system="true" />` to position system commands where you want:
```xml
<command-palette onSelect="handleCommand(event.value)">
  <!-- System commands first -->
  <group system="true" />
  <group label="My Commands">
    <option value="cmd1">Custom Command</option>
  </group>
</command-palette>
```

**If no command palette exists** in the document, a default system palette is injected (opened with Ctrl+K).

**Visual formatting:**
- Group headers are displayed in bold
- Options within groups are indented by 1 character
- Shortcuts are right-aligned with 1 character padding
- Scrollbar overwrites the right border when needed

## CSS Selectors

The `<style>` tag and `querySelector`/`querySelectorAll` support CSS-like selectors:

| Selector Type      | Syntax                | Example                           | Matches                               |
|--------------------|-----------------------|-----------------------------------|---------------------------------------|
| Universal          | `*`                   | `* { color: white; }`             | All elements                          |
| Type               | `element`             | `button { padding: 1; }`          | All buttons                           |
| ID                 | `#id`                 | `#header { border: thin; }`       | Element with `id="header"`            |
| Class              | `.class`              | `.active { font-weight: bold; }`  | Elements with `class="active"`        |
| Compound           | `type.class`          | `button.primary { color: blue; }` | Buttons with class "primary"          |
| Descendant (space) | `ancestor descendant` | `.card text { color: cyan; }`     | Any text inside `.card` (any depth)   |
| Child (`>`)        | `parent > child`      | `.nav > button { margin: 1; }`    | Direct button children of `.nav`      |
| Multiple (comma)   | `sel1, sel2`          | `button, .clickable { }`          | Buttons OR elements with `.clickable` |

**Combinator examples:**

```xml
<style>
  /* Descendant: matches text at ANY depth inside .highlight */
  .highlight text { color: cyan; }

  /* Child: matches ONLY direct children */
  .toolbar > button { padding: 0 1; }

  /* Chained: specific path */
  .form > container > input { border: thin; }

  /* Mixed: direct child container, then any nested text */
  .card > container text { font-style: italic; }
</style>
```

See `examples/basics/css-combinators.melker` for a complete demonstration.

## Media Queries

`@media` rules respond to terminal dimensions, enabling responsive layouts:

```xml
<style>
  .sidebar { width: 30; }

  @media (max-width: 80) {
    .sidebar { width: 20; }
  }

  @media (max-width: 60) {
    .sidebar { display: none; }
  }

  @media (min-height: 30) and (max-width: 80) {
    .split { direction: vertical; }
  }
</style>
```

Supported conditions: `min-width`, `max-width`, `min-height`, `max-height`, `orientation` (`portrait`/`landscape`), `min-aspect-ratio`, `max-aspect-ratio` (e.g., `16/9`). Multiple conditions joined with `and`.

Styles are re-applied on terminal resize. Inline styles (`style="..."`) always take precedence over media query rules.

See [architecture-media-queries.md](architecture-media-queries.md) for full details. Example apps:
- [media-queries.melker](../examples/melker/media-queries.melker) — width/height breakpoints, responsive dashboard
- [split-pane-responsive.melker](../examples/components/split-pane-responsive.melker) — split-pane direction via `@media` + `and`
- [media-orientation.melker](../examples/melker/media-orientation.melker) — `orientation: portrait | landscape` layout switching
- [media-aspect-ratio.melker](../examples/melker/media-aspect-ratio.melker) — `min-aspect-ratio` / `max-aspect-ratio` breakpoints

## Container Queries

`@container` rules style children based on their container's resolved size (not the terminal size):

```xml
<style>
  .sidebar {
    container-type: inline-size;
    width: 30%;
    border: thin;
  }

  @container (min-width: 40) {
    .nav-item { flex-direction: row; gap: 2; }
  }

  @container (max-width: 25) {
    .nav-item { flex-direction: column; }
    .nav-label { display: none; }
  }
</style>
```

Set `container-type: inline-size` (width queries) or `container-type: size` (width + height queries) on a container element. Children inside that container can use `@container` rules with `min-width`, `max-width`, `min-height`, `max-height` conditions.

Container queries are evaluated during layout using the container's actual resolved bounds — no second pass needed. They re-evaluate automatically every frame (no resize handler).

See [container-query-architecture.md](container-query-architecture.md) for full details. Example apps:
- [container-queries.melker](../examples/layout/container-queries.melker) — split-pane with sidebar cards adapting via @container
- [container-queries-animated.melker](../examples/layout/container-queries-animated.melker) — animated container with status badges adapting through breakpoints

## CSS Animations

`@keyframes` rules define animations that interpolate style properties over time:

```xml
<style>
  @keyframes pulse {
    0%   { border-color: #333333; }
    50%  { border-color: #3388ff; }
    100% { border-color: #333333; }
  }

  .alert-box {
    animation: pulse 2s ease-in-out infinite;
    border: thin;
  }
</style>
```

Supported timing functions: `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `steps(N)`. Properties: `animation-name`, `animation-duration`, `animation-delay`, `animation-iteration-count`, `animation-direction`, `animation-fill-mode`, or the `animation` shorthand.

Animated properties include colors (RGBA lerp), numbers (integer lerp), percentages (`"30%" -> "70%"`), padding/margin (BoxSpacing lerp), and discrete values (snap at 50%).

See [css-animation-architecture.md](css-animation-architecture.md) for full details. Example app:
- [animation.melker](../examples/basics/animation.melker) — color, size, percentage, padding, position: relative animations

## Styling

CSS-like properties in `style` attribute:

- **Layout:** width, height, min-width, max-width, min-height, max-height, display (flex/block), flex-direction, flex, padding, margin, overflow
- **Borders:** border (none/thin/thick/double/rounded/dashed/dashed-rounded/ascii/ascii-rounded/block), border-top/right/bottom/left, border-color, border-title
- **Colors:** color, background-color — supports hex (`#rgb`, `#rrggbb`, `#rrggbbaa`), `rgb()`, `rgba()`, `hsl()`, `hsla()`, `oklch()`, `oklab()`, and named colors
- **Text:** font-weight (bold/normal), font-style (normal/italic), text-decoration (none/underline), dim, reverse, text-align, text-wrap

**CSS shorthand for padding/margin:** Supports 2, 3, or 4 value shorthand like CSS:
- `padding: 1 2` → top/bottom: 1, left/right: 2
- `padding: 1 2 3` → top: 1, left/right: 2, bottom: 3
- `padding: 1 2 3 4` → top: 1, right: 2, bottom: 3, left: 4

**Important:** `flex-direction` is a style property, not an attribute. Use `style="flex-direction: row"` not `direction="row"`:

```xml
<!-- CORRECT -->
<container style="flex-direction: row; gap: 2">
  <text>Label:</text>
  <select>...</select>
</container>

<!-- WRONG - direction is not a valid attribute -->
<container direction="row">...</container>
```

**Cross-axis stretching:** In column containers, children stretch horizontally by default. Wrap elements in a row container to use their intrinsic width:

```xml
<container style="flex-direction: column">
  <!-- This select will stretch to full width -->
  <select>...</select>

  <!-- Wrap in row to prevent stretching -->
  <container style="flex-direction: row">
    <select>...</select>
  </container>
</container>
```

**Scrollable containers:** Use `overflow: scroll` or `overflow: auto` to enable scrolling:

```xml
<!-- CSS-like style (recommended) -->
<container style="overflow: scroll; flex: 1; width: fill">
  <text style="text-wrap: wrap">Long scrollable content...</text>
</container>

<!-- overflow: auto shows scrollbars only when needed -->
<container style="overflow: auto; flex: 1; width: fill">
  <text style="text-wrap: wrap">Long scrollable content...</text>
</container>
```

- `overflow: scroll` - Always show scrollbars when content overflows
- `overflow: auto` - Show scrollbars only when needed
- `overflow: hidden` - Clip content without scrollbars

## Events & Context

**Events:** onClick, onKeyPress (event.key), onInput (event.value), onFocus, onBlur, onPaint (canvas)

**Auto-render:** Event handlers automatically trigger a re-render after completion. No need to call `$melker.render()` manually.

```xml
<!-- Auto-renders after handler completes -->
<button onClick="counterEl.setValue(String(count + 1))" />

<!-- Call skipRender() to skip auto-render -->
<button onClick="doSomething(); $melker.skipRender()" />

<!-- Async handlers also auto-render when the promise resolves -->
<button onClick="
  statusEl.setValue('Loading...');
  $melker.render();  // explicit render for intermediate state
  await fetchData();
  statusEl.setValue('Done');
  // auto-renders here
" />
```

**Context API:**
- `$melker.url` - Source file URL (e.g. `file:///path/to/app.melker`)
- `$melker.dirname` - Source directory path (e.g. `/path/to`)
- `$melker.exports` / `$app` - User exports namespace (script exports are added here)
- `$melker.getElementById(id)` - Get element by ID
- `$melker.querySelector(selector)` - Get first element matching CSS selector
- `$melker.querySelectorAll(selector)` - Get all elements matching CSS selector

**Supported CSS selectors:**
- Type: `text`, `button`, `container`
- ID: `#myId`
- Class: `.myClass`
- Universal: `*` (matches all elements)
- Compound: `button.primary`, `#header.active`
- Descendant (space): `container text` (any nested text)
- Child (`>`): `container > text` (direct children only)
- Comma (OR): `button, .clickable` (either match)
- `$melker.render()` - Trigger re-render (for intermediate updates in async handlers)
- `$melker.exit()` - Exit application
- `$melker.copyToClipboard(text)` - Copy text to system clipboard (requires `clipboard: true`, auto-policy default)
- `$melker.alert(message)` - Show modal alert dialog
- `$melker.toast.show(message, options?)` - Show non-modal toast (duplicates reset timer and show count)
- `$melker.toast.dismiss(id)` - Dismiss a specific toast
- `$melker.toast.dismissAll()` - Dismiss all toasts
- `$melker.toast.setPosition(position)` - Set toast position ('top' or 'bottom')
- `$melker.setTitle(title)` - Set window/terminal title
- `$melker.config` - Access configuration (schema + custom keys from policy)
- Exported script functions available as `$app.functionName()` (or `$melker.exports.functionName()`)

## State Persistence

Melker apps automatically persist UI state across restarts. The following element types and properties are saved:

| Element       | Property         | Condition                                                       |
|---------------|------------------|-----------------------------------------------------------------|
| `<input>`     | value            | Except password inputs                                          |
| `<textarea>`  | value            | Always                                                          |
| `<checkbox>`  | checked          | Always                                                          |
| `<radio>`     | checked          | Always                                                          |
| `<tabs>`      | activeTab        | Always                                                          |
| `<container>` | scrollY, scrollX | When scrolling enabled (`overflow: scroll` or `overflow: auto`) |

**How it works:**
- State is saved to `~/.melker/state/<app-id>.json` (app-id is a hash of the file path)
- State is saved automatically after each render (debounced, 500ms delay)
- State is saved immediately on exit
- When the app starts, saved state is restored during element creation

**Opt-out:** Add `persist="false"` to any element to exclude it from persistence:
```xml
<input id="tempField" persist="false" placeholder="Not saved" />
```

**Password inputs:** Use `format="password"` to mask characters with `*`. Password inputs are **automatically excluded** from persistence for security - no need to add `persist="false"`.

**Element ID requirement:** Only elements with an `id` attribute are persisted. Anonymous elements are skipped.

**Element Bounds:**
All elements have `getBounds()` method that returns `{ x, y, width, height }` after layout:
```typescript
const canvas = $melker.getElementById('myCanvas');
const bounds = canvas.getBounds();
if (bounds) {
  canvas.setSize(bounds.width, bounds.height);
}
```

## Canvas Component

Canvas uses Unicode sextant characters (2x3 pixel blocks per terminal character).

**Props:**
- `width`, `height` - Dimensions in terminal columns/rows
- `dither` - Dithering mode: `'auto'` | `'sierra-stable'` | `'floyd-steinberg'` | `'ordered'` | `'none'`
- `ditherBits` - Color depth (1-8, default: 1 for B&W)
- `onPaint` - Called before render with `{ canvas, bounds }`
- `src` - Load image from file path, HTTP/HTTPS URL, or data URL (PNG, JPEG, GIF, WebP supported)

**Supported image formats:**
- PNG (including alpha, 16-bit)
- JPEG
- GIF (animated playback supported)
- WebP (via WASM decoder)

**Dither modes:**
- `'auto'` - Uses sierra-stable for bw/color themes, no dither for fullcolor
- `'none'` - No dithering (true color)

**Aspect-ratio corrected drawing:**
```typescript
// Work in visual coordinates (equal units in both dimensions)
const visSize = canvas.getVisualSize();
const visCenterX = visSize.width / 2;
const visCenterY = visSize.height / 2;

// Convert to pixel for drawCircleCorrected
const [pxCenterX, pxCenterY] = canvas.visualToPixel(visCenterX, visCenterY);
canvas.drawCircleCorrected(pxCenterX, pxCenterY, radius);

// Lines use visual coordinates directly
canvas.drawLineCorrected(x1, y1, x2, y2);
```

## Markdown Component

Renders markdown content with support for images, links, and code blocks.

**Props:**
- `src` - Load markdown from file path (relative to cwd or absolute)
- `text` - Inline markdown content
- `onLink` - Handler for link clicks `{ url: string }`

**Path Resolution:**
- Command-line arguments (e.g., `argv[1]`) resolve relative to cwd first
- Images inside markdown resolve relative to the markdown file's location
- Links in markdown can be `.md` or `.melker` files (navigate) or `http://` URLs (open browser)

**Example:**
```xml
<markdown src="${argv[1]:-README.md}" onLink="$app.handleLink(event)" />
```

## Examples

**Basics** (`examples/basics/`):
- `hello.melker` - Simple hello world
- `counter.melker` - Basic counter with buttons
- `form-demo.melker` - Input fields, checkbox, radio
- `dialog-demo.melker` - Dialog variants
- `tabs-demo.melker` - Tabbed interface
- `css-combinators.melker` - CSS selector combinators (descendant, child)
- `animation.melker` - CSS @keyframes animations

**Components** (`examples/components/`):
- `input.melker` - Input fields
- `textarea.melker` - Multi-line text input
- `combobox.melker` - Editable dropdown with filtering
- `select.melker` - Dropdown selection
- `autocomplete.melker` - Text input with suggestions
- `command-palette.melker` - Keyboard-driven command picker
- `table.melker` - Basic table
- `data-table.melker` - Data-driven table
- `data-bars.melker` - Bar charts and sparklines
- `slider.melker` - Numeric slider
- `progress.melker` - Progress bar
- `file-browser.melker` - File system browser
- `segment-display.melker` - 7-segment LED display

**Showcase** (`examples/showcase/`):
- `htop.melker` - System monitor
- `map.melker` - Tile-based map viewer with multiple providers
- `breakout.melker` - Breakout game
- `markdown-viewer.melker` - Markdown rendering with image support
- `color-selector.melker` - HSL color picker with canvas

**Layout** (`examples/layout/`):
- `flex-demo.melker` - Flexbox layout examples
- `flexbox-visualizer.melker` - Interactive flexbox demo
- `borders.melker` - Border styles
- `container-queries.melker` - Container query responsive layouts
- `container-queries-animated.melker` - Animated container queries

**Canvas** (`examples/canvas/`):
- `analog-clock.melker` - Canvas-based analog clock
- `basics.melker` - Canvas graphics basics
- `gfx-modes.melker` - GFX modes and dithering
- `shaders/plasma-shader.melker` - Plasma shader effect
- `shaders/metaballs.melker` - Metaballs animation
- `images/image-demo.melker` - Image component

**Advanced** (`examples/melker/`):
- `ai-tools-demo.melker` - Custom AI tool registration
- `persistence-demo.melker` - State persistence

## Running

```bash
# Direct execution (melker.ts has executable shebang)
./melker.ts examples/basics/counter.melker

# Or via deno run
deno run --allow-all melker.ts examples/basics/counter.melker

# From URL
./melker.ts http://localhost:1990/melker/counter.melker

# With lint validation
./melker.ts --lint examples/basics/counter.melker

# Watch mode (auto-reload on file changes, local files only)
./melker.ts --watch examples/basics/counter.melker

# Debug mode (shows bundler info, retains temp files at /tmp/melker-*.{ts,js})
./melker.ts --debug examples/basics/counter.melker

# Enable bundle caching (disabled by default)
./melker.ts --cache examples/basics/counter.melker

# Show app policy and exit
./melker.ts --show-policy examples/basics/counter.melker

# Trust mode (for CI/scripts - bypasses approval prompt that would hang)
./melker.ts --trust examples/basics/counter.melker

# With logging
MELKER_LOG_FILE=/tmp/debug.log MELKER_LOG_LEVEL=debug ./melker.ts app.melker

# With theme (auto-detected by default, or specify manually)
MELKER_THEME=fullcolor-dark ./melker.ts app.melker
MELKER_THEME=auto-dark ./melker.ts app.melker

# Start LSP server (for editor integration)
./melker.ts --lsp

# Single-frame output (renders once and exits)
./melker.ts --stdout examples/basics/counter.melker

# Force interactive mode even when piped
./melker.ts --interactive examples/basics/counter.melker | cat

# Force ANSI colors when piping (e.g., to less -R)
./melker.ts --color=always examples/basics/counter.melker | less -R

# Deno flags (forwarded to app subprocess)
./melker.ts --reload http://example.com/app.melker    # Reload remote modules
./melker.ts --no-lock app.melker                       # Disable lockfile
./melker.ts --no-check app.melker                      # Skip type checking
./melker.ts --quiet app.melker                         # Suppress diagnostic output
./melker.ts --cached-only app.melker                   # Offline mode
```

**Piping and Redirection:**

When stdout is not a TTY (piped or redirected), Melker automatically:
1. Renders a single frame after a timeout (default 200ms)
2. Strips ANSI escape codes for clean text output
3. Exits immediately

```bash
# These work naturally - auto-detects non-TTY
./melker.ts app.melker > snapshot.txt
./melker.ts app.melker | head -20
./melker.ts app.melker | grep "Error"

# Force interactive TUI mode even when piped
./melker.ts --interactive app.melker | cat

# Force ANSI colors when piping to tools that support them
./melker.ts --color=always app.melker | less -R
```

**Color modes:**
- `--color=auto` (default): Strip ANSI when piped, keep when TTY
- `--color=always`: Force ANSI colors even when piped
- `--color=never`: Strip ANSI colors even on TTY

**Running melker.ts from a remote URL:** `--reload` before the URL is auto-detected and forwarded to the app subprocess — no need to pass it twice:

```bash
deno run --allow-all --reload https://melker.sh/melker.ts app.melker
```

**Note:** `https://melker.sh/melker.ts` serves the latest commit from `main` on GitHub. For reproducible builds, pin to a specific version:

```bash
# Pin to CalVer release
deno run --allow-all https://melker.sh/melker-v2026.01.1.ts app.melker

# Pin to specific commit
deno run --allow-all https://melker.sh/melker-abc123f.ts app.melker
```

## Markdown Format (.md) - Optional

Melker apps can **optionally** be written in markdown files using ASCII box diagrams. This is a **documentation-friendly layer** on top of `.melker` files, not a replacement.

| Use Case             | Recommended Format                 |
|----------------------|------------------------------------|
| Production apps      | `.melker` - precise, easy to edit  |
| Examples & tutorials | `.md` - self-documenting, visual   |
| Quick prototypes     | `.md` - sketch layouts visually    |
| Generated/tooling    | `.melker` - machine-friendly       |

The markdown format compiles to `.melker` and provides:
- Visual ASCII layout diagrams that match the rendered output
- Documentation alongside code (literate programming style)
- Editor syntax highlighting for TypeScript/CSS/JSON blocks

### Running Markdown Files

```bash
# Run directly
./melker.ts examples/melker-md/counter.md

# Convert to .melker format (prints to stdout)
./melker.ts --convert examples/melker-md/counter.md
```

### Layout Blocks

Use `melker-block` code blocks. The **first block is the root**, subsequent blocks are **component definitions**.

````markdown
```melker-block
+--root My App Title--+
| : c f               |
| +--header---------+ |
| +--content--------+ |
+---------------------+
```
````

### Box Name Syntax

`+--id Display Name--+` where:
- **First word** = element ID (for CSS `#id` and component references)
- **Rest** = display name (root's display name becomes document title)

### Shorthand Type Syntax

Use special delimiters to define element types without `type:` property lines:

| Syntax                        | Element    | Example                                                        |
|-------------------------------|------------|----------------------------------------------------------------|
| `+--[Title]--+`               | button     | `+--[Click Me]--+` → `<button label="Click Me" />`             |
| `+--"content"--+`             | text       | `+--"Hello!"--+` → `<text>Hello!</text>`                       |
| `+--{id}--+`                  | input      | `+--{username}--+` → `<input id="username" />`                 |
| `+--<type> content--+`        | explicit   | `+--<checkbox> Remember--+` → `<checkbox title="Remember" />`  |
| `+--<type(param)> content--+` | with param | `+--<radio(plan)> Free--+` → `<radio title="Free" name="plan" />` |

The explicit `<type>` syntax maps content to appropriate props:
- `<checkbox>`, `<radio>` → `title` prop
- `<button>` → `label` prop
- `<radio(name)>` → `title` prop + `name` prop for radio group
- `<text>`, `<markdown>` → `text` prop
- `<input>`, `<textarea>` → `placeholder` prop

IDs are auto-generated from content (lowercase, hyphens for spaces).

### Component References

Any box ID that matches a component definition is automatically expanded. Works at any nesting level:

````markdown
```melker-block
+--root App---------------------------------+
| : c f                                     |
| +--header-------------------------------+ |
| +--main---------------------------------+ |
| | +--sidebar--+ +--content------------+ | |
| +-------------------------------------------+ |
+-----------------------------------------------+
```

```melker-block
+--header------------------+
| type: text               |
| text: Header             |
+--------------------------+
```

```melker-block
+--sidebar-----------------+
| +--nav-----------------+ |
+--------------------------+
```
````

Cycle detection prevents infinite loops (A -> B -> A).

### Layout Hints

Compact hints on lines starting with `: `:

| Hint            | Meaning                                           |
|-----------------|---------------------------------------------------|
| `r` / `c`       | row / column direction (optional - auto-detected) |
| `0`-`9`         | gap value                                         |
| `<` `=` `>` `~` | justify: start / center / end / space-between     |
| `^` `-` `v` `+` | align: start / center / end / stretch             |
| `*N`            | flex: N                                           |
| `f`             | fill (width + height 100%)                        |

**Auto-detection:** Flex direction is inferred from child positions - children stacked vertically → column, side by side → row.

### Tab Bar Syntax

Use `│ Tab1 │ Tab2 │` lines to create tabs. Mark the active tab with `*`:

````markdown
```melker-block
+--settings Settings-----------------------+
| │ General* │ Advanced │ About │          |
| +--general-content---------------------+ |
| +--advanced-content--------------------+ |
| +--about-content-----------------------+ |
+------------------------------------------+
```
````

Generates `<tabs>` with `<tab>` children. Child boxes map to tabs in order.

### Code Blocks

Use directive comments for editor compatibility:

````markdown
```typescript
// @melker script
let count = 0;
export const inc = () => count++;  // Accessible as $app.inc()
```

```typescript
// @melker handler #btn.onClick
count++;
$melker.render();
```

```css
/* @melker style */
#count { font-weight: bold; }
```

```json
{
  "@target": "#btn",
  "style": "background-color: blue"
}
```
````

### External Scripts

Use a `## Scripts` section with markdown links to reference external TypeScript files:

````markdown
## Scripts
- [handlers](./handlers.ts)
- [utils](./utils.ts)
````

Generates `<script src="./handlers.ts" />` for each link.

### OAuth Configuration

Use a `json oauth` fenced block for OAuth2 PKCE configuration:

````markdown
```json oauth
{
  "wellknown": "$ENV{OAUTH_WELLKNOWN}",
  "clientId": "$ENV{OAUTH_CLIENT_ID}",
  "audience": "$ENV{OAUTH_AUDIENCE}",
  "autoLogin": true,
  "onLogin": "$app.onLoginCallback(event)",
  "onLogout": "$app.onLogoutCallback(event)",
  "onFail": "$app.onFailCallback(event)"
}
```
````

**OAuth Event Structure:** All OAuth callbacks receive a unified `OAuthEvent`:
```typescript
interface OAuthEvent {
  type: 'oauth';
  action: 'login' | 'logout' | 'fail';
  error?: Error;  // Only present for 'fail' events
}
```

See `examples/melker-md/oauth_demo.md` for a complete example.

## Policy (Permission Sandboxing)

Apps declare required permissions via a `<policy>` tag. The app runs in a sandboxed subprocess with only those permissions.

### Syntax

**Inline policy:**

```xml
<policy>
{
  "name": "My App",
  "comment": "Why these permissions are needed",
  "permissions": {
    "read": ["."],
    "net": ["api.example.com"],
    "run": ["ffmpeg"]
  }
}
</policy>
```

**External policy file:**

```xml
<policy src="app.policy.json"></policy>
```

### Policy Fields

| Field          | Type               | Description                                |
|----------------|--------------------|--------------------------------------------|
| `name`         | string             | App name (shown in approval prompt)        |
| `version`      | string             | App version                                |
| `description`  | string             | Short description                          |
| `comment`      | string \| string[] | Detailed comment shown in approval prompt  |
| `permissions`  | object             | Permission declarations                    |
| `config`       | object             | App-specific configuration values          |
| `configSchema` | object             | Schema for env var overrides               |

### Permission Types

**Array permissions** (list of allowed values, use `["*"]` for wildcard):

| Permission | Example                             | Deno Flag       |
|------------|-------------------------------------|-----------------|
| `read`     | `["cwd"]` or `["."]` or `["*"]`     | `--allow-read`  |
| `write`    | `["cwd"]` or `["/data"]` or `["*"]` | `--allow-write` |
| `net`      | `["api.example.com", "samesite"]`   | `--allow-net`   |
| `run`      | `["ffmpeg", "ffprobe"]`             | `--allow-run`   |
| `env`      | `["MY_VAR"]` or `["*"]`             | `--allow-env`   |
| `ffi`      | `["libfoo.so"]`                     | `--allow-ffi`   |
| `sys`      | `["hostname", "osRelease"]`         | `--allow-sys`   |

**Boolean shortcuts** (expand to multiple permissions):

| Shortcut    | Description                                                     |
|-------------|-----------------------------------------------------------------|
| `ai`        | AI/media: ffmpeg, ffprobe, swift, pactl, ffplay + openrouter.ai |
| `clipboard` | Clipboard: pbcopy, xclip, xsel, wl-copy, clip.exe               |
| `keyring`   | Credentials: security, secret-tool, powershell                  |
| `browser`   | Browser opening: open, xdg-open, cmd                            |
| `shader`    | Allow per-pixel shaders on canvas/img elements                  |

**Special values:**
- `"cwd"` in `read`/`write` - expands to current working directory
- `"samesite"` in `net` - expands to the host of the source URL (for remote apps)
- `$ENV{VAR}` or `$ENV{VAR:-default}` - environment variable substitution

**Auto-policy (no `<policy>` tag):** Local files without a policy get `read: ["cwd"], clipboard: true` by default, enabling file access in working directory and text selection copy (Alt+C).

### CLI Options

```bash
./melker.ts --show-policy app.melker      # Show policy and exit
./melker.ts --trust app.melker            # Bypass approval prompt (CI/scripts)
./melker.ts --clear-approvals             # Clear all cached approvals
./melker.ts --revoke-approval app.melker  # Revoke specific approval
```

### CLI Permission Overrides

Modify permissions at runtime without editing the policy:

```bash
./melker.ts --allow-net=api.example.com app.melker  # Add permission
./melker.ts --deny-run=rm app.melker                # Remove permission
./melker.ts --allow-ai --deny-net=openrouter.ai app.melker  # Combine
```

See [policy-architecture.md](policy-architecture.md) for complete documentation on:
- All `--allow-*` and `--deny-*` flags
- Override precedence rules
- Implicit paths (auto-granted permissions)
- Approval system details
- Deno flag generation

### App-Specific Configuration

Apps can define custom config in policy, accessible via `$melker.config`:

```xml
<policy>
{
  "permissions": { "shader": true },
  "config": {
    "plasma": { "scale": 1.5 }
  },
  "configSchema": {
    "plasma.scale": { "type": "number", "env": "PLASMA_SCALE" }
  }
}
</policy>
```

Env vars in `configSchema` are auto-added to subprocess permissions. See [config-architecture.md](config-architecture.md) for details.

### OAuth Auto-Permissions

When an `<oauth>` tag is present, the policy automatically includes:
- `localhost` in net permissions (for callback server)
- `browser: true` (for opening authorization URL)
- All hosts discovered from the wellknown endpoint

See `examples/melker-md/` for complete examples and `examples/melker-md/README.md` for full syntax reference.

## See Also

- [getting-started.md](getting-started.md) — Quick start guide
- [script_usage.md](script_usage.md) — Script context and $melker API
- [policy-architecture.md](policy-architecture.md) — Permission system details
- [config-architecture.md](config-architecture.md) — Configuration system
