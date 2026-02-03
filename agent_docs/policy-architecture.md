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

## Implicit Permissions

Melker adds certain permissions automatically because they're required for basic functionality. These are added regardless of policy content—even an empty `permissions: {}` gets them.

### Why Implicit Permissions Exist

Apps shouldn't need to declare permissions for Melker's internal operations. Users shouldn't see "read ~/.cache/melker" in approval prompts for every app. Implicit permissions keep policies focused on what the **app** needs, not what the **framework** needs.

### Implicit Read Paths

| Path | Why |
|------|-----|
| Temp dir | Bundler writes transpiled code here, app must read it |
| App dir | App must read its own .melker file and relative imports |
| `Deno.cwd()` | Enables relative paths like `../media/img.png` |
| `~/.local/state/melker` | Read persisted state from previous runs |
| `~/.cache/melker/app-cache/{hash}` | Read cached remote imports (when urlHash provided) |

### Implicit Write Paths

| Path | Why |
|------|-----|
| Temp dir | Bundler writes transpiled code here |
| `~/.local/state/melker` | Persist app state across runs |
| `~/.cache/melker/logs` | Write log files (viewable via F12) |
| `~/.cache/melker/app-cache/{hash}` | Cache remote imports (when urlHash provided) |

**Note:** CWD is implicit for **read** but not **write**. Apps that need to write files must declare it explicitly in policy.

### Implicit Net Permissions

| Host | Condition |
|------|-----------|
| `localhost` | When `debugPort` is configured (debug server needs it) |

### Implicit Environment Variables

Always allowed: `HOME`, `PATH`, `TERM`, `TMPDIR`, terminal detection vars (`KITTY_WINDOW_ID`, `TMUX`, etc.), XDG vars, `MELKER_*` vars.

### Interaction with Policies

| Policy | Effective Permissions |
|--------|---------------------------|
| No `<policy>` tag (local) | Auto-policy `read: ["cwd"], clipboard: true` + implicit paths |
| `permissions: {}` | Implicit paths only (includes cwd) |
| `read: ["cwd"]` | Same as above (cwd already implicit) |
| `read: ["/data"]` | `/data` + implicit paths |
| `read: ["*"]` | `--allow-read` (bypasses implicit path logic) |

The `cwd` value in auto-policy is technically redundant since cwd is already implicit, but it serves as documentation—users see "read: cwd" in the approval prompt, making the permission explicit. The `clipboard` shortcut enables text selection copy via Alt+C.

### Denying Implicit Paths

Implicit paths can be denied via CLI, but this may break the app:

```bash
./melker.ts --deny-write=/tmp app.melker
# Warning: Denying write access to /tmp (used for bundler temp files) may affect functionality
```

The warning is printed to stderr so users understand the risk.

## Approval System

All .melker files require first-run approval to prevent malicious code execution.

### Local Files
- Policy tag is optional (auto-policy with `read: ["cwd"], clipboard: true` if missing)
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

### CLI Overrides in Approval Prompt

When CLI permission overrides (`--allow-*`/`--deny-*`) are specified, they are shown in the approval prompt:

```
Requested permissions:
  read: cwd (/home/user/project)
  clipboard: enabled (xclip)

CLI overrides (will modify permissions at runtime):
  --deny-clipboard
```

- The approval is for the **base policy** - CLI overrides are applied at runtime
- This ensures users understand what the app requests vs. what will actually be granted

## Auto-Policy

Local files without a `<policy>` tag get an auto-generated policy:

```json
{
  "name": "<filename> (Auto Policy)",
  "description": "Default policy - read access to working directory, clipboard access",
  "permissions": { "read": ["cwd"], "clipboard": true }
}
```

For example, running `app.melker` without an embedded policy shows:
```
App: app.melker (Auto Policy)
Description: Default policy - read access to working directory, clipboard access

Requested permissions:
  read: cwd (/home/user/project)
  clipboard: enabled (xclip)
```

This grants read access to the current working directory (where melker was invoked), allowing relative paths like `../../media/image.png` to work as long as they resolve to paths under cwd. Clipboard access allows text selection copy (Alt+C). Network, write, and other subprocess permissions require an explicit policy.

## Deno Flag Generation

The `policyToDenoFlags()` function converts a policy to Deno CLI flags:

| Policy                 | Deno Flag                    |
|------------------------|------------------------------|
| `all: true`            | `--allow-all`                |
| `read: ["cwd"]`        | `--allow-read=<cwd>`         |
| `read: ["/data"]`      | `--allow-read=/data`         |
| `read: ["*"]`          | `--allow-read`               |
| `write: ["cwd"]`       | `--allow-write=<cwd>`        |
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

### `cwd` Special Value

The special value `"cwd"` in `read` or `write` arrays expands to the current working directory at runtime. This allows relative paths in the app to work as long as they resolve within the project directory:

```json
{
  "permissions": {
    "read": ["cwd", "/etc/hosts"],
    "write": ["cwd"]
  }
}
```

Use `--deny-read=cwd` or `--deny-write=cwd` to remove cwd access.

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
