# Melker

*Run text with meaning*

A TUI framework for apps you want to share safely.

Melker apps are documents you can read before you run them. Share via URL, declare permissions in a policy, inspect with Dev Tools.

**[Read the Manifesto](MANIFESTO.md)** for the philosophy behind this approach.

---

## Why Melker?

| Feature                      | Melker | Other TUI Frameworks |
|------------------------------|:------:|:--------------------:|
| Run from URL                 |   Y    |          -           |
| Permission sandbox           |   Y    |          -           |
| App approval system          |   Y    |          -           |
| Inspect policy before run    |   Y    |          -           |
| Dev Tools (view source, policy) |   Y    |          -           |
| Literate UI (Markdown)       |   Y    |          -           |
| No build step                |   Y    |         Some         |

*See [full comparison](agent_docs/tui-comparison.md) with Ink, Textual, Bubble Tea, Ratatui, and others.*

---

## Quick Start

Create `hello.melker`:

```html
<melker>
  <policy>
  {
    "name": "Hello App",
    "permissions": {
      "env": ["TERM"]
    }
  }
  </policy>

  <container style="border: thin; padding: 1;">
    <text style="font-weight: bold; color: cyan;">Hello, Terminal!</text>
    <button title="Exit" onClick="$melker.exit()" />
  </container>
</melker>
```

Run it:

```bash
deno run --allow-all melker.ts hello.melker
```

> **Why `--allow-all`?** The launcher (`melker.ts`) needs full permissions to parse, bundle, and spawn your app. But your app runs in a **subprocess** with only the permissions declared in its `<policy>`. The launcher is trusted; the app is sandboxed.
>
> Minimal launcher permissions: `--allow-read --allow-write=/tmp --allow-env --allow-run`

Before running, you can see:
- The policy declares only `env: TERM` permission
- The UI has one text element and one exit button
- The handler calls `$melker.exit()`, nothing else

Press **F12** to open Dev Tools and view source, policy, and system info.

---

## Key Concepts

### 1. Document-First

Apps are documents, not opaque processes. A `.melker` file is readable markup with:
- Declared permissions (`<policy>`)
- Visible structure (HTML-like elements)
- Inspectable handlers (`onClick="..."`)

### 2. Explicit Policy

Permissions are document metadata, visible before execution:

```html
<policy>
{
  "permissions": {
    "read": ["./data"],
    "write": ["./output"],
    "net": ["api.example.com"]
  }
}
</policy>
```

Run `--show-policy` to inspect without running:
```bash
deno run --allow-all melker.ts --show-policy app.melker
```

### 3. Run from URL

Share apps via URL:

```bash
# Run directly from URL
deno run --allow-all melker.ts https://example.com/app.melker

# Remote apps require explicit policy (enforced)
# First run prompts for approval (hash-based)
```

### 4. Three Abstraction Levels

**Programmatic** — TypeScript API:
```typescript
const btn = createElement('button', { title: 'Click', onClick: () => count++ });
```

**Declarative** — `.melker` files:
```html
<button title="Click" onClick="count++" />
```

**Literate** — `.melker.md` Markdown with embedded UI:
```markdown
# My App

Documentation and UI in the same file:

<button title="Click" onClick="count++" />
```

### 5. Dev Tools

Press F12 to open Dev Tools:
- View source
- Inspect policy
- See system info

---

## Features

### Components

| Category    | Components                                  |
|-------------|---------------------------------------------|
| Layout      | container, tabs                             |
| Text        | text, markdown                              |
| Input       | input, textarea, checkbox, radio            |
| Navigation  | button, menu-bar, menu, menu-item           |
| Data        | table (sorting, selection, scrolling), list |
| Dialogs     | dialog, alert, confirm, prompt              |
| Graphics    | canvas, video, progress                     |
| File System | file-browser                                |

### Layout

Flexbox with full support:
```html
<container style="display: flex; flex-direction: row; gap: 2;">
  <text style="flex: 1;">Left</text>
  <text style="flex: 1;">Right</text>
</container>
```

### Styling

CSS-like inline styles:
```html
<container style="border: rounded; padding: 1; color: cyan; background-color: #222;">
```

Or `<style>` tags with selectors:
```html
<style>
  button { background-color: blue; color: white; }
  #title { font-weight: bold; }
  .highlight { color: yellow; }
</style>
```

### Themes

Auto-detects terminal capabilities by default. Manual override:
```bash
MELKER_THEME=fullcolor-dark deno run --allow-all melker.ts app.melker
```

Available: `auto`, `bw-std`, `bw-dark`, `gray-std`, `gray-dark`, `color-std`, `color-dark`, `fullcolor-std`, `fullcolor-dark`

---

## Advanced Features

### Canvas and Graphics

Pixel graphics using sextant characters (2x3 pixels per cell):

```html
<canvas id="c" width="60" height="30" onPaint="draw(event.canvas)" />
```

```typescript
function draw(canvas) {
  canvas.setPixel(x, y, 0xFF0000FF);  // RGBA packed
  canvas.line(0, 0, 59, 29, color);
  canvas.rect(10, 10, 20, 15, color);
}
```

Features: true color, auto-dither, retained mode with `onPaint` callback.

### Video Playback

```html
<video src="./video.mp4" width="80" height="24" autoplay="true" />
```

Uses FFmpeg for decoding, dithering for display.

### Tables with Sorting and Selection

```html
<table style="width: fill; height: 10;">
  <thead>
    <tr><th>Name</th><th>Role</th></tr>
  </thead>
  <tbody scrollable="true" selectable="single">
    <tr data-id="1"><td>Alice</td><td>Admin</td></tr>
    <tr data-id="2"><td>Bob</td><td>User</td></tr>
  </tbody>
</table>
```

Click headers to sort. Arrow keys to navigate. Full keyboard and mouse support.

### OAuth Built-in

```html
<oauth
  wellknown="https://auth.example.com/.well-known/openid-configuration"
  clientId="my-app"
  scopes="openid profile"
  onToken="handleToken(event.token)"
/>
```

Handles browser redirect, token exchange, and secure storage.

### State Persistence

```bash
MELKER_PERSIST=true deno run --allow-all melker.ts app.melker
```

Element state persists across runs using XDG state directory.

---

## Running Apps

```bash
# Run local file
deno run --allow-all melker.ts app.melker

# Run from URL
deno run --allow-all melker.ts https://example.com/app.melker

# Show policy without running
deno run --allow-all melker.ts --show-policy app.melker

# Trust mode (bypass approval prompt, for scripts)
deno run --allow-all melker.ts --trust app.melker

# Watch mode (auto-reload on changes)
deno run --allow-all melker.ts --watch app.melker

# Enable debug server
MELKER_DEBUG_PORT=8080 deno run --allow-all melker.ts app.melker
```

---

## TypeScript API

For programmatic use:

```typescript
import { createElement, createApp } from '@melker/core';

const ui = createElement('container', {
  style: { border: 'thin', padding: 2 }
},
  createElement('text', { text: 'Hello!' }),
  createElement('button', { title: 'OK', onClick: () => app.exit() })
);

const app = await createApp(ui);
```

Or with template literals:

```typescript
import { melker, createApp } from '@melker/core';

const ui = melker`
  <container style=${{ border: 'thin', padding: 2 }}>
    <text>Hello!</text>
    <button title="OK" onClick=${() => app.exit()} />
  </container>
`;

const app = await createApp(ui);
```

---

## Requirements

- **Deno 2.5+** (Node.js and Bun not supported)
- ANSI-compatible terminal

---

## Development

```bash
deno task check     # Type check
deno task test      # Run tests
```

### Key Environment Variables

| Variable            | Purpose                           |
|---------------------|-----------------------------------|
| `MELKER_THEME`      | Theme selection (default: `auto`) |
| `MELKER_DEBUG_PORT` | Enable debug server               |
| `MELKER_HEADLESS`   | Headless mode for testing         |
| `MELKER_PERSIST`    | Enable state persistence          |
| `MELKER_LOG_FILE`   | Log file path                     |
| `MELKER_LOG_LEVEL`  | `DEBUG`, `INFO`, `WARN`, `ERROR`  |

### Project Structure

```
melker.ts              # Main entry point
src/
  engine.ts            # Application engine
  layout.ts            # Flexbox layout
  rendering.ts         # Render pipeline
  template.ts          # .melker file parsing
  policy/              # Permission system
  bundler/             # Runtime bundler
  components/          # UI components
  video/               # Video processing
  ai/                  # AI accessibility
examples/
  melker/              # .melker file examples
  ts/                  # TypeScript examples
```

---

## Examples

```bash
# Counter with state
deno run --allow-all melker.ts examples/melker/counter.melker

# Markdown viewer (pass file as argument)
deno run --allow-all melker.ts examples/melker/markdown_viewer.melker README.md

# Dialog system
deno run --allow-all melker.ts examples/melker/dialog_demo.melker

# Canvas animation
deno run --allow-all melker.ts examples/melker/analog-clock.melker
```

---

## License

[MIT License](LICENSE.txt)

