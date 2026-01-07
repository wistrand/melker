---
name: creating-melker-apps
description: Creates Terminal UI applications using Melker's .melker file format. Use when the user asks to build terminal apps, TUI interfaces, create .melker files, or mentions Melker components like containers, buttons, dialogs, tabs, canvas, or forms.
---

# Creating Melker Apps

Melker is a Deno library for building rich Terminal UI interfaces using an HTML-inspired document model. Apps are written in `.melker` files with XML-like syntax.

## Quick Start

```xml
<melker>
  <title>My App</title>
  <container style="border: thin; padding: 1;">
    <text>Hello, World!</text>
    <button title="Click Me" onClick="alert('Clicked!')" />
  </container>
</melker>
```

**Run:** `./melker.ts --trust app.melker`

## Critical Rules

1. **Button uses `title` prop** - Not `label`
2. **Don't add border to buttons** - Buttons already have `[ ]` brackets; adding border creates `[ [ Button ] ]`
3. **Input type is `'input'`** - Not `'text-input'`
4. **Never use `console.log()`** - Use `$melker.logger.debug()`, `.info()`, `.warn()`, `.error()`
5. **Auto-render** - Event handlers auto-render; return `false` to skip
6. **Update props explicitly** - Use `$melker.getElementById('id').props.propName = value`
7. **Avoid emojis** - They break terminal layout

## File Structure

```xml
<melker>
  <title>App Title</title>

  <style>
    #myId { font-weight: bold; }
    .myClass { padding: 1; }
  </style>

  <script type="typescript">
    let count = 0;
    export function increment() { count++; }
  </script>

  <container><!-- UI tree --></container>
</melker>
```

## Context API

| API | Description |
|-----|-------------|
| `$melker.getElementById(id)` | Get element by ID |
| `$melker.render()` | Trigger re-render (for intermediate states) |
| `$melker.exit()` | Exit application |
| `$melker.alert(message)` | Show modal alert |
| `$melker.copyToClipboard(text)` | Copy to clipboard |
| `$melker.logger.debug/info/warn/error()` | Log to file (F12 shows location) |
| `$app.functionName()` | Call exported script functions |

## Core Components

| Component | Key Props | Notes |
|-----------|-----------|-------|
| `<container>` | style, scrollable | Flexbox layout |
| `<text>` | id, style | Text content |
| `<input>` | placeholder, value, format, onInput | Single-line (format: 'text'\|'password') |
| `<textarea>` | placeholder, rows, cols, wrap | Multi-line |
| `<button>` | **title**, onClick | Uses `title` NOT `label` |
| `<dialog>` | title, open, modal, backdrop | Modal overlay |
| `<checkbox>` | title, checked, onChange | Toggle |
| `<radio>` | title, value, name, onChange | Radio button |
| `<tabs>` / `<tab>` | activeTab, onTabChange / title | Tabbed panels |
| `<list>` / `<li>` | style | Lists |
| `<canvas>` | width, height, onPaint | Pixel graphics |
| `<img>` | src, width, height, dither | Images |
| `<combobox>` | placeholder, filter, onSelect | Filterable dropdown |
| `<select>` | value, onSelect | Dropdown picker |
| `<markdown>` | src, text, onLink | Markdown rendering |

For complete component reference, see [COMPONENTS.md](COMPONENTS.md).

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
**Borders:** `border` (none|thin|thick|double|rounded|dashed|ascii)
**Text:** `font-weight`, `text-align`, `text-wrap`
**Size values:** Numbers (columns/rows), percentages (`100%`), `fill`

**Avoid specifying colors** - Let the theme engine handle colors for best appearance across themes. Only use `color`/`background-color` for canvas drawing or very intentional effects.

## Event Handling

Events auto-render after completion:

```xml
<!-- Simple handler -->
<button title="Click" onClick="alert('Hi!')" />

<!-- Access elements -->
<button onClick="
  const el = $melker.getElementById('counter');
  el.props.text = String(parseInt(el.props.text) + 1);
" />

<!-- Call exported functions -->
<button onClick="$app.increment()" />

<!-- Async with intermediate state -->
<button onClick="
  statusEl.props.text = 'Loading...';
  $melker.render();
  await fetchData();
  statusEl.props.text = 'Done';
" />

<!-- Skip auto-render -->
<button onClick="console.log('no UI change'); return false" />
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
    if (el) el.props.text = String(count);
    $melker.render();
  }

  // Access via $app.increment() in event handlers
</script>
```

## Common Patterns

### Counter

```xml
<container style="display: flex; flex-direction: row; gap: 1;">
  <button title="-" onClick="
    const el = $melker.getElementById('count');
    el.props.text = String(parseInt(el.props.text) - 1);
  " />
  <text id="count">0</text>
  <button title="+" onClick="
    const el = $melker.getElementById('count');
    el.props.text = String(parseInt(el.props.text) + 1);
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
  <button title="Submit" onClick="
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
  let dialogOpen = false;
  export function openDialog() {
    dialogOpen = true;
    $melker.getElementById('myDialog').props.open = true;
    $melker.render();
  }
  export function closeDialog() {
    dialogOpen = false;
    $melker.getElementById('myDialog').props.open = false;
    $melker.render();
  }
</script>

<button title="Open" onClick="$app.openDialog()" />
<dialog id="myDialog" title="My Dialog" open="false" modal="true" backdrop="true">
  <container style="padding: 1;">
    <text>Dialog content here</text>
    <button title="Close" onClick="$app.closeDialog()" />
  </container>
</dialog>
```

### Tabs

```xml
<tabs id="myTabs" activeTab="0">
  <tab title="Tab 1">
    <text>Content for tab 1</text>
  </tab>
  <tab title="Tab 2">
    <text>Content for tab 2</text>
  </tab>
</tabs>
```

### Combobox with Groups

```xml
<combobox placeholder="Select..." filter="fuzzy" onSelect="$app.onSelect(event.value, event.label)">
  <group label="Group A">
    <option value="a1">Option A1</option>
    <option value="a2">Option A2</option>
  </group>
  <group label="Group B">
    <option value="b1">Option B1</option>
  </group>
</combobox>
```

For more examples, see [EXAMPLES.md](EXAMPLES.md).

## Permissions (Policy)

**Recommendation:** Always add a `<policy>` section for apps that need file, network, or system access. This enables permission sandboxing and is **required for remote/URL-hosted apps**.

```xml
<melker>
  <policy>
  {
    "name": "My App",
    "description": "What the app does",
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

**Permission types:**
| Permission | Example | Description |
|------------|---------|-------------|
| `read` | `["."]` or `["*"]` | File system read access |
| `write` | `["/data"]` | File system write access |
| `net` | `["api.example.com"]` | Network access to hosts |
| `run` | `["ffmpeg"]` | Execute system commands |
| `env` | `["API_KEY"]` | Environment variable access |

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

**When to omit policy:** Simple local apps with no file/network needs can skip the policy tag (they get full permissions when run with `--trust`).

## State Persistence

Elements with `id` are auto-persisted. Opt-out with `persist="false"`:

```xml
<input id="saved" />         <!-- Persisted -->
<input id="temp" persist="false" />  <!-- Not persisted -->
<input format="password" />  <!-- Never persisted -->
```

## Debugging

- Use `$melker.logger.debug()`, `.info()`, `.warn()`, `.error()` for logging
- Press F12 for Dev Tools dialog (shows log file location, view source)
- Press F6 for Performance dialog
- Set `MELKER_LOG_FILE=/tmp/debug.log MELKER_LOG_LEVEL=DEBUG` for custom log location
