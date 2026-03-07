# Environment Variable Permission Handling Analysis

Analysis of how Melker handles environment variable permissions in the subprocess sandbox.

## Architecture Overview

### Flow

```
melker-launcher.ts (--allow-all)
    ↓
policyToDenoFlags() in flags.ts
    ↓
buildEnvVars() → getImplicitEnvVars()
    ↓
Generates --allow-env=VAR1,VAR2,...
    ↓
Subprocess spawned with restricted permissions
    ↓
At runtime: Env.get() handles permission errors
```

### Key Files

| File                  | Purpose                                   |
|-----------------------|-------------------------------------------|
| `melker-launcher.ts`  | Spawns subprocess with permission flags   |
| `src/policy/flags.ts` | Converts policy to Deno permission flags  |
| `src/env.ts`          | Safe env var access with permission caching |
| `src/config/config.ts` | Schema-driven config reads env vars      |
| `src/xdg.ts`          | XDG directory lookups                     |

## Environment Variable Categories

### Always Allowed (ALWAYS_ALLOWED_ENV)

These are always whitelisted regardless of whether they're set:

```typescript
const ALWAYS_ALLOWED_ENV = [
  // Basic terminal/system vars
  'HOME', 'USERPROFILE', 'TERM', 'COLORTERM', 'COLORFGBG', 'NO_COLOR', 'PREFIX',
  'TMPDIR', 'TEMP', 'TMP', 'PATH',
  // Set by launcher after permission flags are built
  'MELKER_RUNNER',
  'MELKER_REMOTE_URL',
  // Set at runtime by headless mode
  'MELKER_RUNNING_HEADLESS',
];
```

### Dynamically Discovered

Added to allow list only if present in parent environment:

- `MELKER_*` - All Melker config vars
- `XDG_*` - XDG Base Directory vars
- `OPENROUTER_API_KEY` - AI API key
- `DOTENV_KEY` - Dotenv encryption key

### Policy-Declared

Apps can declare additional env vars in policy:

```json
{
  "permissions": {
    "env": ["MY_API_KEY", "MY_SECRET"]
  }
}
```

### ConfigSchema Auto-Added

Env vars from `configSchema` are automatically whitelisted:

```json
{
  "configSchema": {
    "myapp.apiUrl": {
      "type": "string",
      "env": "MYAPP_API_URL"
    }
  }
}
```

## Permission Denial Handling

The `Env` class in `src/env.ts` wraps `Deno.env.get()` to handle permission denials gracefully:

```typescript
static get(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    // Permission denied - log and return undefined
    if (name.startsWith('MELKER_') || name.startsWith('XDG_')) {
      logger.debug(`Env var not permitted: ${name}`);
    } else {
      logger.warn(`Access denied for env var: ${name} (add to policy permissions or configSchema)`);
    }
    return undefined;
  }
}
```

### Logging Levels

| Pattern    | Log Level | Reason                                    |
|------------|-----------|-------------------------------------------|
| `MELKER_*` | DEBUG     | Expected internal config checks           |
| `XDG_*`    | DEBUG     | Expected XDG directory lookups            |
| Other      | WARN      | Likely app trying to access undeclared var |

## Known Behaviors

### Unset Variables Return Undefined

If a MELKER_* var is not set in the parent environment:
1. It won't be in the subprocess allow list
2. Subprocess gets permission denied when checking
3. `Env.get()` returns `undefined` (same as "not set")
4. Logged at DEBUG level (not a problem)

### All Parent Vars Passed to Subprocess

```typescript
// melker-launcher.ts
env: {
  ...Deno.env.toObject(),
  MELKER_RUNNER: '1',
},
```

All parent env vars are passed to subprocess. The `--allow-env=X,Y,Z` only controls which vars the subprocess can READ. This is Deno's design - env vars can't be filtered, only read-restricted.

### MelkerConfig Auto-Initialization

When `policyToDenoFlags()` calls `MelkerConfig.get()`:
- Config auto-initializes if not already initialized
- Reads schema defaults and env vars
- Policy config and CLI flags are NOT applied at this point
- This is fine because env vars (like `MELKER_SERVER_PORT`) are still read

## Schema-Defined Env Vars

From `src/config/schema.json`, these MELKER_* vars may be checked:

| Var                          | Purpose                        |
|------------------------------|--------------------------------|
| `MELKER_THEME`               | Color theme                    |
| `MELKER_LOG_LEVEL`           | Log verbosity                  |
| `MELKER_LOG_FILE`            | Log file path                  |
| `MELKER_LOG_BUFFER_SIZE`     | DevTools log buffer            |
| `MELKER_AI_MODEL`            | AI chat model                  |
| `MELKER_AUDIO_MODEL`         | Audio transcription model      |
| `MELKER_AI_ENDPOINT`         | AI API endpoint                |
| `MELKER_AI_HEADERS`          | Custom API headers             |
| `MELKER_AI_SITE_NAME`        | Site name for AI API           |
| `MELKER_AI_SITE_URL`         | Site URL for AI API            |
| `MELKER_AUDIO_GAIN`          | Audio recording gain           |
| `MELKER_AUTO_DITHER`         | Dithering algorithm            |
| `MELKER_DITHER_BITS`         | Color depth for dithering      |
| `MELKER_BLUE_NOISE_PATH`     | Blue noise matrix path         |
| `MELKER_NO_ALTERNATE_SCREEN` | Alternate screen toggle        |
| `MELKER_NO_SYNC`             | Sync rendering toggle          |
| `MELKER_FFMPEG`              | Force FFmpeg on macOS          |
| `MELKER_GFX_MODE`            | Graphics rendering mode        |
| `MELKER_HEADLESS`            | Headless mode                  |
| `MELKER_HEADLESS_WIDTH`      | Virtual terminal width         |
| `MELKER_HEADLESS_HEIGHT`     | Virtual terminal height        |
| `MELKER_SERVER_PORT`         | Server port                    |
| `MELKER_SERVER_HOST`         | Server bind address            |
| `MELKER_ALLOW_SERVER_INPUT`  | Allow server client input      |
| `MELKER_RETAIN_BUNDLE`       | Keep temp bundle files         |
| `MELKER_SHOW_STATS`          | Performance stats overlay      |
| `MELKER_MARKDOWN_DEBUG`      | Debug markdown rendering       |
| `MELKER_AUDIO_DEBUG`         | Debug audio recording          |
| `MELKER_PERSIST`             | State persistence              |
| `MELKER_LINT`                | Lint validation                |
| `MELKER_NO_CONSOLE_OVERRIDE` | Console redirect toggle        |
| `MELKER_OAUTH_*`             | OAuth configuration (7 vars)   |

## Troubleshooting

### Debug-Level Messages for MELKER_*/XDG_*

If you see many debug messages like:
```
[DEBUG] Env: Env var not permitted: MELKER_THEME
```

This is normal - Melker checks these vars even if not set. They're at DEBUG level to avoid noise.

### Warn-Level Messages for Other Vars

If you see:
```
[WARN] Env: Access denied for env var: MY_API_KEY (add to policy permissions or configSchema)
```

Your app is trying to read an env var not declared in policy. Fix by adding to policy:

```json
{
  "permissions": {
    "env": ["MY_API_KEY"]
  }
}
```

Or use configSchema for env var override support:

```json
{
  "configSchema": {
    "myapp.apiKey": {
      "type": "string",
      "env": "MY_API_KEY"
    }
  }
}
```
