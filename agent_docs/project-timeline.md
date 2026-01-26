# Melker Project Timeline

Development history from December 2025 to January 2026.

## December 2025: Foundation

### Week 1 (Dec 7-14)

**Dec 7** — Initial commit

**Dec 11** — Core framework
- Dual-buffer rendering, flexbox layout, event system, theme support
- Initial components: button, canvas, checkbox, container, dialog, input, list, markdown, radio, text, textarea, video

**Dec 13** — Tabs component added

**Dec 14** — Input handling polish, tab navigation

### Week 2 (Dec 15-21)

**Dec 15-18** — Text and dialog refinements
- Textarea scrolling, text wrapping, markdown rendering

**Dec 19** — Video playback working (Build 70)

**Dec 21** — Canvas improvements

### Week 3 (Dec 22-31)

**Dec 23** — Bundler system for .melker files

## January 2026: Rapid Development

### Week 4 (Jan 2-3)

**Jan 2** — Security and tooling
- Permission policy system (`src/policy/`)
- LSP server for editor integration
- Draggable dialogs

**Jan 3** — Tables and approval
- Table components with scrolling
- Progress bar component
- App approval system for sandboxing
- Confirm/prompt dialogs

### Week 5 (Jan 4-7)

**Jan 4** — Documentation refresh

**Jan 5** — Image component (extends canvas with responsive sizing)

**Jan 6** — Filterable lists
- Combobox, select, autocomplete, command-palette
- Fuzzy/prefix/contains matching
- Launcher/runner architecture split
- Performance dialog (F6), system palette (Ctrl+K)

**Jan 7** — Shaders and image loading
- Canvas shader system (plasma, metaballs, synthwave demos)
- Pure-JS image decoders (PNG, JPEG, GIF)

### Week 6 (Jan 8-12)

**Jan 8-10** — Configuration and slider
- Schema-driven config system with layered overrides
- Dev Tools dialog (F12) with config tab
- Slider component, breakout game demo

**Jan 11** — File browser
- Directory navigation, file selection, keyboard shortcuts
- htop.melker demo (system monitor)
- Table render caching, dialog scroll optimization

**Jan 12** — Website launch
- melker.sh with landing page and examples gallery
- CalVer release scheme (YYYY.MM.PATCH)

### Week 7 (Jan 13-22)

**Jan 13** — Skill documentation (TROUBLESHOOTING.md, TYPES.md)

**Jan 14** — Dithering refactor
- Algorithms split into `src/video/dither/` module
- Floyd-Steinberg, Sierra, Atkinson, threshold/blue-noise
- Dev Tools log tab with in-memory buffer

**Jan 15-18** — Segment display and maps
- 7/14/16-segment LCD display component
- Map viewer with OpenStreetMap tiles
- Canvas modules split (image, shader-runner)

**Jan 19-20** — Dirty row tracking
- Buffer diff optimization (72% cell scan reduction)
- Only scan rows that actually changed

**Jan 21-22** — Data visualization and tutorial
- Data bars component (charts, sparklines)
- Tutorial page on melker.sh
- Netlify edge functions for versioned URLs
- Engine refactor (keyboard, palette, dialog modules)
- QR code example, border titles, scrollbar component

### Week 8 (Jan 25-26)

**Jan 25-26** — Graphics protocols
- Sixel graphics (detection, encoding, palette quantization)
- Kitty graphics (detection, encoding, stable image IDs)
- Documentation reorganization

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

## Milestones

| Build | Date   | Achievement                              |
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
