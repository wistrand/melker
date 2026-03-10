# Plan: docs/data-visualization.html

## Narrative Arc

The doc isn't a component reference. It's a story about connecting live data sources to meaningful views inside a permission sandbox. The manifesto says terminal apps should be inspectable and trustworthy. This page shows what that looks like when the data is real.

## Title

**"Data Visualization"** with subtitle: "Tables, charts, heatmaps, and trees. Fed by live data, locked to declared permissions."

## Sections

| # | Section                    | Purpose                                                                                       |
|---|----------------------------|-----------------------------------------------------------------------------------------------|
| 1 | **Tables**                  | `data-table`: fetch JSON, sort, map to rows, `setValue()`. Sorting, scrolling are built in   |
| 2 | **Bar charts**              | `data-bars`: sparkline (height: 1), vertical bars, grouped, streaming via `appendEntry`/`shiftEntry` |
| 3 | **Box plots**               | `data-boxplot`: pass raw values, component computes quartiles. Or pass pre-computed `stats`  |
| 4 | **Heatmaps**                | `data-heatmap`: 2D grid, color scales, partial updates via `setCell`/`setRow`, isolines      |
| 5 | **Trees**                   | `data-tree`: hierarchical data with extra columns, expand/collapse, virtual scrolling         |
| 6 | **Connecting views**        | `bind:selection` syncs selection across boxplot + table + bars. `createState` + `onGetId`    |
| 7 | **The pattern**             | Recurring shape: declare permissions, fetch, transform, `setValue()`, refresh                 |
| 8 | **Policy details**          | Full policy examples: `net` permissions, `configSchema` for API keys                         |

## Files

| File                                            | Purpose                                          |
|-------------------------------------------------|--------------------------------------------------|
| `docs/data-visualization.html`                  | The doc page with colored `<pre>` output blocks  |
| `docs/shared.css`                               | Shared styles; includes `pre.terminal` class     |
| `scripts/ansi2html.ts`                       | ANSI-to-HTML converter (stdin to stdout)         |
| `docs/examples/dataviz/table.melker`            | Earthquake table                                 |
| `docs/examples/dataviz/sparkline.melker`        | True sparkline (height: 1, gap: 0)              |
| `docs/examples/dataviz/bars.melker`             | Magnitude vertical bar chart                     |
| `docs/examples/dataviz/boxplot.melker`          | Electricity price box plot                       |
| `docs/examples/dataviz/heatmap.melker`          | Weekly activity heatmap                          |
| `docs/examples/dataviz/tree.melker`             | Project file tree with extra columns             |
| `docs/examples/dataviz/connected.melker`        | Three connected views (boxplot + table + bars)   |
| `docs/examples/dataviz/grouped-bars.melker`     | Grouped bars (2024 vs 2025, Q1-Q3)               |
| `docs/examples/dataviz/isolines.melker`         | Heatmap with viridis color scale and isolines    |
| `docs/examples/dataviz/earthquakes.json`        | USGS-style earthquake GeoJSON (12 features)      |
| `docs/examples/dataviz/electricity-prices.json` | SE1-SE4 hourly prices (48 values each)           |
| `docs/examples/dataviz/activity.json`           | 5x8 office activity grid (Mon-Fri, 9am-4pm)     |
| `docs/examples/dataviz/files.json`              | Hierarchical file tree with sizes and types      |

## Code examples in the doc must match the real .melker files

Each section's code block is taken directly from the corresponding `.melker` file. The code-title uses the filename (e.g. `table.melker`, `bars.melker`). If a `.melker` file changes, the code block in the HTML must be updated to match. The hand-highlighted spans (`<span class="tag">`, `.attr`, `.str`, `.kw`, `.cmt`, `.num`) are applied manually.

## How to regenerate the `<pre>` output blocks

### Prerequisites

A local web server must serve `docs/` on port 8888:

```bash
cd docs && python3 -m http.server 8888
```

### Running each example

Each `.melker` app uses `"net": ["samesite"]` in its policy and constructs fetch URLs with `new URL('file.json', $melker.url)`. When loaded from `http://localhost:8888/`, `samesite` expands to `localhost:8888`. Run with `--trust --stdout --color=always` and pipe through the ANSI-to-HTML converter:

```bash
run_example() {
  ./melker.ts "http://localhost:8888/examples/dataviz/$1" \
    --trust --stdout --stdout-width=80 --stdout-height=$2 --color=always --stdout-timeout=2000 \
    2>/dev/null | ./scripts/ansi2html.ts
}

run_example table.melker 20
run_example sparkline.melker 3
run_example bars.melker 12
run_example boxplot.melker 22
run_example heatmap.melker 10
run_example tree.melker 20
run_example connected.melker 22
run_example grouped-bars.melker 12
run_example isolines.melker 18
```

### Local .melker files

`sparkline.melker`, `grouped-bars.melker`, and `isolines.melker` can also be run locally (they use inline data or no network). The other examples fetch JSON via `new URL('file.json', $melker.url)` so the web server must be running.

### ANSI-to-HTML converter

`scripts/ansi2html.ts` reads ANSI-colored output from stdin and produces HTML:

- Parses 24-bit RGB SGR sequences (`\e[38;2;R;G;Bm` foreground, `\e[48;2;R;G;Bm` background)
- Merges consecutive characters with the same style into single `<span>` elements
- Omits `background:rgb(0,0,0)` from spans (the default terminal background is set on the `<pre>` element instead)
- Trims trailing spaces per line and trailing empty lines

### HTML integration

The converted output goes inside `<pre class="terminal">` blocks. The CSS class (in `shared.css`):

```css
pre.terminal {
  background: #000;
  color: #f9fafb;
  border-color: #333;
}
```

### Key stdout flags

| Flag                | Purpose                                                 |
|---------------------|---------------------------------------------------------|
| `--trust`           | Auto-accept policy (needed for URL-loaded apps)         |
| `--stdout`          | Render one frame to stdout and exit                     |
| `--stdout-width=N`  | Terminal width for layout                               |
| `--stdout-height=N` | Terminal height for layout                              |
| `--color=always`    | Force ANSI color output (for conversion to HTML spans)  |
| `--stdout-timeout=M`| Max ms to wait for async scripts (default 5000)         |

## Gotchas

- **`$melker.render()` required in async scripts**: `async="ready"` scripts run after the initial render. In stdout mode, the frame is captured after scripts complete, but only if the script calls `$melker.render()` to push updates.
- **`createState()` must be in a sync script block**: It must run before the first render. See `connected.melker`: two `<script>` blocks, sync for `createState`, `async="ready"` for data fetching.
- **Do not trim whitespace**: Paste stdout output as-is into `<pre>` blocks. The layout depends on exact character positions. Do not use `--stdout-trim`.
- **Policy uses samesite**: All dataviz apps use `"net": ["samesite"]` which expands to the host the `.melker` file was loaded from. Fetch URLs are constructed with `new URL('file.json', $melker.url)` for portability.
- **Remote .melker files need `<policy>`**: Even if permissions are empty, remote `.melker` files (loaded via URL) require a `<policy>` tag.

## Writing style

- No em-dashes. Use periods, colons, commas, or "and" instead.
- No bragging ("comes free", "seamless", "powerful", "effortless").
- No emojis.
- State what the code does, not how impressive it is.

## HTML template

Same HTML template as `how-it-works.html`, `tutorial.html`, `policy.html`:

- `shared.css` + `shared.js`
- Nav bar with links to other pages
- Sidebar with numbered section anchors
- Hero with title, subtitle, and hero-media image
- Numbered sections, each with italic `section-claim` one-liner
- Hand-highlighted code blocks (`<span class="tag">`, `.attr`, `.str`, `.kw`, `.cmt`, `.num`)
- `<div class="callout">` for tips
- `<p class="explanation">Reference: ...` links to agent_docs at section bottoms
- `<pre class="terminal">` for colored stdout output with "View source" and "Data" links below

## Cross-cutting patterns shown

| Pattern              | Code shape                                                                 |
|----------------------|----------------------------------------------------------------------------|
| Table rows           | `table.setValue(items.map(i => [i.col1, i.col2, ...]))`                    |
| Bar values           | `bars.setValue(items.map(i => [i.value]))`                                 |
| Labels via props     | `bars.props.labels = items.map(i => i.name)`                              |
| Boxplot groups       | `boxplot.setGroups(items.map(i => ({ label: i.name, values: i.values })))` |
| Tree nodes via props | `tree.props.nodes = json.nodes; tree.expandAll()`                          |
| Heatmap via props    | `hm.props.grid = json.grid; hm.props.rowLabels = json.rowLabels`          |
| Shared selection     | `bind:selection="key"` on each component + `onGetId` + `createState`       |
| Auto-refresh         | `setInterval(refresh, interval)` in `<script async="ready">`              |
