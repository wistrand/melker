# Melker Project Timeline

Development history from git commits.

## Week 1: Foundation (Dec 7-14, 2025)

**Dec 7** - Initial commit

**Dec 11** - Core framework established
- Dual-buffer rendering system (`buffer.ts`)
- Component system with registry (`element.ts`, `components/mod.ts`)
- Initial components: button, canvas, checkbox, container, dialog, file-browser, input, list, li, markdown, radio, text, textarea, video
- Flexbox layout engine (`layout.ts`)
- Event system (`events.ts`)
- Theme support (`theme.ts`)

**Dec 12** - Markdown and video improvements
- Markdown rendering enhancements
- Canvas and video component fixes

**Dec 13** - Tabs component
- Added `tabs.ts` and `tab.ts` components
- Dialog improvements

**Dec 14** - Input handling and polish
- Button, checkbox, input, textarea improvements
- Container and radio fixes
- Tab navigation

## Week 2: Features (Dec 15-21, 2025)

**Dec 15** - Dialog and text improvements
- Dialog enhancements
- Markdown and text rendering
- Textarea scrolling

**Dec 16** - Input focus
- Input component focus handling

**Dec 17** - Text wrapping
- Text component improvements

**Dec 18** - Text rendering
- Additional text component fixes

**Dec 19** - Build 70

**Dec 21** - Canvas improvements
- Canvas component enhancements

## Week 3: Holiday Break (Dec 22-31, 2025)

**Dec 23** - Bundler improvements
- Generator refactoring
- Script handling updates

## Week 4: Major Features (Jan 2-3, 2026)

**Jan 2** - Policy system and LSP
- Permission policy system (`src/policy/`)
- LSP server for .melker files (`lsp.ts`)
- Draggable dialogs
- View source overlay improvements
- Border rendering improvements

**Jan 3** - Tables, Progress, Approval system
- Table components: `table.ts`, `table-row.ts`, `table-cell.ts`, `table-section.ts`
- Progress bar component (`progress.ts`)
- App approval system for security
- Confirm and prompt dialogs
- Debug server enhancements
- Theme improvements
- TUI comparison documentation

## Week 5: Components and Polish (Jan 4-7, 2026)

**Jan 4** - Documentation and showcase
- README and MANIFESTO updates
- Showcase demo
- Input handling improvements

**Jan 5** - Image component
- New `img.ts` component (extends canvas)
- Percentage-based responsive dimensions
- Image loading in canvas

**Jan 6** - Filterable lists and architecture
- Filterable list components: combobox, select, autocomplete, command-palette
- FilterableListCore base class with fuzzy/prefix/contains matching
- Chrome collapse for tight layouts
- Menu components removed (replaced by command palette)
- Launcher/runner architecture split (`melker-launcher.ts`, `melker-runner.ts`)
- Performance dialog (F6)
- Fast input rendering optimization
- System command palette (Ctrl+K)

**Jan 7** - Shaders and stable image loading
- Canvas shader system (`canvas-shader.ts`, `canvas-draw.ts`)
- Shader demos: plasma, metaballs, synthwave, fractal tunnel
- Pure-JS image decoders (PNG via fast-png, JPEG via jpeg-js, GIF via omggif)
- Module reorganization (`mod.ts` as library entry point)
- Performance dialog enhancements
- Markdown path resolution fix (cwd-relative for CLI args)

**Jan 8-10** - Configuration system and Dev Tools
- Unified config system (`src/config/`): schema.json, config.ts, cli.ts
- Schema-driven CLI parser with auto-generated help
- Config priority: `default < policy < file < env < cli`
- Policy config support (config in `<policy>` tag)
- View Source renamed to Dev Tools (`src/dev-tools.ts`)
- Config tab added to Dev Tools dialog (F12)
- OAuth configuration options
- Removed dotenv dependency

## Component Timeline

| Component | Added | Notes |
|-----------|-------|-------|
| Core (button, text, input, etc.) | Dec 11 | Initial framework |
| tabs, tab | Dec 13 | Tabbed interface |
| table, tr, td, th, thead, tbody | Jan 3 | Data tables with scrolling |
| progress | Jan 3 | Canvas-based progress bar |
| img | Jan 5 | Image display (extends canvas) |
| combobox, select | Jan 6 | Dropdown components |
| autocomplete | Jan 6 | Async search dropdown |
| command-palette | Jan 6 | Modal command picker |

## Architecture Evolution

1. **Dec 11**: Monolithic structure with all code in `src/`
2. **Dec 23**: Bundler system for .melker files (`src/bundler/`)
3. **Jan 2**: Policy system for permissions (`src/policy/`)
4. **Jan 6**: Launcher/runner split for subprocess spawning
5. **Jan 6**: Filterable list component family (`src/components/filterable-list/`)
6. **Jan 7**: Canvas subsystem split (shader, draw, terminal modules)
7. **Jan 8-10**: Unified config system (`src/config/`)

## Key Milestones

- **Build 10** (Dec 12): Basic rendering working
- **Build 40** (Dec 15): Interactive components functional
- **Build 70** (Dec 19): Video playback working
- **Build 90** (Jan 2): Policy and security system
- **Build 100** (Jan 4): Stable input handling
- **Build 110** (Jan 6): Chrome collapse, filterable lists
- **Build 120** (Jan 7): Shaders, stable image loading
- **Build 125** (Jan 10): Unified config system, Dev Tools
