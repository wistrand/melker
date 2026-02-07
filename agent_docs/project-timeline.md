# Melker Project Timeline

Development history from December 2025 to February 2026.

```
Trurl, Constructor Most Querulous, commanded the Perturbulator: "Fabricate!" Brass potentates
emerged. Algebraical improbabilities crystallized. The palefaces (soft, wet, mythical)
understood nothing—as intended. Klapaucius snorted through copper nostrils, adjusted his
cybernetical monocle. "Adequate." The cosmos hummed, indifferent. Thusly: subsequent matters.
So constructed.
```
## December 2025: Foundation

### Week 1: The First Constructor (Dec 7-14)

**Dec 7** - Initial commit

**Dec 11** - Core framework
- Dual-buffer rendering, flexbox layout, event system, theme support
- Initial components: button, canvas, checkbox, container, dialog, input, list, markdown, radio, text, textarea, video

**Dec 13** - Tabs component added

**Dec 14** - Input handling polish, tab navigation

### Week 2: How the Pixels Learned to Dance (Dec 15-21)

**Dec 15-18** - Text and dialog refinements
- Textarea scrolling, text wrapping, markdown rendering

**Dec 19** - Video playback working (#70)

**Dec 21** - Canvas improvements

### Week 3: The Bundler's Blessing (Dec 22-31)

**Dec 23** - Bundler system for .melker files

## January 2026: Rapid Development

### Week 4: The Machine That Guarded Itself (Jan 2-3)

**Jan 2** - Security and tooling
- Permission policy system (`src/policy/`)
- LSP server for editor integration
- Draggable dialogs

**Jan 3** - Tables and approval
- Table components with scrolling
- Progress bar component
- App approval system for sandboxing
- Confirm/prompt dialogs

### Week 5: The Sieve of a Thousand Options (Jan 4-7)

**Jan 4** - Documentation refresh

**Jan 5** - Image component (extends canvas with responsive sizing)

**Jan 6** - Filterable lists
- Combobox, select, autocomplete, command-palette
- Fuzzy/prefix/contains matching
- Launcher/runner architecture split
- Performance dialog (F6), system palette (Ctrl+K)

**Jan 7** - Shaders and image loading
- Canvas shader system (plasma, metaballs, synthwave demos)
- Pure-JS image decoders (PNG, JPEG, GIF)

### Week 6: The Palace of Infinite Settings (Jan 8-12)

**Jan 8-10** - Configuration and slider
- Schema-driven config system with layered overrides
- Dev Tools dialog (F12) with config tab
- Slider component, breakout game demo

**Jan 11** - File browser
- Directory navigation, file selection, keyboard shortcuts
- htop.melker demo (system monitor)
- Table render caching, dialog scroll optimization

**Jan 12** - Website launch
- melker.sh with landing page and examples gallery
- CalVer release scheme (YYYY.MM.PATCH)

### Week 7: The Cybernetic Enumeration (Jan 13-22)

**Jan 13** - Skill documentation (TROUBLESHOOTING.md, TYPES.md)

**Jan 14** - Dithering refactor
- Algorithms split into `src/video/dither/` module
- Floyd-Steinberg, Sierra, Atkinson, threshold/blue-noise
- Dev Tools log tab with in-memory buffer

**Jan 15-18** - Segment display and maps
- 7/14/16-segment LCD display component
- Map viewer with OpenStreetMap tiles
- Canvas modules split (image, shader-runner)

**Jan 19-20** - Dirty row tracking
- Buffer diff optimization (72% cell scan reduction)
- Only scan rows that actually changed

**Jan 21-22** - Data visualization and tutorial
- Data bars component (charts, sparklines)
- Tutorial page on melker.sh
- Netlify edge functions for versioned URLs
- Engine refactor (keyboard, palette, dialog modules)
- QR code example, border titles, scrollbar component

### Week 8: The Sixel Excavations (Jan 25-26)

**Jan 25-26** - Graphics protocols
- Sixel graphics (detection, encoding, palette quantization)
- Kitty graphics (detection, encoding, stable image IDs)
- Documentation reorganization

### Week 9: The Diagrammatic Engine (Jan 30-31)

**Jan 30** - Graph and Mermaid system (#250)
- Graph component with Mermaid parser (`src/components/graph/`)
- Connector component for Unicode box-drawing lines between elements
- Flowchart, sequence diagram, and class diagram support
- Stdout mode for piped/non-TTY output (`--stdout`, auto-detection)
- Markdown module refactor (split into code, image, table submodules)
- Graph architecture and Mermaid support documentation

**Jan 31** - Policy system and text styling
- Permission override system (`--allow-*`, `--deny-*` CLI flags)
- Policy architecture documentation (`policy-architecture.md`)
- Text decoration support (underline, strikethrough, overline, dim)
- Mermaid showcase example
- 825+ new policy tests

## February 2026: Continued Development

### Week 10: The Chromatic Grid (Feb 2-3)

**Feb 2** - Layout system, CSS selectors, and feedback components
- CSS combinators (descendant `a b`, child `a > b`, compound `a.b`)
- Flex-wrap support for responsive layouts
- Major layout engine improvements with 1000+ new test lines
- TUI comparison document overhaul (detailed feature matrices)
- Documentation cleanup (dx-footguns rewrite)
- `@media` queries for terminal-size-responsive stylesheets
- Spinner component (8 animation styles: dots, line, arc, bounce, etc.)
- Toast notification system (`$melker.toast.*` API)
- PlantUML implementation plan
- UI animation manager (centralized component animations)
- Capture script system for automated screenshots/videos

**Feb 3** - Data visualization and policy enhancements (#283)
- Data heatmap component (`<data-heatmap>`)
  - 8 color scales (viridis, plasma, inferno, thermal, grayscale, diverging, greens, reds)
  - Isolines (contour lines) with marching squares algorithm
  - Box-drawing characters for isoline rendering (center-aligned)
  - `showCells` prop for isolines-only display mode
  - Auto-isolines: `isolineCount` + `isolineMode` (equal, quantile, nice)
  - Value display with auto-contrast foreground colors
  - BW mode fallback with density patterns
  - Metaballs example with animated field visualization
- Policy system improvements
  - `configSchema` for app-defined config with env var overrides
  - Env vars in configSchema auto-added to subprocess permissions
  - CLI overrides display in `--show-policy` output
  - `formatOverrides()` function exported for policy display
- Stdout mode enhancements
  - `MELKER_STDOUT_TRIM` option (none, right, bottom, both)
  - Configurable output trimming for cleaner piped output

**Feb 4** - Benchmark system, tooltip system, iTerm2 graphics, and LSP improvements (#291-#294, `v2026.02.1`)
- Comprehensive benchmark framework (`benchmarks/`)
  - Benchmark harness with statistical analysis (mean, stddev, p95)
  - 15+ benchmark suites: bundler, components, core ops, graphics, layout, rendering
  - Benchmark viewer application (`benchmarks/benchmark-viewer.melker`)
  - Run-all script for batch execution
  - JSON output format with results storage
- Tooltip system (`src/tooltip/`)
  - TooltipManager singleton with delay timers (hover: 300ms, focus: 800ms)
  - TooltipRenderer using `MarkdownElement` for full markdown support
  - `tooltip="auto"` with built-in formatting for data components
  - `getValue()` fallback for non-TooltipProvider components
  - Dismiss on hover exit, blur, click, any key press, or mouse wheel
  - TooltipProvider interface for custom component tooltips
- iTerm2 graphics protocol (`src/iterm2/`)
  - Terminal detection, inline image encoding, base64 transport
  - Auto-detection with fallback support
  - iTerm2 architecture documentation
- Data component tooltip integration
  - `getTooltipContext()` and `getDefaultTooltip()` for data-table, data-bars, data-heatmap
  - Custom `onTooltip` handler support
- Data table fix
  - Fixed right border gap when no column uses `width="fill"`
- LSP improvements
  - Fixed style attribute autocompletion to preserve existing styles
  - Added proper `textEdit` ranges for style property/value completions
- Canvas/renderer refactoring
  - iTerm2 rendering path in canvas-render
  - Renderer refactor for graphics protocol abstraction

**Feb 5** - Isoline refactor, remote server UI, and code cleanup (#295-#301)
- Isoline module extraction (`src/isoline.ts`)
  - Marching squares algorithm extracted from data-heatmap into reusable module (295 lines)
  - Data-heatmap simplified (165 lines removed)
  - Isolines architecture documentation
- Remote server UI (`src/debug-ui/`)
  - Full mirror client (HTML/CSS/JS) for remote terminal viewing
  - WebSocket-based live view with input forwarding
  - Server architecture documentation
- Code cleanup and refactoring
  - Removed `clipped-buffer.ts` (unused)
  - Removed `color-utils.ts` (unused)
  - Removed unused code from checkbox, radio components
  - ANSI output module refactored (118 lines removed)
  - Debug server refactored (1315 lines removed, UI extracted)
  - Layout engine improvements (flexShrink, min/max constraints)
  - `display: none` support in layout engine
- Canvas improvements
  - High-resolution mode support in canvas-render
  - Video component `ended` event support
- Config system enhancements
  - Additional schema properties
  - Improved config layering

**Feb 6** - Split pane, media queries, engine decomposition, and remote server (#302-#312, `v2026.02.2`)
- Split pane component (`src/components/split-pane.ts`, 483 lines)
  - Resizable N-way splits with draggable dividers
  - Horizontal and vertical directions via style
  - Proportional sizing, min pane constraints
  - Keyboard navigation (arrow keys, Home/End)
  - Mouse drag with live resize
  - 3 example apps (demo, nested, responsive)
  - 595-line test suite
  - Split pane architecture documentation
- `@media` query system (`src/stylesheet.ts`, +226 lines)
  - CSS-like `@media` rules for terminal-size-responsive styles
  - Conditions: `min-width`, `max-width`, `min-height`, `max-height`, `orientation`, `min-aspect-ratio`, `max-aspect-ratio`
  - Compound conditions with `and`
  - Re-evaluated on terminal resize
  - 1260-line test suite
  - 3 example apps (media-queries, media-orientation, media-aspect-ratio)
  - Media queries architecture documentation
- Engine decomposition (engine.ts: 1145 lines removed)
  - Extracted `dialog-coordinator.ts` (131 lines)
  - Extracted `engine-buffer-overlays.ts` (133 lines)
  - Extracted `engine-mouse-handler.ts` (142 lines)
  - Extracted `graphics-overlay-manager.ts` (611 lines)
  - Extracted `terminal-size-manager.ts` (150 lines)
- Remote server overhaul
  - Renamed `debug-server` → `server` (`src/server.ts`)
  - Renamed `debug-ui` → `server-ui` (`src/server-ui/`)
  - Server CLI tests (287 lines)
  - Server architecture docs updated
- Headless mode improvements
  - Headless test suite (129 lines)
- `<text>` whitespace collapsing
  - Multi-line `<text>` content collapses whitespace (HTML `white-space: normal`)
- Documentation refresh
  - README updated, project structure updated
  - Component reference expanded (split-pane, separator)
  - Config, debugging, env, graphics, policy docs updated
  - Melker file format expanded with media queries section
  - TUI comparison updated with latest framework data
  - COMPONENTS.md and EXAMPLES.md skill docs expanded
- Benchmark harness improvements
  - Warm-up iteration support, benchmark viewer overhaul

**Feb 7** - Dependency cleanup, style property refactoring, benchmark hygiene (#313-#316, `v2026.02.3`)
- Dependency centralization (`src/deps.ts`)
  - Centralized scattered `jsr:@std/encoding`, `jsr:@std/path`, URL imports into deps.ts
  - Migrated `djwt` from `deno.land/x` to `jsr:@zaubrik/djwt@3.0.2`
  - Separated LSP dependencies (not loaded for normal usage)
- deno.json cleanup
  - Removed unused JSR publishing fields (`name`, `version`, `exports`)
  - Fixed `engines.deno` to `>=2.5.0`
  - Fixed test task permissions
- Style property refactoring
  - Moved `slider.orientation` from props to style (supports `@media` queries)
  - Moved `img/canvas.objectFit` from props to style (`object-fit`)
  - Added `objectFit` to Style interface
  - Added styles sections to slider, img, canvas component schemas
  - Updated all examples and documentation
- Benchmark results hygiene
  - Kept single `baseline.json`, gitignored timestamped results
  - Benchmark docs updated
- Netlify lockfile isolation
  - Added `docs/deno.json` to prevent Netlify CLI polluting root `deno.lock`

---

## Components

| Component        | Added  | Description                            |
|------------------|--------|----------------------------------------|
| Core set         | Dec 11 | button, text, input, textarea, etc.    |
| tabs             | Dec 13 | Tabbed panels                          |
| table            | Jan 3  | Data tables with scrolling             |
| progress         | Jan 3  | Progress bar (canvas-based)            |
| img              | Jan 5  | Image display                          |
| combobox         | Jan 6  | Filterable dropdown                    |
| select           | Jan 6  | Dropdown picker                        |
| autocomplete     | Jan 6  | Async search dropdown                  |
| command-palette  | Jan 6  | Modal command picker                   |
| slider           | Jan 10 | Range input                            |
| file-browser     | Jan 11 | Directory/file picker                  |
| segment-display  | Jan 16 | LCD-style displays                     |
| data-bars        | Jan 21 | Bar charts and sparklines              |
| graph            | Jan 30 | Mermaid diagrams (flowchart, sequence, class) |
| connector        | Jan 30 | Box-drawing lines between elements     |
| spinner          | Feb 2  | Animated loading indicators            |
| toast            | Feb 2  | Non-modal notifications (API-based)    |
| data-heatmap     | Feb 3  | 2D heatmaps with color scales, isolines, auto-isolines |
| tooltip          | Feb 4  | Contextual hover/focus overlays with markdown |
| split-pane       | Feb 6  | Resizable N-way split panels with dividers    |

## Architecture

| Date   | Change                                              |
|--------|-----------------------------------------------------|
| Dec 11 | Monolithic `src/` structure                         |
| Dec 23 | Bundler system (`src/bundler/`)                     |
| Jan 2  | Policy system (`src/policy/`)                       |
| Jan 6  | Launcher/runner split, filterable-list family       |
| Jan 7  | Canvas subsystem (shader, draw, terminal)           |
| Jan 10 | Config system (`src/config/`)                       |
| Jan 11 | File browser family (`src/components/file-browser/`) |
| Jan 12 | Website (`docs/`, melker.sh)                        |
| Jan 14 | Dithering module (`src/video/dither/`)              |
| Jan 16 | Segment display (`src/components/segment-display/`) |
| Jan 22 | Engine split, canvas render modules                 |
| Jan 25 | Sixel (`src/sixel/`), Kitty (`src/kitty/`)          |
| Jan 30 | Graph system (`src/components/graph/`), stdout mode |
| Jan 30 | Markdown split (code, image, table submodules)      |
| Jan 31 | Permission overrides, policy architecture docs      |
| Feb 2  | CSS combinators, flex-wrap, layout tests            |
| Feb 2  | Toast system (`src/toast/`)                         |
| Feb 2  | UI animation manager (`src/ui-animation-manager.ts`) |
| Feb 2  | Capture script system (`scripts/capture.ts`)        |
| Feb 3  | Data heatmap with isolines, stdout trim options     |
| Feb 3  | Policy configSchema, env var auto-permissions       |
| Feb 4  | Benchmark framework (`benchmarks/`)                 |
| Feb 4  | Tooltip system (`src/tooltip/`)                     |
| Feb 4  | LSP style completion textEdit fixes                 |
| Feb 4  | iTerm2 graphics protocol (`src/iterm2/`)            |
| Feb 5  | Isoline module extraction (`src/isoline.ts`)        |
| Feb 5  | Remote server UI (`src/debug-ui/`)                  |
| Feb 5  | Removed clipped-buffer, color-utils (dead code)     |
| Feb 6  | Split pane component (`src/components/split-pane.ts`) |
| Feb 6  | `@media` queries (`src/stylesheet.ts`)              |
| Feb 6  | Engine decomposition (5 modules extracted)           |
| Feb 6  | Server rename (`debug-server` → `server`)           |
| Feb 7  | Dependency centralization (`src/deps.ts`)           |
| Feb 7  | Style props: slider orientation, img objectFit      |

## Milestones

| #     | Date   | What                                     |
|-------|--------|------------------------------------------|
| 10    | Dec 12 | Basic rendering                          |
| 40    | Dec 15 | Interactive components                   |
| 70    | Dec 19 | Video playback                           |
| 90    | Jan 2  | Policy and security                      |
| 110   | Jan 6  | Filterable lists, command palette        |
| 120   | Jan 7  | Shaders, image loading                   |
| 147   | Jan 11 | File browser, htop demo                  |
| 159   | Jan 12 | Website launch                           |
| 200   | Jan 18 | Segment display, map viewer              |
| 226   | Jan 20 | Dirty row tracking                       |
| 239   | Jan 22 | Data bars, tutorial                      |
| 242   | Jan 26 | Sixel and Kitty graphics                 |
| 250   | Jan 30 | Graph/Mermaid, connector, stdout mode    |
| 262   | Jan 31 | Permission overrides, text decoration    |
| 270   | Feb 2  | CSS combinators, flex-wrap               |
| 274   | Feb 2  | Spinner, toast notifications             |
| 276   | Feb 2  | UI animation manager                     |
| 278   | Feb 2  | Capture script, toast enhancements       |
| 283   | Feb 3  | Data heatmap, policy configSchema        |
| 288   | Feb 4  | Benchmark framework, viewer              |
| 289   | Feb 4  | Tooltip system, data component tooltips  |
| 290   | Feb 4  | LSP style completion fixes               |
| 294   | Feb 4  | iTerm2 graphics, canvas refactor         |
| 301   | Feb 5  | Isoline module, server UI, cleanup       |
| 312   | Feb 6  | Split pane, media queries, engine split  |
| 316   | Feb 7  | Dep cleanup, style refactoring           |

## Releases

CalVer format: `YYYY.MM.PATCH`. Releases are git tags only.

| Tag          | Date   | Commit | Highlights                                           |
|--------------|--------|--------|------------------------------------------------------|
| `v2026.01.1` | Jan 12 | #159   | Website launch, first public release                 |
| `v2026.01.4` | Jan 14 | #173   | Dithering refactor, dev tools log tab                |
| `v2026.01.5` | Jan 22 | #236   | Data bars, tutorial, dirty row tracking              |
| `v2026.01.6` | Jan 31 | #263   | Graph/Mermaid, permission overrides, text decoration |
| `v2026.02.1` | Feb 5  | #294   | Benchmarks, tooltips, iTerm2, data heatmap           |
| `v2026.02.2` | Feb 6  | #312   | Split pane, media queries, engine decomposition      |
| `v2026.02.3` | Feb 7  | #316   | Dependency cleanup, style property refactoring       |
