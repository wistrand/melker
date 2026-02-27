# Plan: Slideshow Showcase App

## Core Approach

Each slide is a `.md` file in a directory. The markdown component's `src` prop handles file loading — switching slides is just `markdown.props.src = newFile`.

## Slide Discovery

```typescript
// async="ready" block
const entries = [];
for await (const e of Deno.readDir(slideDir)) {
  if (e.isFile && e.name.endsWith('.md')) entries.push(e.name);
}
slides = entries.sort(); // 01-intro.md, 02-overview.md, etc.
```

Convention: files sort naturally by name (`01-*.md`, `02-*.md`, ...) or accept a directory argument via `argv[1]`.

## Navigation

Arrow keys via `<command>` elements — no conflict since markdown doesn't handle its own keyboard:

| Key                    | Action                           |
|------------------------|----------------------------------|
| Right / Space / Enter  | Next slide                       |
| Left / Backspace       | Previous slide                   |
| Home                   | First slide                      |
| End                    | Last slide                       |
| Ctrl+G                 | Go-to dialog (combobox filter)   |
| Ctrl+F                 | Toggle fullscreen (hide chrome)  |
| Ctrl+O                 | Open file browser to pick deck   |
| Ctrl+R                 | Reload current slide             |
| Ctrl+U                 | Toggle view source               |

## Layout

```
┌─────────────────────────────────────────┐
│  Slide Title                    3 / 10  │
├─────────────────────────────────────────┤
│                                         │
│  <markdown src="slides/03.md"           │
│    style="overflow-y: scroll"           │
│    enableGfm="true"                     │
│    onLink="$app.openLink(event)" />     │
│                                         │
├─────────────────────────────────────────┤
│  nav hints      ▓▓▓▓▓●──── slider      │
└─────────────────────────────────────────┘
```

- Header: slide title (parsed from first `# heading` in the .md) + counter, `--theme-surface` background
- Body: single `<markdown>` component with scrollable overflow; `<textarea>` for source view (toggled with Ctrl+U)
- Footer: terminal dimensions display + slider (interactive, click to navigate) + nav hints, `--theme-surface` background
- Fullscreen mode (Ctrl+F) hides header/footer, gives markdown 100% height
- All colors use CSS theme variables — adapts to any theme

## Components

| Component      | Purpose                                              |
|----------------|------------------------------------------------------|
| `markdown`     | Slide content with `src` prop, GFM, images, mermaid  |
| `text`         | Header title, slide counter, footer hints             |
| `textarea`     | Read-only source view (toggled with Ctrl+U)           |
| `slider`       | Interactive slide position (click/drag to navigate)   |
| `command`      | Global keyboard shortcuts for navigation              |
| `dialog`       | Go-to-slide dialog (draggable, no backdrop)           |
| `combobox`     | Fuzzy-filtered slide picker inside go-to dialog       |
| `file-browser` | Pick slide deck directory (Ctrl+O)                    |

## AI Tools

Three custom AI tools registered via `$melker.registerAITool()`:

| Tool             | Description                                              |
|------------------|----------------------------------------------------------|
| `list_slides`    | List all slides with index, filename, current marker     |
| `go_to_slide`    | Jump by number (1-based) or filename (exact/partial)     |
| `search_slides`  | Fuzzy search slide contents (all words must match, case-insensitive), returns title + snippet |

## Slide Transitions

CSS `@keyframes` animations applied via classList toggling. Direction-aware slide-in effect:

```css
@keyframes slideInNext {
  from { left: 200; opacity: 0; }
  to   { left: 0;   opacity: 1; }
}
@keyframes slideInPrev {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.anim-next { animation: slideInNext 250ms ease-out forwards; }
.anim-prev { animation: slideInPrev 250ms ease-out forwards; }
```

On slide change:
1. Remove animation classes, render (resets animation)
2. On next tick, add direction class (`anim-next` or `anim-prev`), render — triggers fresh animation

```typescript
function transitionSlide(direction: 'next' | 'prev' | 'none'): void {
  if (direction === 'none') return;
  const el = $melker.getElementById('slideContainer');
  // Remove both animation classes to reset
  el.props.classList = el.props.classList.filter(c => c !== 'anim-next' && c !== 'anim-prev');
  $melker.render();
  // Add animation class on next tick — triggers fresh animation
  setTimeout(() => {
    el.props.classList.push(direction === 'next' ? 'anim-next' : 'anim-prev');
    $melker.render();
  }, 16);
}
```

## Permissions

Minimal — just file read (auto-granted for cwd):

```json
{ "permissions": { "read": ["cwd"], "browser": true } }
```

If slides contain remote images or other network resources, add `--allow-net=<host>` when launching:

```bash
melker examples/showcase/slideshow.melker ./slides/ --allow-net=example.com,cdn.example.com
```

## Arguments

```bash
# Open a slides directory
./melker.ts examples/showcase/slideshow.melker ./my-talk/slides/

# Open a specific .md file (loads parent dir, jumps to that slide)
./melker.ts examples/showcase/slideshow.melker ./my-talk/slides/03-layout.md
```

`argv[1]` = slide directory or `.md` file. Falls back to `./slides/` if not provided.
When a `.md` file is given, the parent directory is loaded and the slideshow jumps directly to that slide.

## Terminal Title

The slide directory basename is set as the terminal title via `$melker.setTitle()`, updated both on startup and when switching decks via Ctrl+O.

## What Markdown Already Supports (per slide)

- Headers, lists, tables (GFM)
- Code blocks with syntax context
- Images (rendered as sixel/kitty/block graphics)
- Mermaid diagrams (rendered inline as graphs)
- Embedded Melker components via ````melker` fenced blocks (e.g. `<segment-display>`, `<img>`)
- Links (clickable, `onLink` handler)

## Implementation Phases

### Phase 1: Skeleton + Single Slide

- [x] `<melker>` boilerplate: `<title>`, `<policy>`, `<help>`, `<style>`
- [x] Layout markup: header, markdown viewer, footer
- [x] Script: slide discovery from directory, state vars (slides array, currentIndex)
- [x] `async="ready"`: read directory, load first slide; `argv[1]` or default `./slides/`
- [x] Display first slide with title extracted from `# heading`
- [x] Sample slides in `examples/showcase/slides/` (8 slides: welcome, logo, components, layout, architecture/mermaid, styling, segment-display, thanks)

### Phase 2: Navigation

- [x] `<command>` elements: Right/Space/Enter=next, Left/Backspace=prev, Home, End
- [x] `nextSlide()`, `prevSlide()`, `goToSlide(n)` functions
- [x] Slide counter in header (`3 / 10`)
- [x] Slider in footer (interactive navigation)
- [x] Boundary guards (toast at first/last slide)
- [x] Go-to dialog: Ctrl+G opens combobox dialog with fuzzy slide filtering
- [x] Fullscreen toggle: Ctrl+F hides/shows header and footer

### Phase 3: Go-To + File Browser

- [x] Go-to dialog: Ctrl+G opens combobox dialog with fuzzy slide filtering (done in Phase 2)
- [x] File browser: Ctrl+O opens file-browser for directory selection
- [x] Update slide list when new directory selected, toast on success/error
- [x] Terminal title updates on deck switch

### Phase 4: Polish

- [x] Slide-in transition: `@keyframes` animation via classList toggling, direction-aware (next/prev)
- [x] Fullscreen toggle (Ctrl+F) hides header/footer (done in Phase 2)
- [x] `onLink` handler to open external links in browser (done in Phase 1)
- [x] Scroll reset on slide change (`scrollY = 0` on container)
- [x] Edge indicators (toast at first/last slide, done in Phase 2)
- [x] `.md` file argument support (load parent dir, jump to slide)
- [x] Terminal title set to directory basename
- [x] Theme-aware header/footer background (`var(--theme-surface)`)

### Phase 5: Sample Slides

- [x] Logo slide with `![](melker-128.png)` image
- [x] Architecture slide with mermaid flowchart (rendering pipeline)
- [x] Segment display slide with scrolling ````melker` block (`<segment-display>`)

### Phase 6: AI Tools

- [x] `list_slides` — list all slides with current marker
- [x] `go_to_slide` — jump by number or filename
- [x] `search_slides` — fuzzy content search across all slides

## Core Bug Fixes (Melker engine)

During development, three Melker core bugs were discovered and fixed:

1. **classList dirty tracking** (`src/engine.ts`): `_resolveBindings()` previously returned early when no state object existed, skipping stylesheet re-application entirely. Restructured to always check for classList changes via snapshot comparison (`_detectClassListChanges()`), and only re-apply stylesheets when an element's classList actually changed.

2. **Fractional buffer coordinates** (`src/buffer.ts`): Animation interpolation produces fractional `left`/`top` values. `setCell()` now floors x/y with `| 0` before bounds checking to prevent crashes from non-integer array indices.

3. **Connector null route crash** (`src/components/connector.ts`): `_findBestRoute()` could return null when element bounds contained NaN values (e.g. mermaid diagram elements not yet laid out). The non-null assertion `bestRoute!` crashed on `.points` access. Fixed by making the return type nullable and guarding the call site.

## Script Architecture

```
<script> (sync)           -- Types, state vars, helpers
  - slides: string[]        -- sorted .md filenames
  - currentIndex: number    -- active slide
  - slideDir: string        -- directory path
  - fullscreen: boolean     -- chrome visibility
  - extractTitle(content)   -- parse first # heading
  - transitionSlide(dir)    -- classList-based @keyframes animation
  - nextSlide(), prevSlide(), goToSlide(n)
  - openGoTo()              -- open combobox go-to dialog (setOptions + setValue + open)
  - selectFromIndex(event)  -- combobox selection handler
  - toggleSource()          -- toggle markdown/source view (Ctrl+U)
  - reloadSlide()           -- reload current slide (Ctrl+R)
  - updateFooterInfo()      -- update terminal dimensions display

<script async="ready">   -- Initial load
  - Parse argv[1]: directory or .md file (extract parent dir + start file)
  - Resolve relative paths
  - Set terminal title to dir basename
  - Discover .md files, sort, load start slide
```

## Reference

- Markdown viewer (`examples/showcase/markdown-viewer.melker`) — file navigation, history, link handling
- RSS reader (`examples/showcase/rss-reader.melker`) — command shortcuts, dialog, progress patterns
