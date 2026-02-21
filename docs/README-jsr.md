# Melker

*Run text with meaning*

**Website:** [melker.sh](https://melker.sh) | **GitHub:** [wistrand/melker](https://github.com/wistrand/melker)

A terminal UI framework for building document-first TUI applications. Melker
apps are readable markup files with declared permissions, shareable via URL, and
inspectable with built-in Dev Tools. Each app runs in a sandboxed Deno
subprocess with only the permissions it declares.

## Installation

```bash
deno install -g -A jsr:@wistrand/melker
```

Requires **Deno 2.5+** and an ANSI-compatible terminal.

## Try Without Installing

```bash
deno x jsr:@wistrand/melker app.melker
```
[Nerd Fonts](https://www.nerdfonts.com/) recommended for graphics.

## Usage

Run a `.melker` file from anywhere:

```bash
melker app.melker
melker https://melker.sh/examples/demo.melker
```

Or run directly from a URL without installing:

```bash
deno run -A https://melker.sh/melker.ts app.melker
```

## Creating Apps

A `.melker` file is HTML-like markup with an embedded permission policy:

```html
<melker>
  <policy>
  {
    "name": "Hello App",
    "permissions": { "env": ["TERM"] }
  }
  </policy>

  <style>
    container { border: thin; padding: 1; }
    text { font-weight: bold; color: cyan; }
  </style>

  <container>
    <text>Hello, Terminal!</text>
    <button label="Exit" onClick="$melker.exit()" />
  </container>
</melker>
```

Press **F12** at runtime to open Dev Tools (source, policy, document tree,
system info).

## TypeScript API

Import from `@wistrand/melker/lib` for programmatic use:

```typescript
import { createElement, createApp } from "@wistrand/melker/lib";

const ui = createElement(
  "container",
  { style: { border: "thin", padding: 2 } },
  createElement("text", { text: "Hello!" }),
  createElement("button", { label: "OK", onClick: () => app.exit() }),
);

const app = await createApp(ui);
```

Or with template literals:

```typescript
import { melker, createApp } from "@wistrand/melker/lib";

const ui = melker`
  <container style=${{ border: "thin", padding: 2 }}>
    <text>Hello!</text>
    <button label="OK" onClick=${() => app.exit()} />
  </container>
`;

const app = await createApp(ui);
```

## Components

| Category   | Elements                                        |
|------------|-------------------------------------------------|
| Layout     | container, tabs, split-pane                     |
| Text       | text, markdown                                  |
| Input      | input, textarea, checkbox, radio, slider        |
| Navigation | button, command-palette                         |
| Data       | data-table, data-tree, data-bars, data-heatmap  |
| Dropdowns  | combobox, select, autocomplete                  |
| Dialogs    | dialog, alert, confirm, prompt                  |
| Files      | file-browser                                    |
| Graphics   | canvas, img, video                              |

## Permission Sandboxing

Apps declare permissions in a `<policy>` tag. The launcher parses the policy,
shows an approval prompt on first run, then spawns the app in a restricted Deno
subprocess with only the approved permissions:

```html
<policy>
{
  "permissions": {
    "read": ["."],
    "net": ["api.example.com"],
    "run": ["ffmpeg"]
  }
}
</policy>
```

Override permissions at runtime:

```bash
melker --allow-net=cdn.example.com app.melker
melker --deny-read=/etc app.melker
```

Use `--trust` to skip the approval prompt in CI/scripts.

## Upgrade

```bash
melker upgrade
```

## Documentation

- [Getting Started](https://github.com/wistrand/melker/blob/main/agent_docs/getting-started.md)
- [Step-by-step Tutorial](https://melker.sh/tutorial.html)
- [Examples](https://github.com/wistrand/melker/tree/main/examples)
- [Manifesto](https://github.com/wistrand/melker/blob/main/MANIFESTO.md)
- [FAQ](https://github.com/wistrand/melker/blob/main/FAQ.md)

## License

[MIT](https://github.com/wistrand/melker/blob/main/LICENSE.txt)
