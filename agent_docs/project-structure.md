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

| File                        | Purpose                                    |
|-----------------------------|--------------------------------------------|
| `melker-runner.ts`          | .melker file runner (bundling, engine, app execution) |
| `engine.ts`                 | Main engine, lifecycle, events             |
| `engine-keyboard-handler.ts` | Keyboard event handling                   |
| `engine-system-palette.ts`  | System command palette logic               |
| `engine-dialog-utils.ts`    | Dialog traversal and focus trap utilities  |
| `layout.ts`                 | Flexbox layout calculations                |
| `rendering.ts`              | Render pipeline, overlays                  |
| `buffer.ts`                 | Dual-buffer system                         |
| `renderer.ts`               | ANSI terminal output                       |
| `focus.ts`                  | Focus/tab navigation                       |
| `theme.ts`                  | Theming system                             |
| `template.ts`               | .melker file parsing                       |

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

| File                    | Purpose                                      |
|-------------------------|----------------------------------------------|
| `logging.ts`            | File-based logging system                    |
| `debug-server.ts`       | WebSocket debug server                       |
| `headless.ts`           | Headless mode for testing                    |
| `dev-tools.ts`          | F12 Dev Tools overlay                        |
| `stats-overlay.ts`      | Performance stats overlay                    |
| `error-boundary.ts`     | Error handling, rate limiting, error overlay |
| `performance-dialog.ts` | Live performance stats dialog (Ctrl+Shift+P) |
| `lint.ts`               | Lint mode validation, schemas                |
| `lsp.ts`                | Language Server Protocol for .melker files   |

### System Integration

| File                    | Purpose                               |
|-------------------------|---------------------------------------|
| `oauth.ts`              | OAuth utilities                       |
| `xdg.ts`                | XDG Base Directory support            |
| `state-persistence.ts`  | State persistence for apps            |
| `terminal-lifecycle.ts` | Terminal setup, cleanup, signal handlers |

### Subdirectories

#### `policy/` - Permission Policy System

| File        | Purpose                                        |
|-------------|------------------------------------------------|
| `mod.ts`    | Policy module exports                          |
| `types.ts`  | Policy type definitions                        |
| `loader.ts` | Policy loading from `<policy>` tag or external file |
| `flags.ts`  | Convert policy to Deno permission flags        |

#### `config/` - Schema-Driven Configuration

| File          | Purpose                        |
|---------------|--------------------------------|
| `schema.json` | Config schema (source of truth) |
| `config.ts`   | MelkerConfig singleton class   |
| `cli.ts`      | CLI parser and help generators |
| `mod.ts`      | Config module exports          |

#### `bundler/` - Runtime Bundler

| File           | Purpose                          |
|----------------|----------------------------------|
| `mod.ts`       | Main bundler exports             |
| `types.ts`     | Bundler type definitions         |
| `generator.ts` | TypeScript code generation       |
| `bundle.ts`    | Deno.bundle() integration        |
| `errors.ts`    | Error translation to source lines |
| `cache.ts`     | Bundle caching                   |

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
| `data-bars.ts`            | Bar charts (horizontal/vertical, stacked/grouped) |
| `markdown.ts`             | Markdown rendering with image support  |
| `color-utils.ts`          | RGBA color utilities                   |

#### `components/filterable-list/` - Filterable Components

| File                 | Purpose                      |
|----------------------|------------------------------|
| `mod.ts`             | Module exports               |
| `core.ts`            | FilterableListCore base class |
| `filter.ts`          | Fuzzy/prefix/contains/exact algorithms |
| `option.ts`          | OptionElement                |
| `group.ts`           | GroupElement                 |
| `combobox.ts`        | ComboboxElement              |
| `select.ts`          | SelectElement                |
| `autocomplete.ts`    | AutocompleteElement          |
| `command-palette.ts` | CommandPaletteElement        |

#### `components/file-browser/` - File Browser

| File              | Purpose                          |
|-------------------|----------------------------------|
| `mod.ts`          | Module exports                   |
| `file-browser.ts` | FileBrowserElement (main component) |
| `file-entry.ts`   | Type definitions                 |
| `file-utils.ts`   | Directory loading, formatting utilities |

#### `video/` - Video Processing

| File          | Purpose                 |
|---------------|-------------------------|
| `mod.ts`      | Video exports           |
| `ffmpeg.ts`   | FFmpeg integration      |
| `dither.ts`   | Re-exports from dither/ |
| `subtitle.ts` | Subtitle handling       |
| `waveform.ts` | Audio waveform          |

#### `video/dither/` - Dithering Algorithms

| File               | Purpose                      |
|--------------------|------------------------------|
| `mod.ts`           | Dithering exports            |
| `types.ts`         | DitherMode, ThresholdMatrix types |
| `utils.ts`         | Shared buffers and helpers   |
| `threshold.ts`     | Ordered, blue-noise dithering |
| `floyd-steinberg.ts` | Floyd-Steinberg algorithms |
| `sierra.ts`        | Sierra algorithms            |
| `atkinson.ts`      | Atkinson algorithms          |

#### `sixel/` - Sixel Graphics

| File         | Purpose                           |
|--------------|-----------------------------------|
| `mod.ts`     | Sixel module exports              |
| `detect.ts`  | Terminal sixel capability detection |
| `encoder.ts` | Pure TypeScript sixel encoder     |
| `palette.ts` | Color quantization, palette caching |

#### `kitty/` - Kitty Graphics

| File         | Purpose              |
|--------------|----------------------|
| `mod.ts`     | Kitty module exports |
| `types.ts`   | Type definitions     |
| `detect.ts`  | Capability detection |
| `encoder.ts` | Kitty format encoder |

#### `ai/` - AI Accessibility

| File                      | Purpose                        |
|---------------------------|--------------------------------|
| `mod.ts`                  | AI module exports              |
| `openrouter.ts`           | OpenRouter API streaming client |
| `context.ts`              | UI context builder for AI      |
| `cache.ts`                | Query response cache           |
| `tools.ts`                | AI tool system (built-in + custom) |
| `accessibility-dialog.ts` | AI assistant dialog            |
| `audio.ts`                | Audio recording and transcription |
| `macos-audio-record.swift` | Native macOS audio capture    |

#### `chat/` - Chat Utilities

| File                 | Purpose           |
|----------------------|-------------------|
| `chat-fetch-util.ts` | HTTP fetch helpers |

#### `utils/` - Shared Utilities

| File        | Purpose                       |
|-------------|-------------------------------|
| `timing.ts` | Debounce and throttle functions |

## Other Directories

| Directory              | Purpose                               |
|------------------------|---------------------------------------|
| `agent_docs/`          | Documentation for AI agents           |
| `examples/`            | Example applications                  |
| `examples/showcase/`   | Polished apps (htop, map, breakout)   |
| `examples/basics/`     | Learning progression                  |
| `examples/components/` | Component demos                       |
| `examples/canvas/`     | Canvas graphics, shaders, video       |
| `examples/typescript/` | TypeScript examples                   |
| `examples/melker/`     | .melker file examples                 |
| `tests/`               | Test files                            |
| `docs/`                | Website content (served at melker.sh) |
| `skills/`              | AI agent skills                       |

## See Also

- [architecture.md](architecture.md) — Core architecture concepts
- [component-reference.md](component-reference.md) — Component documentation
