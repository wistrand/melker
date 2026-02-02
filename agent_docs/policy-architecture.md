# Policy Architecture

The policy system enforces permission sandboxing for .melker applications. Apps declare required permissions, users approve them, and the launcher spawns apps in a restricted Deno subprocess.

## Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  melker.ts CLI  │────▶│ melker-launcher │────▶│  melker-runner  │
│  (entry point)  │     │ (policy + flags)│     │ (sandboxed app) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  Deno subprocess │
                        │  with --allow-*  │
                        │  and --deny-*    │
                        └──────────────────┘
```

**Flow:**
1. User runs `./melker.ts app.melker`
2. Launcher loads and parses policy from file
3. CLI overrides (`--allow-*`/`--deny-*`) are applied
4. User approves policy (first run only, or if policy changed)
5. Launcher spawns `melker-runner.ts` with Deno permission flags
6. Runner executes the app in a sandboxed environment

## Policy Declaration

Apps declare permissions via a `<policy>` tag:

```xml
<policy>
{
  "name": "My App",
  "comment": "Why these permissions are needed",
  "permissions": {
    "read": ["/data", "."],
    "write": ["/output"],
    "net": ["api.example.com"],
    "run": ["ffmpeg"],
    "env": ["API_KEY"],
    "shader": true
  }
}
</policy>
```

Or reference an external file:

```xml
<policy src="policy.json" />
```

## Permission Types

### Array Permissions

These accept a list of allowed values. Use `["*"]` for wildcard (all).

| Permission | Description              | Example                  |
|------------|--------------------------|--------------------------|
| `read`     | Filesystem read paths    | `["/data", "."]`         |
| `write`    | Filesystem write paths   | `["/output"]`            |
| `net`      | Network hosts            | `["api.example.com"]`    |
| `run`      | Subprocess commands      | `["ffmpeg", "git"]`      |
| `env`      | Environment variables    | `["API_KEY", "DEBUG"]`   |
| `ffi`      | FFI library paths        | `["/lib/native.so"]`     |
| `sys`      | System info interfaces   | `["hostname", "uid"]`    |

### Boolean Permissions

These are on/off flags, often shortcuts that expand to multiple permissions.

| Permission  | Description              | Expands To                                        |
|-------------|--------------------------|---------------------------------------------------|
| `all`       | All permissions          | `--allow-all`                                     |
| `ai`        | AI features              | `run: [ffmpeg, ffprobe, ...]` + `net: [openrouter.ai]` |
| `clipboard` | Clipboard access         | `run: [pbcopy, xclip, ...]` (platform-specific)   |
| `keyring`   | Credential storage       | `run: [security, secret-tool, ...]` (platform-specific) |
| `browser`   | Open URLs in browser     | `run: [open, xdg-open, cmd]` (platform-specific)  |
| `shader`    | Per-pixel shader callbacks | Runtime flag only (no Deno flag)                |

### Special Values

| Value        | Meaning                                        |
|--------------|------------------------------------------------|
| `"*"`        | Wildcard - allow all (in array permissions)    |
| `"samesite"` | In `net`, expands to the host of the source URL |

## CLI Permission Overrides

Users can modify permissions at runtime without editing the policy:

```bash
# Add permissions
./melker.ts --allow-read=/data app.melker
./melker.ts --allow-net=api.example.com,cdn.example.com app.melker
./melker.ts --allow-ai app.melker

# Remove permissions
./melker.ts --deny-net=evil.com app.melker
./melker.ts --deny-shader app.melker

# Combine
./melker.ts --allow-ai --deny-net=openrouter.ai app.melker
```

### How Overrides Work

1. **Allow adds** to existing permissions (unless base is already `*`)
2. **Deny removes** from existing permissions
3. **Shortcuts expand first** - `--allow-ai` expands to run/net commands, then denies filter
4. **Wildcard base** - when base is `*`, denies become Deno `--deny-*` flags instead of filtering
5. **Implicit paths filtered** - `--deny-read` and `--deny-write` also filter implicit paths

### Override Precedence

```
deny > allow > policy
```

- `--deny-all` clears everything (checked first)
- `--allow-*` merges with policy
- `--deny-*` filters the result

### Active Denies

When the base permission is wildcard (`*`), denies can't filter the allow list. Instead, they become "active denies" that generate Deno's `--deny-*` flags:

```bash
# Policy has: read: ["*"]
./melker.ts --deny-read=/etc/passwd app.melker
# Generates: --allow-read --deny-read=/etc/passwd
```

## Implicit Paths

The policy system automatically adds certain paths that Melker needs to function:

### Implicit Read Paths
- Temp directory (`/tmp` or `$TMPDIR`) - bundler temp files
- App directory - loading the .melker file
- Current working directory
- XDG state directory (`~/.local/state/melker`) - persistence
- App cache directory (`~/.cache/melker/app-cache/<hash>`)

### Implicit Write Paths
- Temp directory - bundler temp files
- XDG state directory - persistence
- Log directory (`~/.cache/melker/logs`)
- App cache directory

### Implicit Environment Variables
- Basic: `HOME`, `PATH`, `TERM`, `TMPDIR`, etc.
- Terminal detection: `TERM_PROGRAM`, `KITTY_WINDOW_ID`, `TMUX`, etc.
- XDG directories: `XDG_STATE_HOME`, `XDG_CACHE_HOME`, etc.
- Melker internal: `MELKER_RUNNER`, `MELKER_PERMISSION_OVERRIDES`, etc.

### Denying Implicit Paths

When `--deny-read` or `--deny-write` filters an implicit path, a warning is shown:

```
Warning: Denying write access to /tmp (used for bundler temp files) may affect functionality
```

This warns users that denying these paths may break the app.

## Approval System

All .melker files require first-run approval to prevent malicious code execution.

### Local Files
- Policy tag is optional (auto-policy with `all: true` if missing)
- Approval is **policy-hash-based** - code changes don't require re-approval
- Re-approval needed if: policy changes, file moved/renamed

### Remote Files (http:// or https://)
- Policy tag is **mandatory**
- Approval is **content-hash-based** - any change requires re-approval
- Hash includes: content + policy + Deno flags

### Approval Storage

Approvals are stored in `~/.cache/melker/approvals/` as JSON files keyed by hash.

### Bypassing Approval

Use `--trust` for CI/scripts:

```bash
./melker.ts --trust app.melker
```

## Auto-Policy

Local files without a `<policy>` tag get an auto-generated policy:

```json
{
  "name": "<filename> (Auto Policy)",
  "permissions": { "all": true }
}
```

For example, running `app.melker` without an embedded policy shows:
```
App: app.melker (Auto Policy)
```

This grants all permissions but still requires approval on first run.

## Deno Flag Generation

The `policyToDenoFlags()` function converts a policy to Deno CLI flags:

| Policy                 | Deno Flag                    |
|------------------------|------------------------------|
| `all: true`            | `--allow-all`                |
| `read: ["/data"]`      | `--allow-read=/data`         |
| `read: ["*"]`          | `--allow-read`               |
| `net: ["example.com"]` | `--allow-net=example.com`    |
| `run: ["git"]`         | `--allow-run=git`            |
| Active deny            | `--deny-read=/etc/passwd`    |

Additional flags always added:
- `--unstable-bundle` - for Deno.bundle() API
- `--no-prompt` - fail fast instead of interactive permission prompts

## Runtime Permission Checks

Some permissions are checked at runtime, not via Deno flags:

### `shader` Permission

The `shader` permission controls whether `onShader` callbacks can execute on canvas/img elements. Checked via `engine.hasPermission('shader')`.

### `hasPermission()` Method

```typescript
engine.hasPermission('shader')   // true if shader: true in policy
engine.hasPermission('clipboard') // true if clipboard: true
engine.hasPermission('ai')       // true if ai: true
```

The `all: true` permission grants all runtime permissions.

## Passing Overrides to Runner

CLI overrides are applied in the launcher, but the runner also needs them for runtime permission checks (like `hasPermission('shader')`).

The launcher passes overrides via environment variable:

```typescript
// Launcher
env.MELKER_PERMISSION_OVERRIDES = JSON.stringify(overrides);

// Runner
const overrides = JSON.parse(Env.get('MELKER_PERMISSION_OVERRIDES'));
applyPermissionOverrides(policy.permissions, overrides);
```

## Files

| File                                | Purpose                                          |
|-------------------------------------|--------------------------------------------------|
| `src/policy/types.ts`               | `MelkerPolicy`, `PolicyPermissions` types        |
| `src/policy/loader.ts`              | Parse policy from file content                   |
| `src/policy/flags.ts`               | Convert policy to Deno flags, implicit paths     |
| `src/policy/permission-overrides.ts` | CLI `--allow-*`/`--deny-*` handling             |
| `src/policy/approval.ts`            | Approval prompts and storage                     |
| `src/policy/url-utils.ts`           | Extract hosts from URLs for net permissions      |
| `melker-launcher.ts`                | Orchestrates policy loading, approval, subprocess |
| `src/melker-runner.ts`              | Runs in sandbox, applies overrides for runtime   |

## Examples

### Minimal Policy
```xml
<policy>{"permissions": {"net": ["api.example.com"]}}</policy>
```

### Full Policy
```xml
<policy>
{
  "name": "Video Editor",
  "comment": "Needs ffmpeg for transcoding, network for cloud saves",
  "permissions": {
    "read": ["."],
    "write": ["./output"],
    "net": ["api.mycloud.com"],
    "run": ["ffmpeg", "ffprobe"],
    "ai": true,
    "shader": true
  },
  "configSchema": {
    "outputFormat": {
      "type": "string",
      "default": "mp4",
      "env": "VIDEO_OUTPUT_FORMAT"
    }
  }
}
</policy>
```

### CLI Override Examples
```bash
# Add AI features to app without AI in policy
./melker.ts --allow-ai app.melker

# Run AI app without network (offline mode)
./melker.ts --allow-ai --deny-net=openrouter.ai app.melker

# Deny shader for performance testing
./melker.ts --deny-shader app.melker

# Restrict file access
./melker.ts --deny-read=/etc,/var --deny-write=/etc app.melker
```

## See Also

- [melker-file-format.md](melker-file-format.md) - Policy syntax in .melker files
- [config-architecture.md](config-architecture.md) - Configuration system including policy config
- [env-permission-analysis.md](env-permission-analysis.md) - Environment variable permissions
- [project-structure.md](project-structure.md) - File listing for policy/ directory
