# CLAUDE.md

Guidance for Claude Code when working with Melker.

## Project Overview

Melker is a Deno library for creating rich Terminal UI interfaces using an HTML-inspired document model. It renders component trees to ANSI terminals using a dual-buffer system.

## Quick Reference

| What | Where |
|------|-------|
| Architecture details | `agent_docs/architecture.md` |
| Elements & layout | `agent_docs/elements-and-layout.md` |
| Debugging & logging | `agent_docs/debugging.md` |
| .melker file format | `agent_docs/melker-file-format.md` |
| Implementation details | `agent_docs/implementation-details.md` |
| Examples | `examples/melker/*.melker` |

## Technology Stack

- **Runtime**: Deno (required, Node.js/Bun not supported)
- **Package**: @melker/core
- **Target**: ANSI-compatible terminals

## Development Commands

```bash
deno task dev          # Dev server with watch
deno task test         # Run tests
deno task check        # Type check
```

**Note**: Don't run `deno fmt` or `deno lint` automatically (user preference).

## Project Structure

```
melker.ts             - Main entry point, exports
src/
  engine.ts           - Main engine, lifecycle, events
  layout.ts           - Flexbox layout calculations
  rendering.ts        - Render pipeline, overlays
  buffer.ts           - Dual-buffer system
  renderer.ts         - ANSI terminal output
  focus.ts            - Focus/tab navigation
  theme.ts            - Theming system
  template.ts         - .melker file parsing
  types.ts            - Core type definitions
  element.ts          - Element creation, component registry
  document.ts         - Document class, element registry
  events.ts           - Event system, EventManager
  input.ts            - Raw terminal input, mouse events
  resize.ts           - Terminal resize handling
  sizing.ts           - Box model, border-box sizing
  viewport.ts         - Viewport management for scrolling
  viewport-buffer.ts  - Viewport buffer proxies
  content-measurer.ts - Content size measurement
  clipped-buffer.ts   - Clipped buffer rendering
  stylesheet.ts       - CSS-like stylesheet system
  serialization.ts    - Element serialization/deserialization
  logging.ts          - File-based logging system
  debug-server.ts     - WebSocket debug server
  headless.ts         - Headless mode for testing
  view-source.ts      - F12 View Source overlay
  stats-overlay.ts    - Performance stats overlay
  char-width.ts       - Character width utilities
  melker-main.ts      - .melker file runner (supports file paths and URLs)
  lint.ts             - Lint mode validation, schemas
  lsp.ts              - Language Server Protocol for .melker files
  oauth.ts            - OAuth utilities
  xdg.ts              - XDG Base Directory support
  state-persistence.ts - State persistence for apps
  components/         - Component implementations
    mod.ts            - Component exports
    container.ts      - Flexbox container
    text.ts           - Text display
    input.ts          - Single-line text input
    textarea.ts       - Multi-line text input
    button.ts         - Clickable button
    dialog.ts         - Modal dialog
    menu.ts           - Dropdown menu
    menu-bar.ts       - Horizontal menu container
    menu-item.ts      - Menu entry
    menu-separator.ts - Menu separator
    list.ts           - List container
    li.ts             - List item
    checkbox.ts       - Toggle checkbox
    radio.ts          - Radio button
    tabs.ts           - Tabbed container
    tab.ts            - Tab panel (child of tabs)
    file-browser.ts   - File system navigation
    canvas.ts         - Pixel graphics (sextant chars)
    video.ts          - Video playback
    markdown.ts       - Markdown rendering
    color-utils.ts    - RGBA color utilities
  video/              - Video processing
    mod.ts            - Video exports
    ffmpeg.ts         - FFmpeg integration
    dither.ts         - Dithering algorithms
    subtitle.ts       - Subtitle handling
    waveform.ts       - Audio waveform
  chat/               - Chat utilities
    chat-fetch-util.ts - HTTP fetch helpers
agent_docs/           - Documentation for AI agents
examples/             - Example applications
  ts/                 - TypeScript examples (createElement API)
  *.ts                - TypeScript examples (melker template API)
  melker/             - .melker file examples
tests/                - Test files
```

## Code Style

2-space indent, single quotes, semicolons, 100 char width.

## Critical Rules

1. **Never use `console.log()`** - Use file logging (`logger.debug()`, etc.)
2. **`alert()` shows a modal dialog** - Works like browser alert but as a TUI dialog (dismiss with OK button or Escape)
3. **Button uses `title` prop** - Not `label`
4. **Input type is `'input'`** - Not `'text-input'`
5. **Auto-render in .melker handlers** - Event handlers auto-render after completion (return `false` to skip)
6. **Avoid emojis** - They break terminal layout

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `MELKER_THEME` | Theme: `bw-std`, `fullcolor-dark`, etc. |
| `MELKER_LOG_FILE` | Log file path |
| `MELKER_LOG_LEVEL` | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `MELKER_HEADLESS` | Headless mode for CI |
| `MELKER_DEBUG_PORT` | Debug server port |
| `MELKER_LINT` | Enable lint mode (`true` or `1`) |
| `MELKER_PERSIST` | Enable state persistence (`true` or `1`, default: false) |
| `XDG_STATE_HOME` | Override state dir (default: `~/.local/state`) |
| `XDG_CONFIG_HOME` | Override config dir (default: `~/.config`) |
| `XDG_CACHE_HOME` | Override cache dir (default: `~/.cache`) |

## XDG Base Directory Spec

Melker follows the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir/latest/):

| Directory | Default | Purpose |
|-----------|---------|---------|
| State | `~/.local/state/melker/` | Persisted app state |
| Config | `~/.config/melker/` | User configuration |
| Cache | `~/.cache/melker/` | Non-essential cached data |
| Data | `~/.local/share/melker/` | User data files |

## Running .melker Files

```bash
# From local file
deno run --allow-all melker.ts examples/melker/counter.melker

# From URL
deno run --allow-all melker.ts http://localhost:1990/melker/counter.melker

# With lint validation
deno run --allow-all melker.ts --lint examples/melker/counter.melker

# Watch mode (auto-reload on file changes, local files only)
deno run --allow-all melker.ts --watch examples/melker/counter.melker

# Start LSP server (for editor integration)
deno run --allow-all melker.ts --lsp
```

See `agent_docs/melker-file-format.md` for syntax details.

## Runtime Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `F12` | Toggle View Source overlay (for .md files: shows Markdown/Melker tabs) |
| `Escape` | Close View Source overlay / Close menus |
| `F10` | Activate menu bar |
| `Ctrl+M` | Alternative menu bar activation |
| `Tab` / `Shift+Tab` | Navigate focusable elements |
- never execute git commands