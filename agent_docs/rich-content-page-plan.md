# Plan: Rich Content Components Doc Page

## Context

`docs/rich-content.html` follows the same structure as `docs/data-visualization.html` and `docs/filterable-lists.html`. Covers the rich content components: `markdown`, `graph` (mermaid), `img`, `canvas`, `file-browser`.

These components render documents, images, diagrams, and pixel graphics in the terminal. The file browser requires `read` permission. No network permissions needed for the examples.

## Page Structure

| # | Section | Component | Example file |
|---|---------|-----------|-------------|
| 1 | Markdown | `<markdown>` | `docs/examples/content/markdown.melker` |
| 2 | Mermaid diagrams | `<graph>` | `docs/examples/content/mermaid.melker` |
| 3 | Images | `<img>` | `docs/examples/content/img.melker` |
| 4 | Canvas | `<canvas>` | `docs/examples/content/canvas.melker` |
| 5 | File browser | `<file-browser>` | `docs/examples/content/file-browser.melker` |
| 6 | Markdown props | `<markdown>` | (code-only, no separate example) |
| 7 | Diagram types | `<graph>` | (code-only) |
| 8 | File browser props | `<file-browser>` | (code-only) |

## Files

| File | Purpose |
|------|---------|
| `docs/rich-content.html` | The doc page |
| `docs/examples/content/markdown.melker` | Markdown viewer with `src` and `onLink` |
| `docs/examples/content/mermaid.melker` | Mermaid flowchart with subgraphs |
| `docs/examples/content/img.melker` | Image display with `melker-128.png` logo |
| `docs/examples/content/canvas.melker` | Canvas drawing with bars, circle, text |
| `docs/examples/content/file-browser.melker` | File browser in a dialog |
| `docs/examples/content/sample.md` | Sample markdown rendered by the markdown example |

## Example .melker Files

Each example is self-contained. Uses `<script async="ready">` with `$melker.render()` where needed for stdout capture. Policy: `{"permissions": {}}` except file-browser and markdown which need `"read": ["*"]`.

### markdown.melker
Loads a markdown file via `src` prop (defaults to `argv[1]` or `README.md`). Shows `onLink` handler that navigates between documents or opens URLs in browser. Policy needs `read`.

### mermaid.melker
Git workflow flowchart using `<graph>` component with `overflow: scroll`. Shows subgraphs (Local, Remote), nodes, and edge labels. No permissions needed.

### img.melker
Displays `melker-128.png` at 20x10 with `object-fit: contain`. Laid out in a row with text describing the format, mode, and fit. Policy needs `read`.

### canvas.melker
Three colored bars with text labels (40%, 30%, 20%), a circle, and a line. Uses `onPaint` handler with `fillRect`, `drawText`, `drawCircleCorrected`, `drawLine`. No permissions needed.

### file-browser.melker
File browser inside a `<dialog>` opened programmatically via `async="ready"` script. Shows breadcrumb path, filter input, file list with scrollbar, Cancel/Open buttons. Policy needs `read`.

## Key Documentation Points

### Images section
- Sextant rendering: 2x3 pixels per terminal cell
- Formats: PNG, JPEG, GIF (animated), WebP
- `object-fit`: contain, fill (default), cover
- Animated GIF playback, disable with `--no-animate-gif`
- Separate `<video>` component for MP4/RTSP (requires FFmpeg)
- Images in markdown (`![alt](path.png)`) use the same rendering

### Canvas section
- `onPaint` handler provides canvas object
- Drawing methods: `fillRect`, `drawLine`, `drawCircleCorrected`, `drawText`
- SVG path support for curves and complex shapes
- Per-pixel shaders via `onShader` (requires `"shader": true` policy)
- SVG overlays via `svgOverlay` prop
- `<img>` extends canvas, so all canvas methods available on images

### Markdown section
- `src` prop for file/URL, `text` for inline
- `onLink` event for navigation
- GFM tables, syntax-highlighted code blocks, blockquotes
- Images in markdown rendered inline
- Mermaid code blocks rendered as diagrams

## Generating Terminal Output

```bash
run_example() {
  ./melker.ts --trust --stdout --stdout-width=60 --stdout-height=$2 \
    --color=always --stdout-timeout=2000 "docs/examples/content/$1" \
    2>/dev/null | ./scripts/ansi2html.ts
}

run_example markdown.melker 18    # with: -- docs/examples/content/sample.md
run_example mermaid.melker 28
run_example img.melker 14
run_example canvas.melker 18
run_example segment.melker 22
run_example file-browser.melker 18
```

## Nav Dropdown Update

Added to all doc pages' dropdown menus, after "Filterable Lists":

```html
<a href="/rich-content.html">Rich Content</a>
```

## Writing Style

- No em-dashes. Use periods, colons, commas, or "and" instead.
- No bragging language ("powerful", "seamless", "beautiful", etc.).
- Keep descriptions factual and concise.
