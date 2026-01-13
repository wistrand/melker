# Getting Started with Melker

## Install

```bash
# Requires Deno 2.5+
ln -s /path/to/melker/melker.ts ~/.local/bin/melker
```

## Hello World

```xml
<melker>
  <container style="border: thin; padding: 1;">
    <text>Hello, World!</text>
  </container>
</melker>
```

```bash
melker --trust hello.melker
```

## Core Concepts

**Structure:** `<melker>` contains special tags + UI elements

```xml
<melker>
  <title>App Name</title>
  <style>/* CSS-like rules */</style>
  <script type="typescript">/* code */</script>
  <policy>{"permissions": {...}}</policy>
  <container><!-- UI tree --></container>
</melker>
```

**Multiple top-level elements** are auto-wrapped in a flex column container:
```xml
<melker>
  <text>Header</text>
  <container style="flex: 1;">Content</container>
  <text>Footer</text>
</melker>
```

**Layout:** Flexbox via style props

```xml
<container style="display: flex; flex-direction: column; gap: 1;">
```

**Interactivity:** Export functions, access via `$app.*`

```xml
<script>
  export function increment() {
    const el = $melker.getElementById('count');
    el.setValue(String(parseInt(el.getValue()) + 1));
  }
</script>
<button onClick="$app.increment()">+1</button>
```

## Critical Rules

1. **No reactivity** – Update UI with `getElementById().setValue()`
2. **Button label** – Use `<button>Label</button>` not `title="Label"`
3. **No button borders** – Buttons have built-in `[ ]` brackets
4. **Export functions** – Required for `$app.*` access
5. **Avoid colors** – Let theme engine handle styling
6. **Console is safe** – Redirects to logger, won't break TUI

## Script Types

| Attribute | When | Use Case |
|-----------|------|----------|
| (none) | Before render | Define exports, setup state |
| `async="init"` | Before render (async) | Fetch data, async setup |
| `async="ready"` | After first render | Access rendered elements, start timers |

## Common Components

| Type | Purpose |
|------|---------|
| `container` | Flexbox layout |
| `text` | Static text |
| `input` | Single-line input |
| `button` | Clickable action |
| `checkbox` / `radio` | Toggle/select |
| `dialog` | Modal overlay |
| `tabs` / `tab` | Tabbed panels |
| `combobox` / `select` | Dropdowns |
| `data-table` | Sortable table |
| `canvas` | Pixel graphics |

## Permissions (for file/network access)

```xml
<policy>
{
  "name": "My App",
  "permissions": {
    "read": ["."],
    "net": ["api.example.com"]
  }
}
</policy>
```

## Debugging

- **F12** – Dev Tools overlay (source, config, log path)
- **console.log()** – Safe, writes to log file
- **--debug** – Verbose bundler output

## Next Steps

- Examples: [`examples/melker/*.melker`](../examples/melker/)
- Components: [`COMPONENTS.md`](../skills/creating-melker-apps/COMPONENTS.md)
- Footguns: [`dx-footguns.md`](dx-footguns.md)
- Full reference: [`CLAUDE.md`](../CLAUDE.md)
