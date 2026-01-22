# Architecture

## Core Concepts

- **Document Model**: HTML-inspired elements with React-like createElement pattern, JSON serializable
- **Dual-Buffer Rendering**: Character buffer + style buffer for efficient ANSI output, with dirty row tracking for O(dirtyRows × width) diff instead of O(width × height)
- **Flexbox Layout**: Single layout engine with flex-wrap, border-box sizing
- **Theming**: Configurable via `--theme` flag, `MELKER_THEME` env, or config file (default: `auto`); auto-detects terminal capabilities or use manual themes (bw, gray, color, fullcolor variants)

## Components

| Component | File | Notes |
|-----------|------|-------|
| Container | `src/components/container.ts` | Flexbox layout, scrolling |
| Text | `src/components/text.ts` | Text display with wrapping |
| Input | `src/components/input.ts` | Single-line text input |
| Textarea | `src/components/textarea.ts` | Multi-line text input with cursor |
| Button | `src/components/button.ts` | Uses `label` prop or content syntax |
| Dialog | `src/components/dialog.ts` | Modal overlay |
| Canvas | `src/components/canvas.ts` | Pixel graphics via sextant chars, onPaint, onShader, dither modes |
| Canvas Image | `src/components/canvas-image.ts` | Image loading/decoding (file paths, HTTP/HTTPS, data URLs) |
| Canvas Shader | `src/components/canvas-shader-runner.ts` | Shader animation runner |
| Img | `src/components/img.ts` | Image display (extends Canvas), supports PNG/JPEG/GIF |
| Video | `src/components/video.ts` | Video playback (extends Canvas), stopped on engine exit |
| Markdown | `src/components/markdown.ts` | Markdown text rendering with image support (`![alt](url)`) |
| Checkbox | `src/components/checkbox.ts` | Toggle checkbox |
| Radio | `src/components/radio.ts` | Radio button |
| List | `src/components/list.ts` | List container |
| Li | `src/components/li.ts` | List item |
| Table | `src/components/table.ts` | Data table container |
| Table Section | `src/components/table-section.ts` | thead/tbody/tfoot sections |
| Table Row | `src/components/table-row.ts` | tr element |
| Table Cell | `src/components/table-cell.ts` | td/th elements |
| Progress | `src/components/progress.ts` | Progress bar (extends Canvas) |
| Combobox | `src/components/filterable-list/combobox.ts` | Dropdown with text filter |
| Select | `src/components/filterable-list/select.ts` | Dropdown picker (no filter) |
| Autocomplete | `src/components/filterable-list/autocomplete.ts` | Combobox + async search |
| Command Palette | `src/components/filterable-list/command-palette.ts` | Modal command picker |
| Slider | `src/components/slider.ts` | Range input with keyboard/mouse drag |
| File Browser | `src/components/file-browser/file-browser.ts` | Directory navigation, file selection |
| Data Table | `src/components/data-table.ts` | High-performance array-based table |

**Utilities:**
- `src/components/mod.ts` - Component exports
- `src/components/color-utils.ts` - RGBA color packing/unpacking, CSS parsing

## Key Files

| File | Purpose |
|------|---------|
| `src/engine.ts` | Main application engine, lifecycle, event handling, render guards |
| `src/layout.ts` | Flexbox layout calculations |
| `src/rendering.ts` | Render pipeline, overlay handling |
| `src/buffer.ts` | Dual-buffer system |
| `src/renderer.ts` | ANSI terminal output |
| `src/focus.ts` | Focus management, tab navigation |
| `src/theme.ts` | Theming system, color palettes |
| `src/input.ts` | Raw terminal input, mouse events |
| `src/template.ts` | Template literal syntax, .melker file parsing |
| `src/element.ts` | Element creation, component registry |
| `src/document.ts` | Document class, element registry, focus |
| `src/events.ts` | Event system, EventManager |
| `src/types.ts` | Core type definitions |
| `src/deps.ts` | Centralized npm dependencies (HTML parsing, image decoding, markdown, LSP) |
| `src/sizing.ts` | Box model, border-box sizing |
| `src/viewport.ts` | Viewport management for scrolling |
| `src/viewport-buffer.ts` | Viewport buffer proxies |
| `src/content-measurer.ts` | Content size measurement |
| `src/resize.ts` | Terminal resize handling |
| `src/stylesheet.ts` | CSS-like stylesheet system |
| `src/serialization.ts` | Element serialization/deserialization |
| `src/logging.ts` | File-based logging system |
| `src/debug-server.ts` | WebSocket debug server |
| `src/headless.ts` | Headless mode for testing |
| `src/system-command-palette.ts` | System commands (Exit, AI, Dev Tools, Performance) auto-injected into palettes |
| `src/dev-tools.ts` | F12 Dev Tools overlay (source, policy, config, inspect, system info) |
| `src/config/` | Schema-driven config system (schema.json, config.ts, cli.ts) |
| `melker.ts` | CLI entry point (symlink-safe, runs launcher) |
| `mod.ts` | Library entry point (exports, component registrations) |
| `melker-launcher.ts` | Policy enforcement and subprocess spawning |
| `docs/netlify/edge-functions/melker.ts` | Netlify Edge Function for versioned launcher URLs (/melker.ts, /melker-v2026.01.1.ts, /melker-abc123f.ts) |
| `src/melker-runner.ts` | .melker file runner (bundling, engine, app execution) |
| `src/lint.ts` | Lint mode validation, schemas |
| `src/lsp.ts` | Language Server Protocol for .melker files |
| `src/terminal-lifecycle.ts` | Terminal setup, cleanup, signal handlers |
| `src/alert-dialog.ts` | Alert dialog manager (window.alert equivalent) |
| `src/confirm-dialog.ts` | Confirm dialog manager (window.confirm equivalent) |
| `src/prompt-dialog.ts` | Prompt dialog manager (window.prompt equivalent) |
| `src/hit-test.ts` | Hit testing for mouse events, table parts |
| `src/scroll-handler.ts` | Scroll handling, scrollbar interaction |
| `src/text-selection-handler.ts` | Text selection and drag handling |
| `src/error-boundary.ts` | Error handling, rate limiting, error overlay |
| `src/performance-dialog.ts` | Live performance stats dialog (Ctrl+Shift+P) |

**Filterable List Components (`src/components/filterable-list/`):**
| File | Purpose |
|------|---------|
| `src/components/filterable-list/mod.ts` | Module exports |
| `src/components/filterable-list/core.ts` | FilterableListCore base class |
| `src/components/filterable-list/filter.ts` | Fuzzy/prefix/contains/exact algorithms |
| `src/components/filterable-list/option.ts` | OptionElement (child element) |
| `src/components/filterable-list/group.ts` | GroupElement (option grouping) |
| `src/components/filterable-list/combobox.ts` | ComboboxElement |
| `src/components/filterable-list/select.ts` | SelectElement |
| `src/components/filterable-list/autocomplete.ts` | AutocompleteElement |
| `src/components/filterable-list/command-palette.ts` | CommandPaletteElement |

**File Browser (`src/components/file-browser/`):**
| File | Purpose |
|------|---------|
| `src/components/file-browser/mod.ts` | Module exports |
| `src/components/file-browser/file-browser.ts` | FileBrowserElement (main component) |
| `src/components/file-browser/file-entry.ts` | Type definitions |
| `src/components/file-browser/file-utils.ts` | Directory loading, formatting utilities |

**Policy System (`src/policy/`):**
| File | Purpose |
|------|---------|
| `src/policy/mod.ts` | Policy module exports |
| `src/policy/types.ts` | Policy type definitions |
| `src/policy/loader.ts` | Policy loading from `<policy>` tag or external file |
| `src/policy/flags.ts` | Convert policy to Deno permission flags |
| `src/policy/approval.ts` | Approval cache (policy-hash for local, content-hash for remote) |

**Bundler (`src/bundler/`):**
| File | Purpose |
|------|---------|
| `src/bundler/mod.ts` | Bundler exports |
| `src/bundler/types.ts` | Bundler type definitions |
| `src/bundler/generator.ts` | TypeScript code generation from parsed .melker |
| `src/bundler/bundle.ts` | Deno.bundle() integration |
| `src/bundler/errors.ts` | Error translation to source lines |
| `src/bundler/cache.ts` | Bundle caching |

**Video Processing (`src/video/`):**
| File | Purpose |
|------|---------|
| `src/video/mod.ts` | Video module exports |
| `src/video/ffmpeg.ts` | FFmpeg integration |
| `src/video/dither.ts` | Re-exports from dither/ directory |
| `src/video/dither/` | Dithering algorithms directory |
| `src/video/dither/mod.ts` | Dithering module exports |
| `src/video/dither/types.ts` | DitherMode, ThresholdMatrix, ColorSupport types |
| `src/video/dither/utils.ts` | Shared buffers and helper functions |
| `src/video/dither/threshold.ts` | Ordered (Bayer), blue-noise, custom threshold matrix dithering |
| `src/video/dither/floyd-steinberg.ts` | Floyd-Steinberg and Floyd-Steinberg-Stable |
| `src/video/dither/sierra.ts` | Sierra and Sierra-Stable |
| `src/video/dither/atkinson.ts` | Atkinson and Atkinson-Stable |
| `src/video/subtitle.ts` | Subtitle handling |
| `src/video/waveform.ts` | Audio waveform visualization |

**AI Accessibility (`src/ai/`):**
| File | Purpose |
|------|---------|
| `src/ai/mod.ts` | AI module exports |
| `src/ai/openrouter.ts` | OpenRouter API client with SSE streaming |
| `src/ai/context.ts` | UI context builder, element tree serialization |
| `src/ai/cache.ts` | Query response cache (5min TTL) |
| `src/ai/tools.ts` | Tool definitions and execution (send_event, click_canvas, read_element, etc.) |
| `src/ai/accessibility-dialog.ts` | Dialog UI and conversation management |
| `src/ai/audio.ts` | Audio recording, transcription, and silence trimming |

**Utilities:**
| File | Purpose |
|------|---------|
| `src/lru-cache.ts` | Generic LRU cache with configurable max size |
| `src/utils/timing.ts` | Debounce and throttle utilities |

## Render Pipeline

Two render paths optimize for different scenarios:

**Full Render** (debounced 16ms):
```
Event → State change → Layout calculation → Buffer render → Swap → Terminal output
```

**Fast Render** (immediate, for Input/Textarea):
```
Keystroke → Update state → Render to buffer (cached bounds) → Output diff → Terminal
                         ↓
                         Schedule full render (16ms debounce)
```

Fast render provides ~2ms latency for typing. See `agent_docs/fast-input-render-plan.md` for details.

## Style Inheritance

Only these properties inherit to children:
- `color`
- `backgroundColor`
- `fontWeight`
- `borderColor`

Element-specific properties (borders, padding, margin) do NOT cascade.

## Type System

Melker uses TypeScript interfaces with type guards for optional element capabilities. See `src/types.ts` for all interfaces.

**Key type guards:**
- `isFocusable(element)` - Can receive keyboard focus
- `isFocusCapturable(element)` - Captures focus for children (dialogs)
- `isClickable(element)` - Handles click events
- `hasPositionalClickHandler(element)` - Handles clicks with x,y coordinates
- `isToggleable(element)` - Has toggle() method (command palettes)
- `hasKeyInputHandler(element)` - Handles text input
- `hasGetContent(element)` - Returns text content
- `hasIntrinsicSize(element)` - Calculates own size
- `isRenderable(element)` - Has render() and intrinsicSize()
- `isWheelable(element)` - Handles scroll wheel
- `isKeyboardElement(element)` - Custom keyboard handling

**Global type declarations** (`src/globals.d.ts`):
Declares `melkerEngine`, `$melker`, `$app`, `argv`, `__melker`, `logger`, etc.
Imported by `types.ts` to include in module graph for test type checking.

## Logging

**For app code** (`.melker` files, examples): `console.log()` redirects to `$melker.logger.info()` automatically.

**For Melker internal code** (files in `src/`, `mod.ts`, `melker-*.ts`): **NEVER use `console.log()`** - this is strictly forbidden. Always use the logging system:

```typescript
import { getLogger } from './logging.ts';
const logger = getLogger('MyComponent');
logger.debug('message', { context });
```

Configure via CLI flags (`--log-file`, `--log-level`), env vars, or config file.
Priority: `default < policy < file < env < cli`

Use `--no-console-override` to disable console redirect (for debugging app code).
