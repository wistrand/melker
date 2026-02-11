# Project Structure

Detailed file layout for the Melker codebase.

## Root Files

| File                 | Purpose                                          |
|----------------------|--------------------------------------------------|
| `melker.ts`          | CLI entry point (symlink-safe, runs launcher)    |
| `mod.ts`             | Library entry point (exports, component registrations) |
| `melker-launcher.ts` | Policy enforcement and subprocess spawning       |

## Source Directory (`src/`)

### Core Engine

| File                           | Purpose                                               |
|--------------------------------|-------------------------------------------------------|
| `melker-runner.ts`             | .melker file runner (bundling, engine, app execution) |
| `engine.ts`                    | Main engine, lifecycle, render orchestration           |
| `engine-keyboard-handler.ts`   | Keyboard event handling                               |
| `engine-mouse-handler.ts`      | Mouse and wheel event handling                        |
| `engine-buffer-overlays.ts`    | Buffer overlay rendering pipeline                     |
| `engine-system-palette.ts`     | System command palette logic                          |
| `engine-dialog-utils.ts`       | Dialog traversal and focus trap utilities              |
| `graphics-overlay-manager.ts`  | Sixel/Kitty/iTerm2 graphics overlay management        |
| `terminal-size-manager.ts`     | Terminal size detection, tracking, resize dispatch     |
| `dialog-coordinator.ts`        | Alert, confirm, prompt, accessibility dialog lifecycle |
| `scroll-handler.ts`            | Scroll event handling for containers                  |
| `element-click-handler.ts`     | Element click routing and focus                       |
| `focus-navigation-handler.ts`  | Tab/Shift+Tab focus navigation                        |
| `text-selection-handler.ts`    | Mouse text selection and hover tracking               |
| `state-persistence-manager.ts` | App state auto-save/restore                           |
| `ui-animation-manager.ts`      | Centralized timer for UI animations                   |
| `layout.ts`                    | Flexbox layout calculations                           |
| `rendering.ts`                 | Render pipeline, overlays                             |
| `buffer.ts`                    | Dual-buffer system, `DiffCollector` for fast render   |
| `renderer.ts`                  | ANSI terminal output                                  |
| `focus.ts`                     | Focus/tab navigation                                  |
| `theme.ts`                     | Theming system                                        |
| `template.ts`                  | .melker file parsing                                  |

### Types and Utilities

| File                  | Purpose                                          |
|-----------------------|--------------------------------------------------|
| `types.ts`            | Core type definitions, interfaces, type guards   |
| `globals.d.ts`        | Global type declarations (melkerEngine, $melker) |
| `deps.ts`             | Centralized npm dependencies                     |
| `element.ts`          | Element creation, component registry             |
| `document.ts`         | Document class, element registry                 |
| `events.ts`           | Event system, EventManager                       |
| `input.ts`            | Raw terminal input, mouse events                 |
| `resize.ts`           | Terminal resize handling                         |
| `sizing.ts`           | Box model, border-box sizing                     |
| `viewport.ts`         | Viewport management for scrolling                |
| `viewport-buffer.ts`  | Viewport buffer proxies                          |
| `content-measurer.ts` | Content size measurement                         |
| `clipped-buffer.ts`   | Clipped buffer rendering                         |
| `stylesheet.ts`       | CSS-like stylesheet system                       |
| `serialization.ts`    | Element serialization/deserialization            |
| `char-width.ts`       | Character width utilities                        |
| `lru-cache.ts`        | Generic LRU cache with configurable max size     |

### Developer Tools

| File                    | Purpose                                        |
|-------------------------|------------------------------------------------|
| `logging.ts`            | File-based logging system                      |
| `server.ts`             | WebSocket server                               |
| `headless.ts`           | Headless mode for testing                      |
| `dev-tools.ts`          | F12 Dev Tools overlay                          |
| `stats-overlay.ts`      | Performance stats overlay                      |
| `error-boundary.ts`     | Error handling, rate limiting, error overlay   |
| `performance-dialog.ts` | Live performance stats dialog (Ctrl+Shift+P)   |
| `lint.ts`               | Lint mode validation, schemas                  |
| `lsp.ts`                | Language Server Protocol for .melker files     |

#### `server-ui/` - Server Web UI

| File         | Purpose                                    |
|--------------|--------------------------------------------|
| `index.html` | HTML structure for server web UI           |
| `index.css`  | Styles for terminal mirror and panels      |
| `index.js`   | Client-side logic, WebSocket, rendering    |

### System Integration

| File                    | Purpose                                  |
|-------------------------|------------------------------------------|
| `oauth.ts`              | OAuth utilities                          |
| `xdg.ts`                | XDG Base Directory support               |
| `state-persistence.ts`  | State persistence for apps               |
| `terminal-lifecycle.ts` | Terminal setup, cleanup, signal handlers |

### Subdirectories

#### `policy/` - Permission Policy System

See [policy-architecture.md](policy-architecture.md) for comprehensive documentation.

| File                      | Purpose                                             |
|---------------------------|-----------------------------------------------------|
| `mod.ts`                  | Policy module exports                               |
| `types.ts`                | Policy type definitions                             |
| `loader.ts`               | Policy loading from `<policy>` tag or external file |
| `flags.ts`                | Convert policy to Deno permission flags             |
| `permission-overrides.ts` | CLI --allow-*/--deny-* flag handling                |
| `approval.ts`             | Approval prompts and hash-based caching             |
| `shortcut-utils.ts`       | Permission shortcut expansion (ai, clipboard, etc.) |
| `url-utils.ts`            | Extract hosts from URLs for net permissions         |

#### `config/` - Schema-Driven Configuration

| File          | Purpose                        |
|---------------|--------------------------------|
| `schema.json` | Config schema (source of truth) |
| `config.ts`   | MelkerConfig singleton class   |
| `cli.ts`      | CLI parser and help generators |
| `mod.ts`      | Config module exports          |

#### `bundler/` - Runtime Bundler

| File           | Purpose                           |
|----------------|-----------------------------------|
| `mod.ts`       | Main bundler exports              |
| `types.ts`     | Bundler type definitions          |
| `generator.ts` | TypeScript code generation        |
| `bundle.ts`    | Deno.bundle() integration         |
| `errors.ts`    | Error translation to source lines |
| `cache.ts`     | Bundle caching                    |

#### `components/` - UI Components

| File                      | Purpose                                |
|---------------------------|----------------------------------------|
| `mod.ts`                  | Component exports                      |
| `container.ts`            | Flexbox container                      |
| `text.ts`                 | Text display                           |
| `input.ts`                | Single-line text input                 |
| `textarea.ts`             | Multi-line text input                  |
| `button.ts`               | Clickable button                       |
| `dialog.ts`               | Modal dialog                           |
| `list.ts`                 | List container                         |
| `li.ts`                   | List item                              |
| `checkbox.ts`             | Toggle checkbox                        |
| `radio.ts`                | Radio button                           |
| `tabs.ts`                 | Tabbed container                       |
| `tab.ts`                  | Tab panel (child of tabs)              |
| `canvas.ts`               | Pixel graphics, buffer management      |
| `canvas-render.ts`        | Terminal rendering, color quantization |
| `canvas-dither.ts`        | Buffer compositing and dithering       |
| `canvas-image.ts`         | Image loading/decoding/rendering       |
| `canvas-shader-runner.ts` | Shader animation runner                |
| `img.ts`                  | Image component (extends canvas)       |
| `video.ts`                | Video playback                         |
| `progress.ts`             | Progress bar (extends Canvas)          |
| `spinner.ts`              | Loading indicator                      |
| `separator.ts`            | Horizontal/vertical line with optional label |
| `split-pane.ts`           | Resizable split panels with draggable dividers |
| `connector.ts`            | Draw lines between elements by ID      |
| `connector-utils.ts`      | Line drawing utilities, box-drawing chars |
| `data-bars.ts`            | Bar charts (horizontal/vertical, stacked/grouped) |
| `markdown.ts`             | Markdown rendering with image support  |
| `color-utils.ts`          | RGBA color utilities                   |
| `data-tree.ts`            | Hierarchical tree view                 |
| `data-heatmap.ts`         | Heatmap grid display                   |
| `table.ts`                | HTML-style table with thead/tbody      |
| `scrollbar.ts`            | Scrollbar rendering utility            |

#### `components/utils/` - Shared Component Utilities

| File                  | Purpose                                              |
|-----------------------|------------------------------------------------------|
| `component-utils.ts`  | Text formatting, JSON parsing, bounds, theme helpers |
| `scroll-manager.ts`   | `ScrollManager` class for virtual scrolling          |

#### `components/filterable-list/` - Filterable Components

| File                 | Purpose                                |
|----------------------|----------------------------------------|
| `mod.ts`             | Module exports                         |
| `core.ts`            | FilterableListCore base class          |
| `filter.ts`          | Fuzzy/prefix/contains/exact algorithms |
| `option.ts`          | OptionElement                          |
| `group.ts`           | GroupElement                           |
| `combobox.ts`        | ComboboxElement                        |
| `select.ts`          | SelectElement                          |
| `autocomplete.ts`    | AutocompleteElement                    |
| `command-palette.ts` | CommandPaletteElement                  |

#### `components/file-browser/` - File Browser

| File              | Purpose                                 |
|-------------------|-----------------------------------------|
| `mod.ts`          | Module exports                          |
| `file-browser.ts` | FileBrowserElement (main component)     |
| `file-entry.ts`   | Type definitions                        |
| `file-utils.ts`   | Directory loading, formatting utilities |

#### `components/segment-display/` - LCD-Style Display

| File                  | Purpose                                          |
|-----------------------|--------------------------------------------------|
| `mod.ts`              | Module exports                                   |
| `segment-display.ts`  | SegmentDisplayElement                            |
| `charsets.ts`         | Character segment definitions                    |
| `renderers.ts`        | Renderer styles (box, rounded, geometric, pixel) |
| `bitmap-fonts.ts`     | Bitmap font data (3x5 inline, 5x7 lazy-loaded)  |
| `5x7.psf2`           | PSF2 bitmap font for 5x7 pixel renderer          |
| `types.ts`            | Type definitions                                 |

#### `components/graph/` - Graph/Diagram Rendering

| File                           | Purpose                                   |
|--------------------------------|-------------------------------------------|
| `mod.ts`                       | Module exports                            |
| `graph.ts`                     | GraphElement component                    |
| `graph-to-melker.ts`           | Converts parsed graph to melker elements  |
| `layout.ts`                    | Graph layout algorithm (level-based)      |
| `types.ts`                     | GraphDefinition, SequenceDefinition, etc. |
| `parsers/mod.ts`               | Parser registry and factory               |
| `parsers/types.ts`             | Parser interfaces                         |
| `parsers/mermaid-flowchart.ts` | Mermaid flowchart parser                  |
| `parsers/mermaid-sequence.ts`  | Mermaid sequence diagram parser           |
| `parsers/mermaid-class.ts`     | Mermaid class diagram parser              |
| `parsers/json.ts`              | JSON graph parser                         |

#### `video/` - Video Processing

| File          | Purpose                 |
|---------------|-------------------------|
| `mod.ts`      | Video exports           |
| `ffmpeg.ts`   | FFmpeg integration      |
| `dither.ts`   | Re-exports from dither/ |
| `subtitle.ts` | Subtitle handling       |
| `waveform.ts` | Audio waveform          |

#### `video/dither/` - Dithering Algorithms

| File                 | Purpose                           |
|----------------------|-----------------------------------|
| `mod.ts`             | Dithering exports                 |
| `types.ts`           | DitherMode, ThresholdMatrix types |
| `utils.ts`           | Shared buffers and helpers        |
| `threshold.ts`       | Ordered, blue-noise dithering     |
| `floyd-steinberg.ts` | Floyd-Steinberg algorithms        |
| `sierra.ts`          | Sierra algorithms                 |
| `atkinson.ts`        | Atkinson algorithms               |

#### `sixel/` - Sixel Graphics

| File         | Purpose                             |
|--------------|-------------------------------------|
| `mod.ts`     | Sixel module exports                |
| `detect.ts`  | Terminal sixel capability detection |
| `encoder.ts` | Pure TypeScript sixel encoder       |
| `palette.ts` | Color quantization, palette caching |

#### `kitty/` - Kitty Graphics

| File         | Purpose              |
|--------------|----------------------|
| `mod.ts`     | Kitty module exports |
| `types.ts`   | Type definitions     |
| `detect.ts`  | Capability detection |
| `encoder.ts` | Kitty format encoder |

#### `ai/` - AI Accessibility

| File                       | Purpose                            |
|----------------------------|------------------------------------|
| `mod.ts`                   | AI module exports                  |
| `openrouter.ts`            | OpenRouter API streaming client    |
| `context.ts`               | UI context builder for AI          |
| `cache.ts`                 | Query response cache               |
| `tools.ts`                 | AI tool system (built-in + custom) |
| `accessibility-dialog.ts`  | AI assistant dialog                |
| `audio.ts`                 | Audio recording and transcription  |
| `macos-audio-record.swift` | Native macOS audio capture         |

#### `toast/` - Toast Notifications

| File                | Purpose                                |
|---------------------|----------------------------------------|
| `mod.ts`            | Toast module exports                   |
| `types.ts`          | Toast interfaces and defaults          |
| `toast-manager.ts`  | Singleton manager, timer-driven expiry |
| `toast-renderer.ts` | Direct buffer rendering                |

#### `chat/` - Chat Utilities

| File                 | Purpose           |
|----------------------|-------------------|
| `chat-fetch-util.ts` | HTTP fetch helpers |

#### `utils/` - Shared Utilities

| File                      | Purpose                                         |
|---------------------------|-------------------------------------------------|
| `timing.ts`               | Debounce and throttle functions                 |
| `terminal-detection.ts`   | Multiplexer and remote session detection        |
| `pixel-utils.ts`          | Pixel encoding (Uint32 to RGB/RGBA byte arrays) |

## Scripts Directory (`scripts/`)

Utility scripts for development and documentation.

| File                  | Purpose                              |
|-----------------------|--------------------------------------|
| `capture.ts`          | Screenshot/video capture using Xvfb  |
| `capture-config.json` | Default capture configuration        |
| `capture-schema.json` | JSON schema for capture config       |

### Capture Script

Automates capturing screenshots and videos of Melker apps for documentation. Uses Xvfb (virtual X server), ImageMagick, and ffmpeg.

```bash
# Run with default config
./scripts/capture.ts

# Run with custom config
./scripts/capture.ts my-config.json

# Dry run (show what would be captured)
./scripts/capture.ts --dry-run
```

**Dependencies:** `xorg-server-xvfb`, `imagemagick`, `ffmpeg`, `kitty`

**Config structure:**
```json
{
  "defaults": {
    "type": "screenshot",
    "delay": 2,
    "duration": 3,
    "fps": 30,
    "resolution": "1280x900x24",
    "thumbnailWidth": 320
  },
  "output": {
    "screenshots": "docs/screenshots",
    "videos": "docs/screenshots/videos",
    "thumbnails": "docs/screenshots/thumbnails"
  },
  "items": [
    { "app": "examples/showcase/breakout.melker" },
    { "app": "examples/canvas/plasma.melker", "type": "video", "duration": 5 }
  ]
}
```

**Item options:**
- `app` - Path to .melker file (required)
- `args` - Arguments to pass to app
- `type` - "screenshot" or "video"
- `output` - Output filename (without extension)
- `delay` - Seconds to wait before capture
- `duration` - Video duration in seconds
- `fps` - Video framerate
- `gfxMode` - Graphics mode (sextant, block, sixel, etc.)
- `skip` - Skip this item
- `description` - Human-readable description

## Other Directories

| Directory              | Purpose                                                            |
|------------------------|--------------------------------------------------------------------|
| `agent_docs/`          | Documentation for AI agents                                        |
| `benchmarks/`          | Performance benchmarks (see [benchmark-architecture.md](benchmark-architecture.md)) |
| `examples/`            | Example applications                                               |
| `examples/showcase/`   | Polished apps (htop, map, breakout)                                |
| `examples/basics/`     | Learning progression                                               |
| `examples/components/` | Component demos                                                    |
| `examples/layout/`     | Flexbox, borders, scrolling                                        |
| `examples/canvas/`     | Canvas graphics, shaders, video                                    |
| `examples/typescript/` | TypeScript examples                                                |
| `examples/melker/`     | Scripts, advanced patterns                                         |
| `examples/_internal/`  | Test files and variants                                            |
| `tests/`               | Test files                                                         |
| `docs/`                | Website content (served at melker.sh)                              |
| `skills/`              | AI agent skills                                                    |

## See Also

- [architecture.md](architecture.md) — Core architecture concepts
- [component-reference.md](component-reference.md) — Component documentation
- [benchmark-architecture.md](benchmark-architecture.md) — Performance benchmarking infrastructure
