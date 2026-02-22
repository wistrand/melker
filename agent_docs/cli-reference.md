# CLI Reference

## Installation

### Symlink (git checkout)

```bash
ln -s /path/to/melker/melker.ts ~/.local/bin/melker
```

The CLI is symlink-safe - it resolves its real path before importing dependencies.

### JSR (alternative)

```bash
deno install -g -A jsr:@wistrand/melker
```

`-A` grants permissions to the launcher — apps run sandboxed with only the permissions they declare.

## Subcommands

```bash
melker examples    # Show showcase example commands
melker info        # Show installation info
melker upgrade     # Upgrade (git pull or JSR reinstall)
```

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

See [getting-started.md](getting-started.md) for full CLI options, Deno flags, and remote execution.

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

See [melker-file-format.md](melker-file-format.md) for full policy syntax and [policy-architecture.md](policy-architecture.md) for the permission system internals.

## Shell Completions

Tab completions are available for Bash and Zsh, auto-generated from the config schema.

```bash
# Bash (add to ~/.bashrc):
source /path/to/melker/completions/melker.bash

# Zsh (add to ~/.zshrc):
source /path/to/melker/completions/melker.zsh
# Or copy to fpath:
cp completions/melker.zsh ~/.zsh/completions/_melker
```

Completions include all CLI flags with enum value completion (e.g., `--gfx-mode <TAB>` shows all modes) and file type filtering (`.melker`, `.mmd`, `.md`).

Regenerate after adding new flags: `deno task build:completions`

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
| `Tab` / `Shift+Tab` | Navigate focusable elements (linear tab order)                               |
| Arrow keys          | Geometric focus navigation (nearest element in direction)                    |
| `Shift+Arrow`       | Geometric focus navigation bypassing scroll containers                       |

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
