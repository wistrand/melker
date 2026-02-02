# Getting Started with Melker

## Install

```bash
# Requires Deno 2.5+
git clone https://github.com/wistrand/melker.git
cd melker

# Optional: install globally
ln -s $(pwd)/melker.ts ~/.local/bin/melker
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
melker hello.melker

# Watch mode - auto-reload on file changes
melker --watch hello.melker
```

## Core Concepts

**Structure:** `<melker>` contains special tags + UI elements

```xml
<melker>
  <title>App Name</title>
  <policy>{"permissions": {...}}</policy>
  <style>/* CSS-like rules */</style>
  <container><!-- UI --></container>
  <script type="typescript">/* code */</script>
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

**Layout:** The root viewport, `container`, `dialog`, and `tab` all default to `display: flex` with `flex-direction: column`:

```xml
<!-- display: flex is auto-inferred, so this is equivalent -->
<container style="flex-direction: column; gap: 1;">
```

**Interactivity:** Export functions, access via `$app.*`

```xml
<melker>
  <container style="flex-direction: row; gap: 1;">
    <text id="count">0</text>
    <button onClick="$app.increment()">+1</button>
  </container>

  <script>
    export function increment() {
      const el = $melker.getElementById('count');
      el.setValue(String(parseInt(el.getValue()) + 1));
    }
  </script>
</melker>
```

## Critical Rules

1. **No reactivity** – Update UI with `getElementById().setValue()`
2. **Button label** – Use `<button>Label</button>` not `title="Label"`
3. **No button borders** – Buttons have built-in `[ ]` brackets
4. **Export functions** – Required for `$app.*` access
5. **Avoid colors** – Let theme engine handle styling
6. **Console is safe (in app code)** – Redirects to logger, won't break TUI

## Script Types

| Attribute        | When                   | Use Case                              |
|------------------|------------------------|---------------------------------------|
| (none)           | Before render          | Define exports, setup state           |
| `async="init"`   | Before render (async)  | Fetch data, async setup               |
| `async="ready"`  | After first render     | Access rendered elements, start timers |

## Common Components

| Type                  | Purpose              |
|-----------------------|----------------------|
| `container`           | Flexbox layout       |
| `text`                | Static text          |
| `input`               | Single-line input    |
| `button`              | Clickable action     |
| `checkbox` / `radio`  | Toggle/select        |
| `dialog`              | Modal overlay        |
| `tabs` / `tab`        | Tabbed panels        |
| `combobox` / `select` | Dropdowns            |
| `data-table`          | Sortable table       |
| `canvas`              | Pixel graphics       |
| `graph`               | Mermaid diagrams     |
| `connector`           | Lines between elements |

## Runtime API (`$melker`)

| Method                         | Purpose                    |
|--------------------------------|----------------------------|
| `getElementById(id)`           | Get element by ID          |
| `render()`                     | Trigger re-render          |
| `alert(message)`               | Modal dialog               |
| `toast.show(message, options?)`| Non-modal notification     |
| `toast.dismissAll()`           | Clear all toasts           |
| `exit()`                       | Exit application           |

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

## CLI Options

```bash
melker app.melker              # Run app
melker diagram.mmd             # Run mermaid file directly
melker --watch app.melker      # Auto-reload on changes
melker --show-policy app.melker # Show permissions
melker --trust app.melker      # Bypass approval prompt (CI/scripts)
melker --stdout app.melker     # Output single frame to stdout and exit
melker --interactive app.melker # Force TUI mode even when piped
melker --color=always app.melker # Force ANSI colors even when piped

# Permission overrides
melker --allow-net=api.example.com app.melker  # Add network permission
melker --deny-read=/etc/passwd app.melker      # Deny specific path
melker --allow-ai app.melker                   # Enable AI shortcut
```

**Mermaid files:** Plain `.mmd` files can be run directly and require no permissions or approval.

**Piping:** When stdout is not a TTY (piped or redirected), Melker automatically renders a single frame and exits with plain text output (no ANSI codes). Use `--interactive` to force TUI mode, or `--color=always` to include ANSI codes when piping to tools that support them (e.g., `less -R`).

**Deno flags** forwarded to subprocess: `--reload`, `--no-lock`, `--no-check`, `--quiet`/`-q`, `--cached-only`

```bash
# Reload remote modules
melker --reload http://example.com/app.melker
```

## Debugging

- **--watch** – Auto-reload on file changes (recommended for development)
- **--stdout** – Output single frame to stdout (useful for layout debugging, piping)
- **F12** – Dev Tools overlay (source, policy, inspect, config, log path)
- **console.log()** – Safe in app code, writes to log file
- **--debug** – Verbose bundler output

## Next Steps

- Examples: [`examples/`](../examples/) (basics, components, layout, canvas, melker)
- Components: [`COMPONENTS.md`](../skills/creating-melker-apps/references/COMPONENTS.md)
- Footguns: [`dx-footguns.md`](dx-footguns.md)
- Full reference: [`CLAUDE.md`](../CLAUDE.md)
