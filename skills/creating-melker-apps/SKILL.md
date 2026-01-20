---
name: creating-melker-apps
description: Creates Terminal UI applications using Melker's .melker file format. Use when the user asks to build terminal apps, TUI interfaces, create .melker files, or mentions Melker components like containers, buttons, dialogs, tabs, canvas, or forms.
license: MIT
compatibility: Requires Deno 2.5+, ANSI-compatible terminal
metadata:
  author: wistrand
  website: https://melker.sh
---

# Creating Melker Apps

Melker is a Deno library for building rich Terminal UI interfaces using an HTML-inspired document model. Apps are written in `.melker` files (UTF-8 encoded) with XML-like syntax.

## Installation

```bash
# Clone the repository
git clone https://github.com/wistrand/melker.git
cd melker

# Run directly (no build step needed)
./melker.ts app.melker

# Optional: install globally via symlink
ln -s $(pwd)/melker.ts ~/.local/bin/melker
# Then run from anywhere: melker app.melker
```

**From URL (no install):**
```bash
deno run --allow-all https://melker.sh/melker.ts app.melker
```

## Requirements

| Requirement | Details |
|-------------|---------|
| **Runtime** | Deno 2.5+ (required) |
| **Platform** | Linux, macOS, Windows (WSL recommended) |
| **Terminal** | Any ANSI-compatible terminal (iTerm2, Alacritty, Kitty, Windows Terminal, etc.) |

**Terminal Feature Support:**

| Feature | Requirements |
|---------|--------------|
| Basic TUI | Any terminal with ANSI support |
| Mouse support | Terminal with mouse reporting (most modern terminals) |
| True color | Terminal with 24-bit color support |
| Images/video | Terminal with sextant/block character support |

**Known Limitations:**
- Windows CMD.exe has limited ANSI support; use Windows Terminal or WSL
- Some SSH clients may not pass through mouse events
- Very old terminals (VT100) lack color support

## Quick Start

```xml
<melker>
  <title>My App</title>
  <container style="border: thin; padding: 1;">
    <text>Hello, World!</text>
    <button label="Click Me" onClick="alert('Clicked!')" />
  </container>
</melker>
```

**Run:** `./melker.ts app.melker`

## Critical Rules

1. **Button label** - Use `<button>Label</button>` or `label="Label"` (not `title`)
2. **Don't add border to buttons** - Buttons already have `[ ]` brackets; adding border creates `[ [ Button ] ]`
3. **Button padding** - Vertical padding ignored for `[ ]` buttons (they stay 1 line); horizontal padding works
4. **Input type is `'input'`** - Not `'text-input'`
5. **`console.log()` redirects to logger (in app code)** - Automatically redirected to `$melker.logger.info()` (disable with `--no-console-override`)
6. **Auto-render** - Event handlers auto-render; call `$melker.skipRender()` to skip
7. **Use getValue/setValue for values** - For input/textarea/select content. Use `.props.*` for other props like `open`, `checked`
8. **Avoid emojis** - They break terminal layout
9. **Export functions for handlers** - Functions must be `export function` to use in `onClick="$app.fn()"`
10. **Scrollable is a prop** - Use `scrollable="true"` not `style="overflow: scroll"`
11. **Dialog show/hide** - Use `dialog.show()`, `dialog.hide()`, or `dialog.setVisible(bool)`
12. **Avoid specifying colors** - Let the theme engine handle colors
13. **flex-direction is a style** - Use `style="flex-direction: row"` not `direction="row"`
14. **Prevent cross-axis stretching** - In column containers, wrap select/combobox/autocomplete in a row container to prevent full-width stretching
15. **Primitive exports are copied by value** - `$app.varName = value` modifies a copy, not the original. Use setter functions to modify variables from other scripts

## File Structure

```xml
<melker>
  <title>App Title</title>
  <help>
## Usage
`myapp.melker [args]`
  </help>
  <policy>{"permissions": {...}}</policy>
  <style>
    #myId { font-weight: bold; }
    .myClass { padding: 1; }
  </style>

  <!-- UI components -->
  <container>...</container>

  <!-- Scripts last -->
  <script type="typescript">
    let count = 0;
    export function increment() { count++; }
  </script>
</melker>
```

- `<help>` - Markdown help text shown in DevTools (F12 > Help tab)

**Multiple top-level elements:** You can have multiple UI elements at the top level - they are automatically wrapped in a flex column container:

```xml
<melker>
  <text>Header</text>
  <container style="flex: 1;">Content</container>
  <text>Footer</text>
</melker>
<!-- Internally becomes: <container style="display: flex; flex-direction: column; width: 100%; height: 100%;"> ... </container> -->
```

## Context API

| API | Description |
|-----|-------------|
| `$melker.getElementById(id)` | Get element by ID |
| `$melker.querySelector(selector)` | Get first element matching CSS selector (type, #id, .class, combinations) |
| `$melker.querySelectorAll(selector)` | Get all elements matching CSS selector |
| `$melker.render()` | Trigger re-render (for intermediate states) |
| `$melker.skipRender()` | Skip auto-render after handler completes |
| `$melker.exit()` | Exit application |
| `$melker.alert(message)` | Show modal alert |
| `$melker.copyToClipboard(text)` | Copy to clipboard |
| `$melker.openBrowser(url)` | Open URL in system browser (requires `browser: true` in policy) |
| `$melker.cacheDir` | App-specific cache directory path (always exists) |
| `$melker.logger.debug/info/warn/error()` | Log to file (F12 shows location) |
| `$melker.config.getString/getNumber/getBoolean(key, default)` | Read config values |
| `$melker.url` | Source file URL |
| `$melker.dirname` | Source directory path |
| `$app.functionName()` | Call exported script functions |

## Core Components

| Component | Key Props | Notes |
|-----------|-----------|-------|
| `<container>` | style, scrollable | Flexbox layout |
| `<text>` | id, style | Text content |
| `<input>` | placeholder, value, format, onInput | Single-line (format: 'text'\|'password') |
| `<textarea>` | placeholder, rows, cols, wrap | Multi-line |
| `<button>` | **label**, onClick | `<button>Label</button>` or `label="Label"` |
| `<dialog>` | title, open, modal, backdrop, draggable | Modal overlay |
| `<checkbox>` | title, checked, onChange | Toggle |
| `<radio>` | title, value, name, onChange | Radio button |
| `<tabs>` / `<tab>` | activeTab, onChange / title | Tabbed panels |
| `<list>` / `<li>` | style | Lists |
| `<canvas>` | width, height, onPaint, onShader, onFilter | Pixel graphics |
| `<img>` | src, width, height, objectFit, dither, onFilter | Images |
| `<video>` | src, width, height, autoplay, loop, audio | Video (requires ffmpeg) |
| `<combobox>` | placeholder, filter, onSelect | Filterable dropdown |
| `<select>` | value, onSelect | Dropdown picker |
| `<autocomplete>` | placeholder, onSearch, onSelect, debounce | Async search dropdown |
| `<command-palette>` | open, onSelect, width | Modal command picker |
| `<markdown>` | src, text, onLink, enableGfm | Markdown rendering with image support |
| `<slider>` | min, max, value, step, onChange | Range input |
| `<progress>` | value, max, showValue, indeterminate | Progress bar |
| `<data-table>` | columns, rows, selectable, onSelect | Array-based table |
| `<table>` | border, columnBorders, resizable | HTML-like table |
| `<file-browser>` | path, selectType, onSelect, onCancel | File/dir picker |

For complete component reference, see [COMPONENTS.md](references/COMPONENTS.md). For tutorials, see [getting-started.md](https://github.com/wistrand/melker/blob/main/agent_docs/getting-started.md) and [melker.sh/tutorial.html](https://melker.sh/tutorial.html).

## Styling

```xml
<container style="
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  border: thin;
  padding: 1;
  gap: 1;
">
```

**Layout:** `display`, `flex-direction`, `flex`, `width`, `height`, `padding`, `margin`, `gap`
**Borders:** `border` (none|thin|thick|double|rounded|dashed|dashed-rounded|ascii|ascii-rounded|block), `borderTitle`
**Text:** `font-weight`, `text-align`, `text-wrap`
**Size values:**
- Numbers: `40` (columns/rows)
- Percentages: `50%`, `100%` (in `style.width`/`style.height`)
- `fill`: Expands to *remaining* available space (differs from 100%)

**Note:** `display: flex` is auto-inferred when flex container properties are present (`flex-direction`, `justify-content`, `align-items`, `gap`, etc.), so it can be omitted.

**Avoid specifying colors** - Let the theme engine handle colors for best appearance across themes. Only use `color`/`background-color` for canvas drawing or very intentional effects.

## Event Handling

Events auto-render after completion:

```xml
<!-- Simple handler -->
<button label="Click" onClick="alert('Hi!')" />

<!-- Access elements -->
<button onClick="
  const el = $melker.getElementById('counter');
  el.setValue(String(parseInt(el.getValue()) + 1));
" />

<!-- Call exported functions -->
<button onClick="$app.increment()" />

<!-- Async with intermediate state -->
<button onClick="
  statusEl.setValue('Loading...');
  $melker.render();
  await fetchData();
  statusEl.setValue('Done');
" />

<!-- Skip auto-render -->
<button onClick="
  doSomethingWithoutUIChange();
  $melker.skipRender();
" />
```

**Event objects:**
- `onInput`: `event.value` - current input value
- `onSelect`: `event.value`, `event.label` - selected option
- `onKeyPress`: `event.key` - key pressed

## Scripts

```xml
<script type="typescript">
  // State variables
  let count = 0;

  // Export functions for use in handlers
  export function increment() {
    count++;
    const el = $melker.getElementById('counter');
    if (el) el.setValue(String(count));
    $melker.render();
  }

  // Access via $app.increment() in event handlers
</script>
```

### Script Lifecycle

| Type | Attribute | When | Use Case |
|------|-----------|------|----------|
| Sync | (default) | Before render | State setup, function definitions |
| Init | `async="init"` | Before first render | Async data loading |
| Ready | `async="ready"` | After first render | DOM initialization, timers |

**Preferred pattern for post-render initialization:**

```xml
<script type="typescript">
  export function init() {
    const canvas = $melker.getElementById('myCanvas');
    // Start timers, initialize canvas, etc.
  }
</script>

<script type="typescript" async="ready">
  $app.init();
</script>
```

**Alternative:** Use `$melker.engine.onMount()` for programmatic callback registration (required for `.md` files).

For TypeScript type definitions (`$melker`, `Element`, event objects), see [TYPES.md](references/TYPES.md).

## Common Patterns

### Counter

```xml
<container style="display: flex; flex-direction: row; gap: 1;">
  <button label="-" onClick="
    const el = $melker.getElementById('count');
    el.setValue(String(parseInt(el.getValue()) - 1));
  " />
  <text id="count">0</text>
  <button label="+" onClick="
    const el = $melker.getElementById('count');
    el.setValue(String(parseInt(el.getValue()) + 1));
  " />
</container>
```

### Form with Validation

```xml
<container style="display: flex; flex-direction: column; gap: 1;">
  <text>Name:</text>
  <input id="name" placeholder="Enter name" />
  <text>Email:</text>
  <input id="email" placeholder="Enter email" />
  <button label="Submit" onClick="
    const name = $melker.getElementById('name')?.getValue() ?? '';
    const email = $melker.getElementById('email')?.getValue() ?? '';
    if (!name || !email) {
      alert('Please fill all fields');
      return;
    }
    alert('Submitted: ' + name);
  " />
</container>
```

### Dialog

```xml
<script>
  export function openDialog() {
    $melker.getElementById('myDialog').show();
  }
  export function closeDialog() {
    $melker.getElementById('myDialog').hide();
  }
</script>

<button label="Open" onClick="$app.openDialog()" />
<dialog id="myDialog" title="My Dialog" modal="true" backdrop="true">
  <container style="padding: 1;">
    <text>Dialog content here</text>
    <button label="Close" onClick="$app.closeDialog()" />
  </container>
</dialog>
```

### Tabs

```xml
<tabs id="myTabs">
  <tab id="tab1" title="Tab 1">
    <text>Content for tab 1</text>
  </tab>
  <tab id="tab2" title="Tab 2">
    <text>Content for tab 2</text>
  </tab>
</tabs>

<!-- To start on a specific tab, use activeTab with tab id -->
<tabs id="myTabs" activeTab="tab2">...</tabs>
```

### Combobox with Groups

```xml
<combobox placeholder="Select..." filter="fuzzy" onChange="$app.onSelect(event.value, event.label)">
  <group label="Group A">
    <option value="a1">Option A1</option>
    <option value="a2">Option A2</option>
  </group>
  <group label="Group B">
    <option value="b1">Option B1</option>
  </group>
</combobox>
```

For more examples, see [EXAMPLES.md](references/EXAMPLES.md).

## Permissions (Policy)

**Recommendation:** Always add a `<policy>` section for apps that need file, network, or system access. This enables permission sandboxing and is **required for remote/URL-hosted apps**.

```xml
<melker>
  <policy>
  {
    "name": "My App",
    "description": "What the app does",
    "comment": "Optional detailed explanation shown in approval prompt",
    "permissions": {
      "read": ["."],
      "write": ["."],
      "net": ["api.example.com"]
    }
  }
  </policy>
  <!-- UI -->
</melker>
```

**Policy fields:**
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | App name (shown in approval prompt) |
| `description` | string | Short description |
| `comment` | string \| string[] | Detailed comment shown in approval prompt |
| `permissions` | object | Permission declarations (see below) |

**Permission types:**
| Permission | Example | Description |
|------------|---------|-------------|
| `read` | `["."]` or `["*"]` | File system read access |
| `write` | `["/data"]` | File system write access |
| `net` | `["api.example.com"]` | Network access to hosts |
| `run` | `["ffmpeg"]` | Execute system commands |
| `env` | `["API_KEY"]` | Environment variable access |
| `ffi` | `["libfoo.so"]` | FFI library access |
| `sys` | `["hostname", "osRelease"]` | System information access |

**Shortcuts** (set to `true` to enable):
| Shortcut | Enables |
|----------|---------|
| `ai` | AI/media: ffmpeg, ffprobe, openrouter.ai |
| `clipboard` | Clipboard: pbcopy, xclip, wl-copy |
| `browser` | Browser opening: open, xdg-open |
| `keyring` | Credential storage: security, secret-tool |

**Example with shortcuts:**
```xml
<policy>
{
  "name": "My App",
  "permissions": {
    "read": ["."],
    "clipboard": true,
    "browser": true
  }
}
</policy>
```

**When to omit policy:** Simple local apps with no file/network needs can skip the policy tag. They'll use an auto-generated permissive policy.

## State Persistence

Elements with `id` are auto-persisted. Opt-out with `persist="false"`:

```xml
<input id="saved" />         <!-- Persisted -->
<input id="temp" persist="false" />  <!-- Not persisted -->
<input format="password" />  <!-- Never persisted -->
```

## Debugging

- `console.log()` in app code is automatically redirected to `$melker.logger.info()` (won't break TUI)
- Objects are formatted safely using `Deno.inspect()` (handles circular refs)
- Use `--no-console-override` or `MELKER_NO_CONSOLE_OVERRIDE=1` to output to terminal instead
- Press F12 for Dev Tools dialog (source, policy, document tree, log file location)
- Press F6 for Performance dialog
- Set `MELKER_LOG_FILE=/tmp/debug.log MELKER_LOG_LEVEL=DEBUG` for custom log location

For common errors and debug strategies, see [TROUBLESHOOTING.md](references/TROUBLESHOOTING.md).

