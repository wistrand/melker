# .melker File Format

The `.melker` file format is an HTML-like declarative syntax for building Melker terminal UIs.

**Run with:**
```bash
deno run --allow-all melker.ts <file>.melker
deno run --allow-all melker.ts http://server/path/file.melker  # URL support
```

## Structure

Files can use either a `<melker>` wrapper (for scripts/styles) or a direct root component:

```xml
<melker>
  <title>App Title</title>

  <style>
    button { background-color: blue; }
    #myId { color: red; }
    .myClass { border: thin; }
  </style>

  <script type="typescript">
    // TypeScript code - export functions via: exports = { fn1, fn2 }
  </script>

  <container><!-- UI --></container>
</melker>
```

## Special Tags

| Tag | Description |
|-----|-------------|
| `<melker>` | Root wrapper (optional) |
| `<title>` | Window/terminal title |
| `<style>` | CSS-like stylesheet rules (selector { props }) |
| `<script>` | TypeScript/JavaScript code block |
| `<oauth>` | OAuth2 PKCE configuration |

## Components

| Component | Key Props | Notes |
|-----------|-----------|-------|
| `<container>` | style, scrollable | Flexbox layout container |
| `<text>` | id, style | Inner content or `text` prop |
| `<input>` | id, placeholder, value, onKeyPress, onInput | Single-line text input |
| `<textarea>` | id, placeholder, value, rows, cols, wrap, maxLength | Multi-line text input |
| `<button>` | id, title, onClick | Uses `title` not `label` |
| `<dialog>` | id, title, open, modal, backdrop | Modal overlay |
| `<file-browser>` | id, path | File system navigation |
| `<menu-bar>` | style | Horizontal menu container |
| `<menu>` | title | Dropdown menu |
| `<menu-item>` | title, onClick | Menu entry |
| `<menu-separator>` | | Visual separator in menus |
| `<checkbox>` | id, title, checked, onChange | Toggle checkbox |
| `<radio>` | id, title, value, checked, name, onChange | Radio button |
| `<list>` | style | List container |
| `<li>` | style | List item |
| `<canvas>` | width, height | Pixel graphics |
| `<markdown>` | | Markdown text rendering |

## Styling

CSS-like properties in `style` attribute:

- **Layout:** width, height, display (flex/block), flex-direction, flex, padding, margin, overflow
- **Borders:** border (thin/thick/double/none), border-top/right/bottom/left, border-color
- **Colors:** color, background-color (names or hex like `#00d9ff`)
- **Text:** font-weight (bold/normal), text-align, text-wrap

## Events & Context

**Events:** onClick, onKeyPress (event.key), onInput (event.value), onFocus, onBlur

**Context API:**
- `context.getElementById(id)` - Get element by ID
- `context.render()` - Trigger re-render (required after prop changes)
- `context.exit()` - Exit application
- Exported script functions available as `context.functionName()`

## Examples

See `examples/melker/` for complete examples:
- `hello.melker` - Simple hello world
- `counter.melker` - Basic counter with buttons
- `dialog_demo.melker` - Dialog variants
- `menu_example.melker` - Menu bar with dropdowns
- `input-demo.melker` - Input fields
- `textarea_demo.melker` - Multi-line text input
- `flex-demo.melker` - Flexbox layout examples
- `canvas_test.melker` - Canvas graphics
- `analog-clock.melker` - Canvas-based analog clock
- `markdown_viewer.melker` - Markdown rendering

## Running

```bash
# Basic
deno run --allow-all melker.ts examples/melker/counter.melker

# From URL
deno run --allow-all melker.ts http://localhost:1990/melker/counter.melker

# With lint validation
deno run --allow-all melker.ts --lint examples/melker/counter.melker

# With logging
MELKER_LOG_FILE=/tmp/debug.log MELKER_LOG_LEVEL=debug deno run --allow-all melker.ts app.melker

# With theme
MELKER_THEME=fullcolor-dark deno run --allow-all melker.ts app.melker

# Start LSP server (for editor integration)
deno run --allow-all melker.ts --lsp
```
