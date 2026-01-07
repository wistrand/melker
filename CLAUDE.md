# CLAUDE.md

Guidance for Claude Code when working with Melker.

## Project Overview

**Melker** - *Run text with meaning*

Melker is a Deno library for creating rich Terminal UI interfaces using an HTML-inspired document model. It renders component trees to ANSI terminals using a dual-buffer system.

## Quick Reference

| What | Where |
|------|-------|
| Architecture details | `agent_docs/architecture.md` |
| Elements & layout | `agent_docs/elements-and-layout.md` |
| Debugging & logging | `agent_docs/debugging.md` |
| .melker file format | `agent_docs/melker-file-format.md` |
| Script usage & context | `agent_docs/script_usage.md` |
| Implementation details | `agent_docs/implementation-details.md` |
| AI accessibility | `agent_docs/ai-accessibility.md` |
| Filterable lists | `agent_docs/filterable-list-architecture.md` |
| Fast input rendering | `agent_docs/fast-input-render-plan.md` |
| Examples | `examples/melker/*.melker` |

## Technology Stack

- **Runtime**: Deno 2.5+ (required, Node.js/Bun not supported)
- **Package**: @melker/core
- **Target**: ANSI-compatible terminals

## Development Commands

```bash
deno task dev          # Dev server with watch
deno task test         # Run tests
deno task check        # Type check
```

**Note**: Don't run `deno fmt` or `deno lint` automatically (user preference).

- never execute git add, commit or push commands

## Project Structure

```
melker.ts             - CLI entry point (symlink-safe, runs launcher)
mod.ts                - Library entry point (exports, component registrations)
melker-launcher.ts    - Policy enforcement and subprocess spawning
melker-runner.ts      - .melker file runner (bundling, engine, app execution)
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
  error-boundary.ts   - Error handling, rate limiting, error overlay
  performance-dialog.ts - Live performance stats dialog (Ctrl+Shift+P)
  lint.ts             - Lint mode validation, schemas
  lsp.ts              - Language Server Protocol for .melker files
  oauth.ts            - OAuth utilities
  xdg.ts              - XDG Base Directory support
  state-persistence.ts - State persistence for apps
  terminal-lifecycle.ts - Terminal setup, cleanup, signal handlers
  policy/             - Permission policy system
    mod.ts            - Policy module exports
    types.ts          - Policy type definitions
    loader.ts         - Policy loading from <policy> tag or external file
    flags.ts          - Convert policy to Deno permission flags
  bundler/            - Runtime bundler for .melker files
    mod.ts            - Main bundler exports
    types.ts          - Bundler type definitions
    generator.ts      - TypeScript code generation
    bundle.ts         - Deno.bundle() integration
    errors.ts         - Error translation to source lines
    cache.ts          - Bundle caching
  components/         - Component implementations
    mod.ts            - Component exports
    container.ts      - Flexbox container
    text.ts           - Text display
    input.ts          - Single-line text input
    textarea.ts       - Multi-line text input
    button.ts         - Clickable button
    dialog.ts         - Modal dialog
    list.ts           - List container
    li.ts             - List item
    checkbox.ts       - Toggle checkbox
    radio.ts          - Radio button
    tabs.ts           - Tabbed container
    tab.ts            - Tab panel (child of tabs)
    file-browser.ts   - File system navigation
    canvas.ts         - Pixel graphics (sextant chars), image loading (PNG/JPEG/GIF)
    img.ts            - Image component (extends canvas)
    video.ts          - Video playback
    progress.ts       - Progress bar (extends Canvas)
    markdown.ts       - Markdown rendering
    color-utils.ts    - RGBA color utilities
    filterable-list/  - Filterable list components
      mod.ts          - Module exports
      core.ts         - FilterableListCore base class
      filter.ts       - Fuzzy/prefix/contains/exact algorithms
      option.ts       - OptionElement
      group.ts        - GroupElement
      combobox.ts     - ComboboxElement
      select.ts       - SelectElement
      autocomplete.ts - AutocompleteElement
      command-palette.ts - CommandPaletteElement
  video/              - Video processing
    mod.ts            - Video exports
    ffmpeg.ts         - FFmpeg integration
    dither.ts         - Dithering algorithms
    subtitle.ts       - Subtitle handling
    waveform.ts       - Audio waveform
  chat/               - Chat utilities
    chat-fetch-util.ts - HTTP fetch helpers
  ai/                 - AI accessibility system
    mod.ts            - AI module exports
    openrouter.ts     - OpenRouter API streaming client
    context.ts        - UI context builder for AI
    cache.ts          - Query response cache
    tools.ts          - AI tool system (built-in + custom)
    accessibility-dialog.ts - AI assistant dialog
    audio.ts          - Audio recording and transcription
    macos-audio-record.swift - Native macOS audio capture
  utils/              - Shared utilities
    timing.ts         - Debounce and throttle functions
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
7. **Update component props explicitly** - In .melker files, reactive bindings like `${$app.var}` only work for initial values. To update props dynamically, use `$melker.getElementById('id').props.propName = value`

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `MELKER_THEME` | Theme (default: `auto`): `auto-dark`, `auto-std`, `bw-std`, `fullcolor-dark`, etc. |
| `MELKER_LOG_FILE` | Log file path |
| `MELKER_LOG_LEVEL` | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `MELKER_HEADLESS` | Headless mode for CI |
| `MELKER_DEBUG_PORT` | Debug server port (implies `net: localhost`) |
| `MELKER_ALLOW_REMOTE_INPUT` | Allow browser mirror to send mouse/keyboard events (`true` or `1`) |
| `MELKER_LINT` | Enable lint mode (`true` or `1`) |
| `MELKER_PERSIST` | Enable state persistence (`true` or `1`, default: false) |
| `MELKER_RETAIN_BUNDLE` | Keep temp bundle files for debugging (`true` or `1`) |
| `OPENROUTER_API_KEY` | API key for AI assistant (OpenRouter) |
| `MELKER_AI_MODEL` | AI chat model (default: `openai/gpt-5.2-chat`) |
| `MELKER_AUDIO_MODEL` | AI transcription model (default: `openai/gpt-4o-audio-preview`) |
| `MELKER_AI_ENDPOINT` | API endpoint (default: `https://openrouter.ai/api/v1/chat/completions`) |
| `MELKER_AI_HEADERS` | Custom headers (`name: value; name2: value2`) |
| `MELKER_AUDIO_GAIN` | Audio recording gain multiplier (default: `2.0`) |
| `MELKER_AUDIO_DEBUG` | Replay recorded audio before transcription (`true` or `1`) |
| `MELKER_FFMPEG` | Force ffmpeg on macOS instead of native Swift (`true` or `1`) |
| `MELKER_AUTO_DITHER` | Dither algorithm for `dither="auto"` (e.g., `sierra-stable`, `floyd-steinberg`, `ordered`) |
| `MELKER_DITHER_BITS` | Color depth for auto dithering (1-8, default: theme-based) |
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
# Direct execution (melker.ts has executable shebang)
./melker.ts examples/melker/counter.melker

# Or via deno run
deno run --allow-all melker.ts examples/melker/counter.melker

# From URL
./melker.ts http://localhost:1990/melker/counter.melker

# With lint validation
./melker.ts --lint examples/melker/counter.melker

# Watch mode (auto-reload on file changes, local files only)
./melker.ts --watch examples/melker/counter.melker

# Debug mode (shows bundler info, retains temp files)
./melker.ts --debug examples/melker/counter.melker

# Enable bundle caching (disabled by default)
./melker.ts --cache examples/melker/counter.melker

# Show app policy and exit
./melker.ts --show-policy examples/melker/counter.melker

# Run with full permissions, ignoring declared policy
./melker.ts --trust examples/melker/counter.melker

# Start LSP server (for editor integration)
./melker.ts --lsp
```

**Note:** The launcher automatically spawns a subprocess with `--unstable-bundle` if needed (for Deno's `Deno.bundle()` API).

**Important:** Programmatic runs by agents/scripts must use `--trust` to bypass the interactive approval prompt.

## Installation via Symlink

The CLI can be installed system-wide via symlink:

```bash
ln -s /path/to/melker/melker.ts ~/.local/bin/melker
```

Then run from anywhere:

```bash
melker --trust app.melker
```

The CLI is symlink-safe - it resolves its real path before importing dependencies.

## Library Usage

For programmatic use, import from `mod.ts`:

```typescript
import { createElement, createApp, getTerminalSize } from './mod.ts';
// or from URL: import { ... } from 'https://example.com/melker/mod.ts';

const ui = createElement('container', { style: { border: 'single' } },
  createElement('text', {}, 'Hello World')
);

const app = await createApp(ui);
```

**Note:** `melker.ts` is the CLI entry point only. All library exports are in `mod.ts`.

## App Policies (Permission Sandboxing)

Melker apps can declare required permissions via an embedded `<policy>` tag. When a policy is found, the app runs in a subprocess with only those permissions.

### Declaring a Policy

**Inline JSON:**
```xml
<melker>
  <policy>
  {
    "name": "My App",
    "description": "App description",
    "permissions": {
      "read": ["."],
      "net": ["api.example.com"]
    }
  }
  </policy>
  <!-- UI content -->
</melker>
```

**External file:**
```xml
<policy src="app.policy.json"></policy>
```

### Permission Types

| Permission | Values | Deno Flag |
|------------|--------|-----------|
| `read` | paths or `["*"]` | `--allow-read` |
| `write` | paths or `["*"]` | `--allow-write` |
| `net` | hosts or `["*"]` | `--allow-net` |
| `run` | commands or `["*"]` | `--allow-run` |
| `env` | variables or `["*"]` | `--allow-env` |
| `ffi` | libraries or `["*"]` | `--allow-ffi` |

### Permission Shortcuts

| Shortcut | Description |
|----------|-------------|
| `ai` | AI/media: swift, ffmpeg, ffprobe, pactl, ffplay + openrouter.ai |
| `clipboard` | Clipboard: pbcopy, xclip, xsel, wl-copy, clip.exe |
| `keyring` | Credentials: security, secret-tool, powershell |
| `browser` | Browser opening: open, xdg-open, cmd |
| `shader` | Allow per-pixel shaders on canvas/img elements |

```json
{
  "permissions": {
    "read": ["."],
    "ai": true,
    "clipboard": true,
    "keyring": true,
    "browser": true,
    "shader": true
  }
}
```

### Environment Variables in Policy

Use `${VAR}` or `${VAR:-default}` syntax in policy JSON.

### OAuth Auto-Permissions

When an `<oauth>` tag is present, the policy automatically includes:
- `localhost` in net permissions (callback server)
- `browser: true` (authorization URL)
- All hosts from the wellknown endpoint

### App Approval System

All .melker files require first-run approval (use `--trust` to bypass).

**Local files:**
- Policy tag is optional (uses auto-policy with all permissions if missing)
- Approval is path-based (persists across file edits for dev experience)
- Re-approval only needed if file is moved/renamed

**Remote files (http:// or https://):**
- Policy tag is mandatory (fails without it)
- Approval is hash-based (content + policy + deno flags)
- Re-approval required if app content, policy, or Deno flags change

**Approval management flags:**
```bash
# Clear all cached approvals
deno run --allow-all melker.ts --clear-approvals

# Revoke approval for specific path or URL
deno run --allow-all melker.ts --revoke-approval /path/to/app.melker
deno run --allow-all melker.ts --revoke-approval https://example.com/app.melker

# Show cached approval
deno run --allow-all melker.ts --show-approval /path/to/app.melker
```

### Implicit Permissions

These are always granted (no need to declare):
- **read**: `/tmp`, app directory, XDG state dir, cwd
- **write**: `/tmp`, XDG state dir, log file directory
- **env**: All `MELKER_*` vars, `HOME`, XDG dirs, `TERM`, `COLORTERM`

See `agent_docs/melker-file-format.md` for syntax details.

## Runtime Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+K` | Toggle Command Palette |
| `F6` | Toggle Performance dialog (live stats) |
| `F7` | Open AI assistant with voice input (or toggle recording if open) |
| `F8` | Open AI accessibility assistant (text input) |
| `F12` | Toggle View Source overlay (for .md files: shows Markdown/Melker tabs) |
| `Escape` | Close overlays / Close AI dialog |
| `Tab` / `Shift+Tab` | Navigate focusable elements |
