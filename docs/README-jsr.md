# Melker

*Run text with meaning*

**Website:** [melker.sh](https://melker.sh) | **GitHub:** [wistrand/melker](https://github.com/wistrand/melker)

A TUI framework for apps you want to share safely. Melker apps are documents you can read before you run them — share via URL, declare permissions in a policy, inspect with Dev Tools.

---

## Installation

```bash
deno install -g -A jsr:@wistrand/melker
```

Then run from anywhere:

```bash
melker app.melker
melker https://example.com/app.melker
```

### Requirements

- **Deno 2.5+**
- ANSI-compatible terminal
- **Nerd Fonts** (recommended for graphics)

### Upgrade

```bash
melker upgrade
```

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
    <button label="Exit" onClick="$melker.exit()" />
  </container>
</melker>
```

Run it:

```bash
melker hello.melker
```

> **Why `-A`?** The launcher needs full permissions to parse, bundle, and spawn your app. But your app runs in a **subprocess** with only the permissions declared in its `<policy>`. The launcher is trusted; the app is sandboxed.

Press **F12** to open Dev Tools to view source, policy, document tree, and system info.

---

## TypeScript API

Import from `@wistrand/melker/lib`:

```typescript
import { createElement, createApp } from '@wistrand/melker/lib';

const ui = createElement('container', {
  style: { border: 'thin', padding: 2 }
},
  createElement('text', { text: 'Hello!' }),
  createElement('button', { label: 'OK', onClick: () => app.exit() })
);

const app = await createApp(ui);
```

Or with template literals:

```typescript
import { melker, createApp } from '@wistrand/melker/lib';

const ui = melker`
  <container style=${{ border: 'thin', padding: 2 }}>
    <text>Hello!</text>
    <button label="OK" onClick=${() => app.exit()} />
  </container>
`;

const app = await createApp(ui);
```

---

## Features

| Feature                      | Melker | Other TUI Frameworks |
|------------------------------|:------:|:--------------------:|
| Run from URL                 |   Y    |          -           |
| Permission sandbox           |   Y    |          -           |
| App approval system          |   Y    |          -           |
| Inspect policy before run    |   Y    |          -           |
| Dev Tools (source, policy, inspect) |   Y    |          -           |
| Literate UI (Markdown)       |   Y    |          -           |
| No build step                |   Y    |         Some         |

### Components

| Category    | Components                                        |
|-------------|---------------------------------------------------|
| Layout      | container, flexbox, tabs                          |
| Text        | text, markdown                                    |
| Input       | input, textarea, checkbox, radio, slider          |
| Navigation  | button, command-palette                           |
| Data        | table, data-table, list                           |
| Dropdowns   | combobox, select, autocomplete, command-palette   |
| Dialogs     | dialog, alert, confirm, prompt                    |
| Feedback    | progress                                          |
| Files       | file-browser                                      |
| Graphics    | canvas, img, video                                |
| Auth        | oauth                                             |

### Styling

CSS-like inline styles and `<style>` tags with selectors:

```html
<container style="border: rounded; padding: 1; color: cyan;">
  <text style="font-weight: bold;">Styled text</text>
</container>
```

### Themes

Auto-detects terminal capabilities. Override with `--theme`:

```bash
melker --theme fullcolor-dark app.melker
```

---

## Documentation

Full documentation, examples, manifesto, and FAQ are on GitHub:

- [Getting Started](https://github.com/wistrand/melker/blob/main/agent_docs/getting-started.md)
- [Manifesto](https://github.com/wistrand/melker/blob/main/MANIFESTO.md)
- [FAQ](https://github.com/wistrand/melker/blob/main/FAQ.md)
- [Examples](https://github.com/wistrand/melker/tree/main/examples)
- [Step-by-step tutorial](https://melker.sh/tutorial.html)

---

## License

[MIT License](https://github.com/wistrand/melker/blob/main/LICENSE.txt)
