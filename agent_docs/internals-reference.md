# Internals Reference

## Environment Variables

| Variable                     | Purpose                                                                                                                                                            |
|------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `MELKER_THEME`               | Theme (default: `auto`): `auto-dark`, `auto-std`, `bw-std`, `gray-dark`, `color16-dark`, `color-dark`, `fullcolor-dark`, etc.                                      |
| `MELKER_THEME_FILE`          | Path to custom theme CSS file (overrides theme selection)                                                                                                          |
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
| `MELKER_DYNAMIC_ASSETS`      | Read assets from source files instead of embedded data (`true` or `1`, development)                                                                                |
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
| `MELKER_BLUE_NOISE_PATH`     | Path to custom blue noise threshold matrix PNG (default: embedded 64x64 matrix)                                                                                    |
| `MELKER_NO_ANIMATE_GIF`      | Disable animated GIF playback (`true` or `1`)                                                                                                                      |
| `MELKER_GFX_MODE`            | Graphics mode: `sextant` (default), `halfblock` (auto on TERM=linux), `block` (colored spaces), `pattern` (ASCII spatial), `luma` (ASCII brightness), `sixel` (true pixels) |
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

See [config-architecture.md](config-architecture.md) for full details including app-defined config schemas, the MelkerConfig API, and script access via `$melker.config`.

## Lockfile Hygiene

`deno.lock` contains **only runtime dependencies**. Dev-only deps (LSP's `vscode-languageserver`, test helpers) are kept out to avoid downloading them when users run apps.

**How it works:**

| Scope      | Lockfile         | Why                                                        |
|------------|------------------|------------------------------------------------------------|
| App runner | `deno.lock`      | Integrity checks for runtime npm/jsr deps                  |
| Tests      | `--no-lock`      | Prevents `tests/lsp_test.ts` from adding LSP deps to lock  |
| LSP server | `--no-lock`      | Separate entry point (`src/lsp.ts`), heavy deps stay out   |
| Schema     | `deno.lock`      | Uses runner, same runtime deps                             |

**Regenerating the lockfile** (if it gets polluted):
```bash
rm deno.lock && deno cache melker.ts src/melker-runner.ts
```

**Architecture note:** The LSP server (`src/lsp.ts`) is a standalone entry point invoked directly by the launcher — it is NOT imported (statically or dynamically) by `src/melker-runner.ts`. This prevents Deno from discovering `npm:vscode-languageserver` in the runner's module graph.

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
| `completions/`       | Auto-generated Bash/Zsh shell completions   |
| `examples/`          | Example apps (showcase, basics, components, layout, canvas, melker) |

See [project-structure.md](project-structure.md) for detailed file listing.

## AI Agent Skill

An AI agent skill for creating .melker apps is available at `skills/creating-melker-apps/`.

| File                  | Purpose                                            |
|-----------------------|----------------------------------------------------|
| `SKILL.md`            | Main instructions, critical rules, quick start guide |
| `COMPONENTS.md`       | Complete component reference (20+ components)      |
| `EXAMPLES.md`         | 11 complete working examples and best practices    |
| `TYPES.md`            | TypeScript types for `$melker`, `Element`, events  |
| `TROUBLESHOOTING.md`  | Common errors, debug strategies                    |

Build with `deno task build:skill`. Creates `docs/skill-creating-melker-apps.zip`, available at https://melker.sh/skill-creating-melker-apps.zip

The skill enforces the same guidelines as Critical Rules in [CLAUDE.md](../CLAUDE.md).

## Releases

Melker uses CalVer with format `YYYY.MM.PATCH` (e.g., `v2026.01.1`). Releases are git tags only.

```bash
# For humans only—do not run as agent
git tag -a v2026.01.1 -m "v2026.01.1"
git push origin main --tags
```

See [calver-release.md](calver-release.md) for details.
