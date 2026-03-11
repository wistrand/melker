<!-- Generated: docs/limits.html -->
# Plan: Limits & Compatibility Doc Page

## Context

`docs/limits.html` is unlike the other doc pages. Instead of showcasing features, it shows where the engine stops working well, what degrades, and how to debug it. The thesis: every tool has edges, and showing yours builds trust faster than hiding them.

Sources: `agent_docs/gfx-modes.md` (terminal support), `agent_docs/dx-footguns.md` (common mistakes), `agent_docs/tui-comparison.md` (ecosystem context), `agent_docs/sandbox-terminal-detection.md` (detection issues), `agent_docs/debugging.md` (debug flags), `agent_docs/policy-architecture.md` (permission failures).

Follows the same HTML structure and `shared.css` as the other doc pages. The degraded rendering section includes sextant output, so this page needs the Cascadia Code `text=` font parameter (see graphics-pipeline-page-plan.md).

## Page Structure

| #  | Section                   | Topic                                                                  | Example file                              |
|----|---------------------------|------------------------------------------------------------------------|-------------------------------------------|
| 1  | When Melker is wrong      | Cases where another tool is the better choice, with specific alternatives | (prose + table)                          |
| 2  | What Melker doesn't have  | Feature gaps compared to other TUI frameworks                           | (table)                                  |
| 3  | Terminal compatibility     | Matrix of terminals, graphics modes, color depth, protocol support     | (tables)                                 |
| 4  | Degraded rendering        | Same app rendered under sextant, quadrant, halfblock, and block mode   | `docs/examples/limits/degraded.melker`   |
| 5  | Debugging layout          | Props vs style, zero-size buffers, flex stretch, scrolling, emojis     | (code snippets, before/after)            |
| 6  | Debugging state           | No reactive bindings, exported value copies, two-way binding traps    | (code snippets, before/after)            |
| 7  | Debugging permissions     | Silent failures from missing policy entries                            | (policy snippets)                        |
| 8  | Debugging terminal        | Sextant boxes, sixel fallback, sandbox detection, color overrides     | (terminal output, commands)              |
| 9  | Under the hood            | Earthquake dashboard postmortem: what was easy, awkward, engine-level  | (prose, links to how-it-works)           |

## Files

| File                                      | Purpose                                               |
|-------------------------------------------|-------------------------------------------------------|
| `docs/limits.html`                        | The doc page (add `<!-- Plan: agent_docs/limits-page-plan.md -->` after `<!DOCTYPE html>`) |
| `docs/examples/limits/degraded.melker`    | Small app with image, chart, and box-drawing border   |

## Hero Section

```
Limits & Compatibility

Every tool has edges. This page shows where Melker's are,
what degrades gracefully, what breaks, and how to diagnose it.
```

## Section Details

### 1. When Melker is wrong

Not a disclaimer wall. Short, specific scenarios with what to use instead. Where another TUI framework is a better fit, name it. Where the terminal itself is the wrong medium, say so.

| Scenario                                    | Why Melker is wrong                                    | Use instead                           |
|---------------------------------------------|--------------------------------------------------------|---------------------------------------|
| Pixel-perfect design with brand guidelines  | Terminal cells are coarse; colors are theme-dependent   | Web app                               |
| Long-running daemon or background service   | Melker owns the terminal; no detach/re-attach           | systemd + plain CLI                   |
| Heavy form input (file upload, drag-drop)   | No native file picker, no drag-drop                     | Web app or native GUI                 |
| Team has no terminal culture                | Onboarding cost is real; don't force it                 | Whatever they use now                 |
| App needs to run on Windows cmd.exe         | Relies on ANSI escape codes and Unix TTY               | PowerShell or web app                 |
| Sub-millisecond rendering (games, video)    | 30 fps ceiling, character-grid resolution               | Native GPU app                        |
| Go team, Elm architecture preferred         | Melker is TypeScript (Deno or Node.js)                  | Bubble Tea                            |
| Python team, CSS styling wanted             | Different ecosystem                                     | Textual                               |
| Rust, no_std, or embedded target            | JS runtime too heavy                                    | Ratatui                               |
| Need React ecosystem and component library  | Melker has its own component model, not React           | Ink or OpenTUI                        |
| Must ship a single static binary            | No `deno compile` support. Node.js requires runtime install | Bubble Tea, Ratatui, FTXUI       |
| Need maximum GitHub ecosystem maturity      | Melker is new; Bubble Tea has 40k stars                 | Bubble Tea, Ink, Textual              |

End with: "If your use case isn't in this list, Melker is probably fine. The rest of this page is about what happens at the edges."

Note after the table: "For a detailed feature-by-feature comparison with other TUI frameworks, see the [TUI Comparison](reference/agent_docs/tui-comparison.md)."

### 2. What Melker doesn't have

Feature gaps visible in the tui-comparison component matrix. State them plainly with context on whether they matter.

| Missing feature         | Impact                                            | Workaround                                         |
|-------------------------|---------------------------------------------------|----------------------------------------------------|
| Grid layout             | Flexbox only; no CSS Grid                         | Nested row/column containers                       |
| Collapsible sections    | No built-in accordion/collapsible                  | Toggle visibility with `display: none`             |
| Syntax highlighting     | Code blocks in markdown are plain text             | Use a `<canvas>` with custom rendering             |
| Single binary dist      | Can't `deno compile` yet                           | Distribute as `.melker` file, user installs Deno   |
| RTL text                | No right-to-left text layout support               | Manual text direction in app code                  |
| Dependency graph        | No fine-grained reactivity (Solid signals, React hooks) | `createState()` + `bind` for most cases; explicit `setValue()` for the rest |

Note: "These are design choices, not bugs. Melker trades fine-grained reactivity for a simpler model (`createState` + `bind` handles most cases without a dependency graph), and trades grid layout for a smaller layout engine. If any of these are dealbreakers, the table in Section 1 points to frameworks that have them."

### 3. Terminal compatibility

Front-stage the data from `agent_docs/gfx-modes.md` and `agent_docs/tui-comparison.md`. Three tables.

**Table A: Graphics mode support**

| Terminal         | sextant | quadrant | halfblock | sixel | kitty | iterm2 | Notes                          |
|------------------|---------|----------|-----------|-------|-------|--------|--------------------------------|
| Ghostty          | yes     | yes      | yes       | no    | yes   | no     |                                |
| Kitty            | yes     | yes      | yes       | no    | yes   | no     |                                |
| iTerm2           | yes     | yes      | yes       | yes   | no    | yes    |                                |
| WezTerm          | yes     | yes      | yes       | yes   | yes   | yes    |                                |
| Alacritty        | yes     | yes      | yes       | no    | no    | no     |                                |
| foot             | yes     | yes      | yes       | yes   | no    | no     |                                |
| xterm            | yes     | yes      | yes       | yes   | no    | no     |                                |
| Konsole          | yes     | yes      | yes       | yes   | yes   | yes    | Sixel right-edge quirk         |
| Windows Terminal | yes     | yes      | yes       | no    | no    | no     |                                |
| VS Code terminal | yes     | yes      | yes       | yes   | no    | no     |                                |
| Rio              | no      | yes      | yes       | no    | no    | yes    | Use `MELKER_GFX_MODE=iterm2`   |
| TERM=linux       | no      | no       | yes       | no    | no    | no     | Console, no Unicode 13         |
| tmux/screen      | yes     | yes      | yes       | no    | no    | no     | Protocols auto-disabled        |
| SSH              | yes     | yes      | yes       | no    | no    | no     | Protocols auto-disabled        |

**Table B: Color depth**

| Terminal         | Truecolor | 256-color | 16-color  | Detection method          |
|------------------|-----------|-----------|-----------|---------------------------|
| Most modern      | yes       | yes       | yes       | `COLORTERM=truecolor`     |
| TERM=linux       | no        | no        | yes       | `TERM` value              |
| Claude sandbox   | no        | no        | grayscale | `IS_SANDBOX=yes`          |

**Table C: Mode resolution comparison**

| Mode      | Pixels/cell | Resolution (80x24) | Unicode | Font support     |
|-----------|-------------|---------------------|---------|------------------|
| sextant   | 2x3         | 160x72              | 13.0    | Most modern mono |
| quadrant  | 2x2         | 160x48              | 1.0     | Near-universal   |
| halfblock | 1x2         | 80x48               | 1.0     | Near-universal   |
| block     | 1x1         | 80x24               | N/A     | Universal        |
| pattern   | 2x3         | 160x72              | N/A     | Universal (ASCII)|
| sixel     | native      | native              | N/A     | Terminal-specific|
| kitty     | native      | native              | N/A     | Kitty, Ghostty   |
| iterm2    | native      | native              | N/A     | iTerm2, WezTerm  |

### 4. Degraded rendering

Two comparison grids showing graphics mode degradation and color depth degradation.

**degraded.melker**

A compact app with:
- An `<img>` of `melker-128.png` at 16x10, `object-fit: contain`
- A bordered `<container>` with a title and a few text lines
- Simple enough that the degradation is visible but not overwhelming

**Graphics mode grid (2x2):** sextant, quadrant, halfblock, block. All truecolor.

```bash
run_degraded() {
  ./melker.ts --trust --stdout --stdout-width=50 --stdout-height=14 \
    --gfx-mode=$1 --color=always --stdout-timeout=2000 \
    docs/examples/limits/degraded.melker \
    2>/dev/null | deno run scripts/ansi2html.ts
}

run_degraded sextant   > /tmp/degraded-sextant.html
run_degraded quadrant  > /tmp/degraded-quadrant.html
run_degraded halfblock > /tmp/degraded-halfblock.html
run_degraded block     > /tmp/degraded-block.html
```

**Color depth grid (1x3):** truecolor, 256-color, 16-color. All sextant mode. Override TERM/COLORTERM to force color depth:

```bash
# truecolor: reuse degraded-sextant.html from above
TERM=xterm-256color COLORTERM= run_degraded sextant > /tmp/degraded-256color.html
TERM=linux COLORTERM= run_degraded sextant > /tmp/degraded-16color.html
```

The color depth grid drives home the postmortem insight: color resolution matters more than spatial resolution. The 256-color version uses dithering. The 16-color version uses shade characters.

### 5. Debugging layout

Five mini-narratives. Each: symptom, cause, fix. Sourced from `agent_docs/dx-footguns.md` sections 5, 6, 9, 10, 14.

**5a. "My component is 0x0"**

Symptom: nothing visible, no error.

Cause: `<img>` or `<canvas>` without `width`/`height` props (not style). The buffer has no size. This is the most common footgun. Props define the pixel buffer; style defines layout positioning. They are separate concepts.

Wrong:
```html
<img src="photo.png" style="width: fill; height: fill" />
```

Right:
```html
<img src="photo.png" width="fill" height="fill" />
```

Note: Melker logs a runtime warning for this. The `--lint` flag also catches it.

**5b. "Text is clipped"**

Symptom: text cuts off at container edge.

Cause: parent container has no `overflow: scroll` and content exceeds fixed height. Scrollable containers also need a size constraint (`flex: 1` or fixed height), otherwise they grow to fit content and never scroll.

Wrong:
```html
<container style="overflow: scroll">
  <text>Long content...</text>
</container>
```

Right:
```html
<container style="overflow: scroll; flex: 1; width: fill">
  <text style="text-wrap: wrap; width: fill">Long content...</text>
</container>
```

**5c. "Select stretches to full width"**

Symptom: `<select>` or `<combobox>` fills the entire row.

Cause: default cross-axis stretch in column flex layout. This is standard flexbox behavior: in a column container, `align-items` defaults to `stretch`.

Fix: wrap in a row container or add `style="align-items: flex-start"` to the parent.

**5d. "Emojis break my layout"**

Symptom: columns misaligned, text wraps at wrong position.

Cause: emojis have inconsistent widths across terminals. Melker calculates emoji width as 2 characters, but some terminals render them wider or narrower.

Fix: use ASCII text instead. `[OK] Success` instead of emoji checkmark.

**5e. Quick reference: props vs style by component**

Include the quick reference table from dx-footguns.md section 6:

| Component | Fixed size               | Responsive/fill                    |
|-----------|--------------------------|------------------------------------|
| canvas    | `width={30} height={20}` | N/A (buffer must be fixed)         |
| img       | `width={30} height={20}` | `width="fill"` or `width="100%"`   |
| container | `style="width: 30;"`     | `style="width: fill;"`             |
| text      | `style="width: 40;"`     | `style="width: fill;"`             |
| select    | `width={20}`             | `width="50%"` or `width="fill"`    |

### 6. Debugging state

Three narratives covering the state management footguns from `agent_docs/dx-footguns.md` sections 4, 12, 15.

**6a. "How state binding works (and where it stops)"**

Melker has an optional state binding system via `$melker.createState()`. Bind an element to a state key with `bind="key"`, and state values push to elements automatically on every render. Two-way binding (the default) also syncs user input back to state without manual handler code:

```html
<input id="query" bind="searchTerm" />
<text bind="count" bind-mode="one-way" />

<script>
  const state = $melker.createState({ searchTerm: '', count: 0 });
  // state.searchTerm auto-updates as the user types (two-way)
  // state.count pushes to the text element (one-way)
</script>
```

Boolean state keys also toggle CSS classes on the root element, so conditional styling works without script:

```css
.isEmpty #empty-message { display: flex; }
```

What it doesn't have: no dependency graph, no computed properties, no fine-grained reactivity (Solid signals, React hooks). If element A's value depends on a computation involving state keys X and Y, you write that computation in a handler. For most apps (5-15 interactive elements), `createState()` + `bind` eliminates the boilerplate. For apps that don't need it, the system has zero cost (early-exit guard).

For the full API, see [state-binding-architecture.md](state-binding-architecture.md).

**6b. "I set $app.count but nothing changed"**

Symptom: `$app.count = 10` in a ready script, but the original variable stays at 0.

Cause: exported primitive variables are copied by value onto `$app`. Setting `$app.count` modifies the copy, not the module binding.

Fix: use setter functions.

```html
<script>
  export let count = 0;
  export function setCount(n) { count = n; }
</script>

<script async="ready">
  $app.setCount(10);  // modifies the original
</script>
```

Note: objects are copied by reference, so `$app.config.debug = true` does modify the original. Only primitives (numbers, strings, booleans) have this problem.

**6c. "Two-way binding loses my transformation"**

Symptom: handler normalizes input (e.g., `trim().toLowerCase()`), but the value reverts on next render.

Cause: two-way binding is the default. Before each render, reverse sync reads the raw input value back into state, overwriting the handler's normalized result.

Fix: use `bind-mode="one-way"` and read from the element directly.

```html
<input bind="query" bind-mode="one-way" onInput="$app.normalize()" />
<script>
  const state = $melker.createState({ query: '' });
  export function normalize() {
    state.query = $melker.getElementById('query').getValue().trim().toLowerCase();
  }
</script>
```

Rule of thumb: if your handler modifies the same state key that the element is bound to, use `bind-mode="one-way"`.

### 7. Debugging permissions

Two narratives.

**7a. "Fetch silently fails"**

Symptom: `$melker.fetch()` returns an error or hangs. No obvious message.

Cause: policy missing `"net"` permission for the host.

Diagnosis: run with `--log-level DEBUG --log-file /tmp/app.log`, look for `Access denied`.

Fix:
```html
<policy>{"permissions": {"net": ["api.example.com"]}}</policy>
```

Or use `--trust` for quick testing (bypasses all policy checks).

**7b. "Environment variable is undefined"**

Symptom: `$ENV{MY_VAR}` is empty, or `Deno.env.get('MY_VAR')` returns undefined.

Cause: env vars are sandboxed. Only `MELKER_*`, `HOME`, `PATH`, `TERM`, and XDG vars are auto-allowed.

Fix: add to policy `"env": ["MY_VAR"]` or use configSchema's env key for user-configurable values.

### 8. Debugging terminal

Three narratives.

**8a. "Sextant characters show as boxes"**

Symptom: rectangles or tofu instead of smooth 2x3 block patterns.

Cause: terminal font lacks Unicode 13.0 Symbols for Legacy Computing (U+1FB00-U+1FB3F).

Diagnosis:
```bash
melker --test-sextant
```

Fix: switch to a font with sextant support (Cascadia Code, Iosevka, JetBrains Mono), or override:
```bash
MELKER_GFX_MODE=quadrant melker app.melker
```

**8b. "Sixel images don't appear"**

Symptom: blank area where image should be.

Cause: running inside tmux/screen (protocol auto-disabled), or terminal doesn't support sixel.

Diagnosis: check `--log-level DEBUG` for `sixel disabled` messages.

Fix: run outside multiplexer, or use character-based modes instead.

**8c. "Colors look wrong in Claude Code sandbox"**

Symptom: everything is grayscale, backgrounds invisible.

Cause: sandbox terminal reports `TERM=linux` but only renders brightness, not hue. Background colors are ignored.

What the engine does: detects `IS_SANDBOX=yes` and switches to grayscale-compatible rendering.

### 9. Under the hood: earthquake dashboard

Postmortem-style narrative based on the actual git history of `examples/showcase/earthquake-dashboard.melker` (commits 344-486, Feb 12 - Mar 7 2026). Not a feature showcase. An honest accounting of what happened during development.

This section asks the reader real questions. We provide the commit-level facts, then let the author (user) fill in the editorial voice about what was easy, awkward, and engine-level. The following is the raw material from the commit history:

**Commit 344 (Feb 12): Initial creation**
- 431-line single-file app created in one commit
- Data table, magnitude sparkline, feed selector, magnitude/depth distribution bars
- World map drawn on `<canvas>` with a hardcoded COASTLINES array (~35 lines of polyline coordinates for continents)
- Policy: just `"net": ["earthquake.usgs.gov"]`

**Commit 346 (Feb 13): Canvas map and tooltips**
- Added canvas-drawn world map with earthquake dots colored by magnitude
- Added lat/lon tracking, selected quake highlighting on map
- Required engine work in the same commit: new `canvas-draw.ts` (151 lines for fillPolyColor, drawCircleCorrected), tooltip system, canvas hit-test

**Commit 348 (Feb 13): Polish**
- Switched timestamps to UTC (ISO 8601)
- Added M7+ toast alerts using `$melker.toast.show()`
- Fixed bar label alignment with `.padEnd(7)`

**Commit 389 (Feb 19): Command element**
- Added `<command key="r">` for refresh keybinding
- This required building the entire `<command>` element in the engine (167-line architecture doc, new `command.ts`, keyboard handler changes)

**Commit 476 (Mar 6): Tile map migration**
- Replaced hand-drawn canvas map with new `<tile-map>` component
- Deleted hardcoded COASTLINES polyline array
- Added tectonic plate boundaries from GitHub GeoJSON, converted to svgOverlay paths
- Policy grew: added `"map": true` and `"raw.githubusercontent.com"` to net permissions
- Required building the entire tile-map component in the engine (365-line architecture doc)

**Commit 477 (Mar 6): Cache API**
- Added `$melker.cache.read/write` to cache processed plate boundary SVG
- Required building the cache API in the engine

**Commit 483 (Mar 6): Coordinate bug**
- SVG path coordinates were swapped (lat/lon instead of lon/lat)
- Bumped cache version to invalidate stale cached data

**Commit 486 (Mar 7): State binding and map styling**
- Added `bind:selection="selectedQuake"` and `createState()` for cross-component selection sync (table row highlights quake on map)
- Switched map provider from `satellite` to `voyager-nolabels`
- Added CSS tile-key-color for water/land coloring
- Added `mapClick` handler

---

**What was easy:**
- Layout: the initial 431-line dashboard was a single session. Getting the flex layout correct (split panes, table + sparkline + distribution bars) was surprisingly straightforward.
- Data binding: `data-table.setValue()` with fetched JSON, one line per component.
- Policy: declaring `net: ["earthquake.usgs.gov"]` and getting sandboxed fetch for free.
- Incremental polish: UTC timestamps, toast alerts for M7+ quakes, bar label alignment. Small targeted commits.

**What was awkward:**
- The hand-drawn canvas map. It was intended as a quick "get something on screen" approach, but the hardcoded COASTLINES polyline array bloated the `.melker` file and took more time than expected. This directly drove the creation of the `<tile-map>` component (commit 476), which replaced ~35 lines of coordinate data with a single element.
- The canvas map also required building engine primitives that didn't exist yet: `fillPolyColor`, `drawCircleCorrected`, the tooltip system, and canvas hit-testing. The dashboard was driving engine development, not using existing features.
- The coordinate swap bug (commit 483): the SVG path coordinates for tectonic plate boundaries were in lat/lon order instead of lon/lat. Discovered because the AI assistant (via an OpenRouter model) insisted on the coordinate order it was trained on, not what was specified. A reminder that AI-assisted code still needs visual verification.
- The cache API (commit 477): tectonic plate boundaries were the third feature that needed caching. One too many for a framework without a cache primitive. This pushed the creation of `$melker.cache.read/write` in the engine.
- Permissions grew over time: started with just `"net": ["earthquake.usgs.gov"]`, then needed `"map": true` and `"raw.githubusercontent.com"` for tile maps and plate data. Each new data source is a policy change discovered at runtime.

**What surprised:**
- Color resolution matters more than spatial resolution. The dashboard looks good in truecolor terminals, but under `TERM=linux` (16 colors) the map and magnitude coloring lose most of their information density. This is the constraint that catches people off guard: you think the limit is character-grid resolution, but it's actually color depth.

## Generating Terminal Output

```bash
run_degraded() {
  ./melker.ts --trust --stdout --stdout-width=50 --stdout-height=14 \
    --gfx-mode=$1 --color=always --stdout-timeout=2000 \
    docs/examples/limits/degraded.melker \
    2>/dev/null | deno run scripts/ansi2html.ts
}

# Graphics mode grid
run_degraded sextant   > /tmp/degraded-sextant.html
run_degraded quadrant  > /tmp/degraded-quadrant.html
run_degraded halfblock > /tmp/degraded-halfblock.html
run_degraded block     > /tmp/degraded-block.html

# Color depth grid (override TERM/COLORTERM)
# truecolor: reuse degraded-sextant.html
TERM=xterm-256color COLORTERM= run_degraded sextant > /tmp/degraded-256color.html
TERM=linux COLORTERM= run_degraded sextant > /tmp/degraded-16color.html
```

## Nav Dropdown Update

Add to all doc pages' dropdown menus, after "Graphics Pipeline":

```html
<a href="/limits.html">Limits & Compatibility</a>
```

## Font for Terminal Blocks

The degraded rendering section includes sextant output, so this page needs the Cascadia Code `text=` font parameter (see graphics-pipeline-page-plan.md for the full font link).

## Writing Style

- No em-dashes. Use periods, colons, commas, or "and" instead.
- No bragging language ("powerful", "seamless", "beautiful", etc.).
- Keep descriptions factual and concise.
- This page specifically: be honest, not apologetic. State limits plainly. Don't hedge with "currently" or "in a future release." If something doesn't work, say so.
- Debugging narratives: use second person ("your component is 0x0") and show the exact symptom before the fix.
- When naming other frameworks as alternatives, link to them. Don't disparage them or position Melker as superior. The point is helping the reader pick the right tool.
