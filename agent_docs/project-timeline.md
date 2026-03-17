# Melker Engine Project Timeline

Development history from December 2025 to present (March 2026).

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

**Dec 11** - Core framework: dual-buffer rendering, flexbox layout, event system, theme support. Initial components: button, canvas, checkbox, container, dialog, input, list, markdown, radio, text, textarea, video

**Dec 13-14** - Tabs component, input handling polish, tab navigation

### Week 2: How the Pixels Learned to Dance (Dec 15-21)

**Dec 15-18** - Text and dialog refinements: textarea scrolling, text wrapping, markdown rendering

**Dec 19** - Video playback working

**Dec 21** - Canvas improvements

### Week 3: The Bundler's Blessing (Dec 22-31)

**Dec 23** - Bundler system for `.melker` files

## January 2026: Rapid Development

### Week 4: The Machine That Guarded Itself (Jan 2-3)

**Jan 2** - Permission policy system, LSP server, draggable dialogs

**Jan 3** - Table and progress components, app approval system, confirm/prompt dialogs

### Week 5: The Sieve of a Thousand Options (Jan 4-7)

**Jan 5** - Image component (extends canvas with responsive sizing)

**Jan 6** - Filterable lists (combobox, select, autocomplete, command-palette), launcher/runner architecture split, performance dialog (F6), system palette (Ctrl+K)

**Jan 7** - Canvas shader system, pure-JS image decoders (PNG, JPEG, GIF). WebP support added later via WASM (@jsquash/webp)

### Week 6: The Palace of Infinite Settings (Jan 8-12)

**Jan 8-10** - Schema-driven config system, Dev Tools dialog (F12), slider component

**Jan 11** - File browser component, htop demo

**Jan 12** - Website launch (melker.sh), CalVer release scheme ← `v2026.01.1`

### Week 7: The Cybernetic Enumeration (Jan 13-22)

**Jan 14** - Dithering refactor (`src/video/dither/`), Dev Tools log tab ← `v2026.01.4`

**Jan 15-18** - Segment display component, map viewer with OpenStreetMap tiles

**Jan 19-20** - Dirty row tracking (72% cell scan reduction)

**Jan 21-22** - Data bars component, tutorial page, engine refactor, QR code example, border titles, scrollbar ← `v2026.01.5`

### Week 8: The Sixel Excavations (Jan 25-26)

**Jan 25-26** - Sixel and Kitty graphics protocols (detection, encoding, palette quantization)

### Week 9: The Diagrammatic Engine (Jan 30-31)

**Jan 30** - Graph component with Mermaid parser (flowchart, sequence, class diagrams), connector component, stdout mode for piped output

**Jan 31** - Permission override system (`--allow-*`/`--deny-*`), text decoration support, 825+ policy tests ← `v2026.01.6`

## February 2026: Continued Development

### Week 10: The Chromatic Grid (Feb 2-7)

**Feb 2** - CSS combinators and `@media` queries, flex-wrap, spinner component, toast notifications, UI animation manager, capture script

**Feb 3** - Data heatmap with isolines (marching squares), policy `configSchema`, stdout trim options

**Feb 4** - Benchmark framework, tooltip system, iTerm2 graphics protocol, data component tooltips

**Feb 5** - Isoline module extraction, remote server UI, code cleanup (removed dead code, ANSI refactor) ← `v2026.02.1`

**Feb 6** - Split pane component, `@media` query system, engine decomposition (5 modules extracted), server rename ← `v2026.02.2`

**Feb 7** - Dependency centralization (`src/deps.ts`), style property refactoring (slider orientation, objectFit to style) ← `v2026.02.3`

### Week 11: The Specificity Cascade (Feb 10-13)

**Feb 10-11** - CSS animations (`@keyframes`, easing, interpolation), CSS specificity system, `@container` queries, `position: relative`, data-tree component ← `v2026.02.4`

**Feb 12-13** - Canvas polygon drawing, canvas tooltips, unified CSS parser, dialog base class, error-diffusion dithering engine, code deduplication (~879 lines removed) ← `v2026.02.5`

### Week 12: The Variable Alchemist (Feb 14-16)

**Feb 14** - CSS custom properties (`var()` with fallbacks), CSS pseudo-classes (`:focus`, `:hover`), transitions, CSS nesting, LSP overhaul (completions, diagnostics, hover)

**Feb 15** - CSS theme files (`:root` custom properties), `--theme-*` auto-population, theme colors example, error overlay refinements

**Feb 16** - Shell completions (Bash/Zsh), WebP image support, animated GIF playback

**Feb 17** - Geometric focus navigation, command palette component discovery + draggable title bar, palette shortcuts

### Week 13: The JSR Expedition (Feb 18-22)

**Feb 18-20** - JSR distribution, embedded assets, showcase examples, memory benchmarks ← `v2026.02.6`

**Feb 21-22** - JSR publishing pipeline, `melker upgrade`, global accessor pattern ← `v2026.02.7`

### Week 14: The Opacity Gradient (Feb 24-27)

**Feb 24-26** - CSS opacity, state binding (`createState`), SVG path drawing on canvas, quadrant render mode ← `v2026.02.8`

**Feb 27** - AI accessibility fixes, bundler error handling, docs refresh ← `v2026.02.9`

## March 2026: Node.js and Distribution

### Week 15: The Node Crossing (Feb 28 - Mar 3)

**Feb 28 - Mar 3** - Node.js 25+ support, runtime abstraction layer, npm publishing, two-way state binding ← `v2026.03.1`

### Week 16: Polish (Mar 3-5)

**Mar 3-4** - Package rename to `@melker/melker`, Node sandbox caveat, UDP video streams, ffmpeg config flags, "Melker Engine" branding

**Mar 4** - Data boxplot tooltips, data-table keyboard refinements, electricity dashboard showcase

**Mar 5** - Data-table/tree scrollbar fixes, split-pane min-size enforcement

### Week 17: The Cartographer's Audit (Mar 6)

**Mar 6** - Tile map component (SVG overlays, disk cache, providers), bind-selection architecture, selection-id system, data component `bind-selection` support ← `v2026.03.2`

**Mar 6** - Tile map audit: 15 bug/security fixes, pointer-targeted zoom, drag throttling, docs sync

### Week 18: The Overlay Spectrum (Mar 7-11)

**Mar 7** - SVG overlay module, tile map chroma-key filter + blur, OkLab color, CLI Node.js flag fixes ← `v2026.03.5`, `v2026.03.6`

**Mar 9** - DevTools overhaul (14 conditional tabs), AI tool framework expansion, hit-test refinements

**Mar 10** - Data visualization doc page, AI doc page, doc examples ← `v2026.03.7`

**Mar 11** - I18n subsystem (`<messages>`, `@key` sigils, locale switching), sub-byte PNG decode fix, tile map disk cache resilience, tab border gap fix, tooltip content debounce ← `v2026.03.8`

**Mar 12-15** - Shader effects library, AI streaming module, dialog base class, canvas rendering fixes, melkrox game example ← `v2026.03.9`

**Mar 15** - Policy path variables (`$configDir`, `$cacheDir`, etc.), `--show-policy` resolved path display ← `v2026.03.10`

## Components

| Component       | Added  | Description                           |
|-----------------|--------|---------------------------------------|
| Core set        | Dec 11 | button, text, input, textarea, etc.   |
| tabs            | Dec 13 | Tabbed panels                         |
| table           | Jan 3  | Data tables with scrolling            |
| progress        | Jan 3  | Progress bar (canvas-based)           |
| img             | Jan 5  | Image display                         |
| combobox        | Jan 6  | Filterable dropdown                   |
| select          | Jan 6  | Dropdown picker                       |
| autocomplete    | Jan 6  | Async search dropdown                 |
| command-palette | Jan 6  | Modal command picker                  |
| slider          | Jan 10 | Range input                           |
| file-browser    | Jan 11 | Directory/file picker                 |
| segment-display | Jan 16 | LCD-style displays                    |
| data-bars       | Jan 21 | Bar charts and sparklines             |
| graph           | Jan 30 | Mermaid diagrams                      |
| connector       | Jan 30 | Box-drawing lines between elements    |
| spinner         | Feb 2  | Animated loading indicators           |
| toast           | Feb 2  | Non-modal notifications               |
| data-heatmap    | Feb 3  | 2D heatmaps with color scales         |
| tooltip         | Feb 4  | Contextual hover/focus overlays       |
| split-pane      | Feb 6  | Resizable N-way split panels          |
| data-tree       | Feb 10 | Hierarchical tree with expand/collapse |

## Releases

CalVer format: `YYYY.MM.PATCH`. Releases are git tags only.

| Tag          | Date   | Highlights                                           |
|--------------|--------|------------------------------------------------------|
| `v2026.01.1` | Jan 12 | Website launch, first public release                 |
| `v2026.01.4` | Jan 14 | Dithering refactor, dev tools log tab                |
| `v2026.01.5` | Jan 22 | Data bars, tutorial, dirty row tracking              |
| `v2026.01.6` | Jan 31 | Graph/Mermaid, permission overrides, text decoration |
| `v2026.02.1` | Feb 5  | Benchmarks, tooltips, iTerm2, data heatmap           |
| `v2026.02.2` | Feb 6  | Split pane, media queries, engine decomposition      |
| `v2026.02.3` | Feb 7  | Dependency cleanup, style property refactoring       |
| `v2026.02.4` | Feb 11 | CSS animations, specificity, container queries       |
| `v2026.02.5` | Feb 13 | Unified CSS parser, canvas polygons, deduplication   |
| `v2026.02.6` | Feb 20 | JSR distribution, embedded assets, showcase examples |
| `v2026.02.7` | Feb 22 | JSR publishing pipeline, global accessors            |
| `v2026.02.8` | Feb 26 | Opacity, state binding, SVG paths, quadrant mode     |
| `v2026.02.9` | Feb 27 | AI accessibility, bundler fixes, docs refresh        |
| `v2026.03.1` | Mar 3  | Node.js 25+ support, runtime abstraction, npm publish|
| `v2026.03.2` | Mar 6  | Tile map SVG overlays, disk cache, bind-selection    |
| `v2026.03.3` | Mar 6  | Tile map audit, AI tools, policy shortcuts           |
| `v2026.03.4` | Mar 6  | Engine cache improvements                            |
| `v2026.03.5` | Mar 7  | SVG overlay module, chroma-key filter, OkLab color   |
| `v2026.03.6` | Mar 7  | CLI Node.js flag fixes                               |
| `v2026.03.7` | Mar 10 | DevTools overhaul, data-viz docs, AI doc page          |
| `v2026.03.8` | Mar 11 | I18n subsystem, tile map fixes, tooltip debounce       |
| `v2026.03.9` | Mar 15 | Shader effects, AI streaming, dialog, canvas fixes     |
| `v2026.03.10`| Mar 15 | Policy path variables, --show-policy display           |
