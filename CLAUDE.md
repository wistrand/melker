# CLAUDE.md

Guidance for Claude Code when working with Melker.

## Project Overview

**Melker** - *Run text with meaning*

Website: https://melker.sh

Melker is a Deno library for creating rich Terminal UI interfaces using an HTML-inspired document model. It renders component trees to ANSI terminals using a dual-buffer system.

## Quick Reference

| What                | Where                                                      |
|---------------------|------------------------------------------------------------|
| Getting started     | [getting-started.md](agent_docs/getting-started.md)        |
| .melker file format | [melker-file-format.md](agent_docs/melker-file-format.md)  |
| First app tutorial  | [tutorial.html](docs/tutorial.html)                        |
| Examples            | [examples/](examples/) (basics, components, layout, canvas) |
| **AI Agent Skill**  | [skills/creating-melker-apps/](skills/creating-melker-apps/) |

## Documentation Index

### For App Developers

| Topic                          | Doc                                                    |
|--------------------------------|--------------------------------------------------------|
| Script context ($melker, $app) | [script_usage.md](agent_docs/script_usage.md)          |
| Graphics modes                 | [gfx-modes.md](agent_docs/gfx-modes.md)                |
| Debugging & logging            | [debugging.md](agent_docs/debugging.md)                |
| Common mistakes                | [dx-footguns.md](agent_docs/dx-footguns.md)            |
| AI assistant                   | [ai-accessibility.md](agent_docs/ai-accessibility.md)  |

### Component Reference

| Component                                         | Doc                                                                            |
|---------------------------------------------------|--------------------------------------------------------------------------------|
| Filterable lists (combobox, select, autocomplete) | [filterable-list-architecture.md](agent_docs/filterable-list-architecture.md)  |
| File browser                                      | [file-browser-architecture.md](agent_docs/file-browser-architecture.md)        |
| Data table                                        | [data-table.md](agent_docs/data-table.md)                                      |
| Data bars (charts)                                | [data-bars.md](agent_docs/data-bars.md)                                        |
| Data heatmap                                      | [data-heatmap-architecture.md](agent_docs/data-heatmap-architecture.md)        |
| Split pane                                        | [split-pane-architecture.md](agent_docs/split-pane-architecture.md)            |
| Spinner                                           | [spinner-architecture.md](agent_docs/spinner-architecture.md)                  |
| Toast notifications                               | [toast-architecture.md](agent_docs/toast-architecture.md)                      |
| Tooltips                                          | [tooltip-architecture.md](agent_docs/tooltip-architecture.md)                  |
| Mermaid diagrams in markdown                      | [mermaid-support.md](agent_docs/mermaid-support.md)                            |

### For Contributors (Internals)

| Topic               | Doc                                                                  |
|---------------------|----------------------------------------------------------------------|
| Project structure   | [project-structure.md](agent_docs/project-structure.md)              |
| Core architecture   | [architecture.md](agent_docs/architecture.md)                        |
| Component reference | [component-reference.md](agent_docs/component-reference.md)          |
| Config system       | [config-architecture.md](agent_docs/config-architecture.md)          |
| Policy system       | [policy-architecture.md](agent_docs/policy-architecture.md)          |
| Server              | [server-architecture.md](agent_docs/server-architecture.md)          |
| Graph/diagrams      | [graph-architecture.md](agent_docs/graph-architecture.md)            |
| Graphics pipeline   | [graphics-architecture.md](agent_docs/graphics-architecture.md)      |
| Isolines mode       | [isolines-architecture.md](agent_docs/isolines-architecture.md)      |
| Sixel protocol      | [sixel-architecture.md](agent_docs/sixel-architecture.md)            |
| Kitty protocol      | [kitty-architecture.md](agent_docs/kitty-architecture.md)            |
| iTerm2 protocol     | [iterm2-architecture.md](agent_docs/iterm2-architecture.md)          |
| Benchmarks          | [benchmark-architecture.md](agent_docs/benchmark-architecture.md)    |
| Media queries       | [architecture-media-queries.md](agent_docs/architecture-media-queries.md) |

### Deep Dives

| Topic              | Doc                                                                  |
|--------------------|----------------------------------------------------------------------|
| Dirty row tracking | [dirty-row-tracking.md](agent_docs/dirty-row-tracking.md)            |
| Fast input render  | [fast-input-render.md](agent_docs/fast-input-render.md)              |
| Env permissions    | [env-permission-analysis.md](agent_docs/env-permission-analysis.md)  |
| Layout engine      | [layout-engine-notes.md](agent_docs/layout-engine-notes.md)          |

### Examples & Patterns

| Example    | Doc                                        |
|------------|--------------------------------------------|
| Map viewer | [map-example.md](agent_docs/map-example.md) |

### Project

| Topic          | Doc                                                    |
|----------------|--------------------------------------------------------|
| Timeline       | [project-timeline.md](agent_docs/project-timeline.md)  |
| Release scheme | [calver-release.md](agent_docs/calver-release.md)      |
| TUI comparison | [tui-comparison.md](agent_docs/tui-comparison.md)      |

## Technology Stack

- **Runtime**: Deno 2.5+ (required, Node.js/Bun not supported)
- **Package**: @melker/core
- **Target**: ANSI-compatible terminals

## Development Commands

```bash
deno task dev          # Dev server with watch
deno task test         # Run tests
deno task check        # Type check
deno task skill:zip    # Build AI agent skill zip
```

**Capture script** (screenshots/videos for docs):
```bash
./scripts/capture.ts              # Run with default config
./scripts/capture.ts --dry-run    # Preview what would be captured
./scripts/capture.ts config.json  # Use custom config
```
Requires: `xorg-server-xvfb`, `imagemagick`, `ffmpeg`, `kitty`

**Note**: Don't run `deno fmt` or `deno lint` automatically (user preference).

- never execute git add, commit or push commands

## Project Structure

| Path                 | Purpose                                     |
|----------------------|---------------------------------------------|
| `melker.ts`          | CLI entry point (symlink-safe)              |
| `mod.ts`             | Library entry point (all exports)           |
| `melker-launcher.ts` | Policy enforcement, subprocess spawning     |
| `src/engine.ts`      | Main engine, lifecycle, events              |
| `src/layout.ts`      | Flexbox layout calculations                 |
| `src/rendering.ts`   | Render pipeline, overlays                   |
| `src/components/`    | UI component implementations                |
| `src/policy/`        | Permission policy system                    |
| `src/config/`        | Schema-driven configuration                 |
| `src/bundler/`       | Runtime bundler for .melker files           |
| `src/sixel/`         | Sixel graphics support                      |
| `src/kitty/`         | Kitty graphics support                      |
| `src/ai/`            | AI accessibility system                     |
| `agent_docs/`        | Documentation for AI agents                 |
| `examples/`          | Example apps (showcase, basics, components, layout, canvas, melker) |

See [project-structure.md](agent_docs/project-structure.md) for detailed file listing.

## Code Style

2-space indent, single quotes, semicolons, 100 char width.

## Documentation Style

- **Use markdown links** for file references: `[doc.md](path/to/doc.md)` not `` `path/to/doc.md` ``
- **Align table columns** by padding cells to consistent widths:
  ```markdown
  | Name    | Description              |
  |---------|--------------------------|
  | `foo`   | Short description        |
  | `bar`   | Another description here |
  ```

## Critical Rules

1. **NO console.log in Melker source code** - When developing Melker itself (files in `src/`, `mod.ts`, `melker-*.ts`), **NEVER use `console.log()`**. This is strictly forbidden. Always use the logging system: `logger.debug()`, `logger.info()`, `logger.warn()`, `logger.error()`. Only app code (`.melker` files, examples) can use the overridden `console.log()` which redirects to the logger.
2. **Console redirects to logger (app code only)** - In `.melker` app code, `console.log()` redirects to `$melker.logger.info()` (won't break TUI), but prefer explicit `$melker.logger.debug()` etc.
3. **`alert()` shows a modal dialog** - Works like browser alert but as a TUI dialog (dismiss with OK button or Escape)
4. **Button label** - Use `<button>Label</button>` or `label="Label"` (not `title`)
5. **Don't add border to buttons** - Buttons render with `[ ]` brackets by default; adding border creates `[ [ Button ] ]`
6. **Avoid specifying colors** - Let the theme engine handle colors for best appearance across themes
7. **Input type is `'input'`** - Not `'text-input'`
8. **Auto-render in .melker handlers** - Event handlers auto-render after completion (call `$melker.skipRender()` to skip)
9. **Avoid emojis** - They break terminal layout
10. **Update component props explicitly** - In .melker files, there are no reactive bindings like `${$app.var}` . To update props dynamically, use `$melker.getElementById('id').props.propName = value`
11. **flex-direction is a style** - Use `style="flex-direction: row"` not `direction="row"`. Wrap select/combobox in row container to prevent cross-axis stretching.
12. **Primitive exports are copied by value** - `$app.varName = value` modifies a copy, not the original. Use setter functions: `export function setVar(v) { varName = v; }`

## Environment Variables

| Variable                     | Purpose                                                                                                                                                            |
|------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `MELKER_THEME`               | Theme (default: `auto`): `auto-dark`, `auto-std`, `bw-std`, `fullcolor-dark`, etc.                                                                                 |
| `MELKER_LOG_FILE`            | Log file path                                                                                                                                                      |
| `MELKER_LOG_LEVEL`           | `DEBUG`, `INFO`, `WARN`, `ERROR`                                                                                                                                   |
| `MELKER_LOG_BUFFER_SIZE`     | In-memory log buffer size for DevTools Log tab (default: 500, range: 10-10000)                                                                                     |
| `MELKER_HEADLESS`            | Headless mode for CI                                                                                                                                               |
| `MELKER_STDOUT_WIDTH`        | Stdout mode output width (default: terminal width)                                                                                                                 |
| `MELKER_STDOUT_HEIGHT`       | Stdout mode output height (default: terminal height)                                                                                                               |
| `MELKER_STDOUT_TIMEOUT`      | Stdout mode wait time in ms before output (default: 500)                                                                                                           |
| `MELKER_STDOUT_COLOR`        | ANSI color output: `auto` (strip when piped), `always` (force colors), `never` (no colors)                                                                         |
| `MELKER_STDOUT_TRIM`         | Trim stdout output: `none` (default), `right` (trailing spaces), `bottom` (trailing newlines), `both`                                                              |
| `MELKER_NO_ALTERNATE_SCREEN` | Disable alternate screen buffer (`true` or `1`)                                                                                                                    |
| `MELKER_SERVER`              | Enable the remote viewing server — prefer `--server` flag                                                                                                          |
| `MELKER_SERVER_PORT`         | Server port — prefer `--server-port` flag                                                                                                                          |
| `MELKER_SERVER_HOST`         | Server bind address (default: `localhost`)                                                                                                                         |
| `MELKER_SERVER_TOKEN`        | Server connection token — prefer `--server-token` flag                                                                                                             |
| `MELKER_ALLOW_SERVER_INPUT`  | Allow server clients to send mouse/keyboard events — prefer `--server-allow-input` flag                                                                            |
| `MELKER_LINT`                | Enable lint mode (`true` or `1`)                                                                                                                                   |
| `MELKER_NO_CONSOLE_OVERRIDE` | Disable console.log redirect to logger (`true` or `1`)                                                                                                             |
| `MELKER_PERSIST`             | Enable state persistence (`true` or `1`, default: false)                                                                                                           |
| `MELKER_RETAIN_BUNDLE`       | Keep temp bundle files for debugging (`true` or `1`)                                                                                                               |
| `OPENROUTER_API_KEY`         | API key for AI assistant (OpenRouter)                                                                                                                              |
| `MELKER_AI_MODEL`            | AI chat model (default: `openai/gpt-5.2-chat`)                                                                                                                     |
| `MELKER_AUDIO_MODEL`         | AI transcription model (default: `openai/gpt-4o-audio-preview`)                                                                                                    |
| `MELKER_AI_ENDPOINT`         | API endpoint (default: `https://openrouter.ai/api/v1/chat/completions`)                                                                                            |
| `MELKER_AI_HEADERS`          | Custom headers (`name: value; name2: value2`)                                                                                                                      |
| `MELKER_AUDIO_GAIN`          | Audio recording gain multiplier (default: `2.0`)                                                                                                                   |
| `MELKER_AUDIO_DEBUG`         | Replay recorded audio before transcription (`true` or `1`)                                                                                                         |
| `MELKER_FFMPEG`              | Force ffmpeg on macOS instead of native Swift (`true` or `1`)                                                                                                      |
| `MELKER_AUTO_DITHER`         | Dither algorithm for `dither="auto"` (e.g., `sierra-stable`, `floyd-steinberg`, `atkinson`, `blue-noise`, `ordered`)                                               |
| `MELKER_DITHER_BITS`         | Color depth for auto dithering (1-8, default: theme-based)                                                                                                         |
| `MELKER_BLUE_NOISE_PATH`     | Path to blue noise threshold matrix PNG (default: bundled `media/blue-noise-64.png`)                                                                               |
| `MELKER_GFX_MODE`            | Graphics mode: `sextant` (default), `block` (colored spaces), `pattern` (ASCII spatial), `luma` (ASCII brightness), `sixel` (true pixels, auto-disabled in tmux/SSH) |
| `XDG_STATE_HOME`             | Override state dir (default: `~/.local/state`)                                                                                                                     |
| `XDG_CONFIG_HOME`            | Override config dir (default: `~/.config`)                                                                                                                         |
| `XDG_CACHE_HOME`             | Override cache dir (default: `~/.cache`)                                                                                                                           |

## XDG Base Directory Spec

Melker follows the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir/latest/):

| Directory | Default                    | Purpose                   |
|-----------|----------------------------|---------------------------|
| State     | `~/.local/state/melker/`   | Persisted app state       |
| Config    | `~/.config/melker/`        | User configuration        |
| Cache     | `~/.cache/melker/`         | Non-essential cached data |
| Data      | `~/.local/share/melker/`   | User data files           |

## Configuration System

Configuration is schema-driven (`src/config/schema.json`) with layered overrides.

**Priority order (lowest to highest):**
1. Schema defaults
2. Policy config (per-app `<policy>` tag)
3. File config (`~/.config/melker/config.json`)
4. Environment variables
5. CLI flags (highest - explicit user intent)

```bash
# Show current config with sources (includes app-defined config)
./melker.ts --print-config

# CLI flags override everything
MELKER_THEME=fullcolor-dark ./melker.ts --theme bw-std  # uses bw-std
```

**App-defined config**: Apps can define custom config in policy with optional env var overrides via `configSchema`. Env vars in `configSchema` are auto-added to subprocess permissions.

See [config-architecture.md](agent_docs/config-architecture.md) for full details.

## Running .melker Files

```bash
./melker.ts app.melker              # Direct execution
./melker.ts diagram.mmd             # Run mermaid file directly (no approval needed)
./melker.ts --watch app.melker      # Auto-reload on changes
./melker.ts --trust app.melker      # CI/scripts (bypass approval prompt)
./melker.ts --verbose app.melker    # Verbose mode
./melker.ts --test-sextant          # Test terminal sextant character support
./melker.ts --stdout app.melker     # Output single frame to stdout and exit
./melker.ts --interactive app.melker # Force TUI mode even when piped
./melker.ts --color=always app.melker # Force ANSI colors even when piped
./melker.ts --lsp                   # Start LSP server

# Permission overrides (add/remove permissions from policy)
./melker.ts --allow-net=api.example.com app.melker  # Add network permission
./melker.ts --deny-read=/etc/passwd app.melker      # Deny specific path
./melker.ts --allow-ai app.melker                   # Enable AI shortcut
./melker.ts --allow-ai --deny-net=openrouter.ai app.melker  # AI without network
```

**Mermaid files:** Plain `.mmd` files can be run directly and require no permissions or approval prompts.

**Important:** Use `--trust` for CI and automated scripts to bypass interactive approval.

**Piping:** When stdout is not a TTY (piped or redirected), Melker automatically renders a single frame with plain text (no ANSI codes) and exits. Use `--interactive` to force TUI mode, or `--color=always` to keep ANSI codes.

```bash
./melker.ts app.melker > snapshot.txt       # Auto-detects non-TTY, plain text
./melker.ts app.melker | grep "Error"       # Plain text output
./melker.ts --interactive app.melker | cat  # Force TUI mode
./melker.ts --color=always app.melker | less -R  # Keep ANSI colors
```

**Stdout mode:** `--stdout` explicitly enables single-frame output. Options: `--stdout-width`, `--stdout-height`, `--stdout-timeout`, `--color`.

See [getting-started.md](agent_docs/getting-started.md) for full CLI options, Deno flags, and remote execution.

## Installation via Symlink

The CLI can be installed system-wide via symlink:

```bash
ln -s /path/to/melker/melker.ts ~/.local/bin/melker
```

Then run from anywhere:

```bash
melker app.melker
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

Apps declare permissions via `<policy>` tag, running in a sandboxed subprocess:

```xml
<policy>{"permissions": {"read": ["."], "net": ["api.example.com"]}}</policy>
```

**Permission shortcuts:** `ai`, `clipboard`, `keyring`, `browser`, `shader`

**Approval:** All apps require first-run approval. Use `--trust` for CI/scripts. CLI overrides (`--allow-*`/`--deny-*`) are shown in the approval prompt so users see what will be modified.

**CLI Permission Overrides:** Use `--allow-*` and `--deny-*` flags to modify permissions at runtime:

| Flag                     | Description                                      |
|--------------------------|--------------------------------------------------|
| `--allow-read=PATH`      | Add read permission for PATH                     |
| `--deny-read=PATH`       | Remove read permission for PATH                  |
| `--allow-net=HOST`       | Add network permission for HOST                  |
| `--deny-net=HOST`        | Remove network permission for HOST               |
| `--allow-run=CMD`        | Add subprocess permission for CMD                |
| `--deny-run=CMD`         | Remove subprocess permission for CMD             |
| `--allow-ai`             | Enable AI shortcut (ffmpeg, openrouter.ai, etc.) |
| `--deny-ai`              | Disable AI shortcut                              |
| `--allow-all`            | Grant all permissions                            |
| `--deny-all`             | Revoke all permissions                           |

Multiple values can be comma-separated: `--allow-net=api.example.com,cdn.example.com`

When base permission is `*` (wildcard), `--deny-*` generates Deno's `--deny-*` flags instead of filtering.

`--deny-read` and `--deny-write` also filter implicit paths (temp dir, state dir, cache). A warning is shown when denying implicit paths.

See [melker-file-format.md](agent_docs/melker-file-format.md) for full policy syntax and permissions.

## AI Agent Skill

An AI agent skill for creating .melker apps is available at `skills/creating-melker-apps/`.

### Skill Contents

| File                  | Purpose                                            |
|-----------------------|----------------------------------------------------|
| `SKILL.md`            | Main instructions, critical rules, quick start guide |
| `COMPONENTS.md`       | Complete component reference (20+ components)      |
| `EXAMPLES.md`         | 11 complete working examples and best practices    |
| `TYPES.md`            | TypeScript types for `$melker`, `Element`, events  |
| `TROUBLESHOOTING.md`  | Common errors, debug strategies                    |

### Building the Skill Zip

```bash
deno task skill:zip
```

Creates `docs/skill-creating-melker-apps.zip`, available at https://melker.sh/skill-creating-melker-apps.zip

### Key Guidance in Skill

- **Don't add border to buttons** - Buttons render with `[ ]` brackets by default
- **Avoid specifying colors** - Let the theme engine handle styling
- **Console redirects to logger** - `console.log()` redirects to `$melker.logger` (F12 shows log location)
- **Button label** - Use `<button>Label</button>` or `label="Label"` (not `title`)

## Runtime Keyboard Shortcuts

| Key                 | Action                                                                       |
|---------------------|------------------------------------------------------------------------------|
| `Ctrl+K`            | Toggle Command Palette                                                       |
| `Alt+C` / `Alt+N`   | Copy text selection to clipboard (shows toast on success/failure)            |
| `F6`                | Toggle Performance dialog (live stats)                                       |
| `F7`                | Open AI assistant with voice input (or toggle recording if open)             |
| `F8`                | Open AI accessibility assistant (text input)                                 |
| `F12`               | Toggle Dev Tools overlay (source, policy, config, inspect, log, system info) |
| `Escape`            | Close overlays / Close AI dialog                                             |
| `Tab` / `Shift+Tab` | Navigate focusable elements                                                  |

## Releases

Melker uses CalVer with format `YYYY.MM.PATCH` (e.g., `v2026.01.1`). Releases are git tags only.

```bash
# For humans only—do not run as agent
git tag -a v2026.01.1 -m "v2026.01.1"
git push origin main --tags
```

See [calver-release.md](agent_docs/calver-release.md) for details.
