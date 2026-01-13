# Configuration System Architecture

## Overview

Schema-driven configuration with layered overrides. All config is defined in `src/config/schema.json`.

## Priority Order (lowest to highest)

```
1. Defaults      (from schema.json)
2. Policy config (per-app in <policy> tag)
3. File config   (~/.config/melker/config.json)
4. Env vars
5. CLI flags     (highest - explicit user intent)
```

Each layer overrides the previous. CLI flags have the highest priority.

## File Structure

```
src/config/
  schema.json       - Config schema (source of truth)
  config.ts         - MelkerConfig class (singleton, typed getters)
  cli.ts            - CLI parser and help generators (schema-driven)
  mod.ts            - Exports
```

## CLI Usage

```bash
# Show current config with sources (includes app-defined config from policy)
./melker.ts --print-config

# Override via CLI flags
./melker.ts --theme bw-std --lint app.melker

# CLI overrides env vars
MELKER_THEME=fullcolor-dark ./melker.ts --theme bw-std  # uses bw-std
```

### Print Config Output

`--print-config` shows all config values grouped by category:

```
Melker Configuration
====================

Config file: ~/.config/melker/config.json
  (exists)

Priority: default < policy < file < env < cli

[General]
  theme = bw-std <- policy
  persist = false (--persist, MELKER_PERSIST)

[Ai]
  ai.model = openai/gpt-5.2-chat (MELKER_AI_MODEL)
  ...

[Plasma (app)]
  plasma.scale = 1.5 <- policy
  plasma.speed = 2.0 <- policy
```

- Schema-defined categories show env var/flag references for defaults
- App-defined config appears under `[Category (app)]` sections
- Source indicators: `<- policy`, `<- config.json`, `<- MELKER_*`, `<- --flag`

## Schema Properties

Each property in schema.json can have:

| Field | Purpose |
|-------|---------|
| `type` | JSON Schema type: string, boolean, integer, number, object |
| `default` | Default value if not specified |
| `env` | Env var name that can override |
| `envInverted` | Env var is negative (e.g., MELKER_NO_X means X=false) |
| `envFormat` | How to parse complex env values (e.g., "name: value; name2: value2") |
| `flag` | CLI flag name (e.g., "--theme") |
| `flagInverted` | Flag is negative (e.g., --no-alt-screen means alternateScreen=false) |
| `enum` | Allowed values |
| `minimum/maximum` | Numeric bounds |
| `description` | Documentation |

## Config Categories

### General
- `theme` - Color theme (env: MELKER_THEME, flag: --theme)
- `persist` - Enable state persistence (env: MELKER_PERSIST, flag: --persist)
- `lint` - Enable lint validation (env: MELKER_LINT, flag: --lint)

### Logging
- `log.level` - Log verbosity: TRACE, DEBUG, INFO, WARN, ERROR
- `log.file` - Log file path

### AI
- `ai.model` - AI chat model
- `ai.audioModel` - Audio transcription model
- `ai.endpoint` - AI API endpoint
- `ai.headers` - Custom API headers (object, env format: "name: value; name2: value2")
- `ai.siteName` - Site name for AI API
- `ai.siteUrl` - Site URL for AI API
- `ai.audioGain` - Audio recording gain multiplier

### Dithering
- `dither.algorithm` - Dithering algorithm: sierra-stable, sierra, floyd-steinberg, ordered, none
- `dither.bits` - Color depth (1-8)

### Terminal
- `terminal.alternateScreen` - Use alternate screen buffer (inverted env: MELKER_NO_ALTERNATE_SCREEN)
- `terminal.syncRendering` - Synchronous rendering (inverted env: MELKER_NO_SYNC)
- `terminal.forceFFmpeg` - Force FFmpeg instead of native audio on macOS

### Render
- `render.gfxMode` - Graphics rendering mode: `sextant` (default), `block` (colored spaces), `pattern` (ASCII spatial), `luma` (ASCII brightness) (env: MELKER_GFX_MODE, flag: --gfx-mode)

### Headless
- `headless.enabled` - Run without terminal (flag: --headless)
- `headless.width` - Virtual terminal width
- `headless.height` - Virtual terminal height

### Debug
- `debug.port` - WebSocket debug server port (flag: --debug-port)
- `debug.host` - Debug server bind address
- `debug.allowRemoteInput` - Allow input from debug clients
- `debug.retainBundle` - Keep temp bundle files for debugging
- `debug.showStats` - Show performance stats overlay
- `debug.markdownDebug` - Debug markdown rendering
- `debug.audioDebug` - Replay recorded audio before transcription

### OAuth
- `oauth.clientId` - OAuth client ID
- `oauth.port` - OAuth callback server port
- `oauth.path` - OAuth callback path
- `oauth.redirectUri` - OAuth redirect URI
- `oauth.scopes` - OAuth scopes (space-separated)
- `oauth.audience` - OAuth audience parameter
- `oauth.wellknownUrl` - OAuth well-known configuration URL

## Secrets (Env Vars Only)

Not in config system:
- `OPENROUTER_API_KEY` - AI API key

## Internal Vars (Not in Config)

Runtime flags, not user config:
- `MELKER_RUNNER` - Indicates running in sandboxed subprocess
- `MELKER_REMOTE_URL` - Original URL when loading remote files
- `MELKER_RUNNING_HEADLESS` - Set by headless mode at runtime

## MelkerConfig API

```typescript
// Initialize at startup (optional - auto-inits with defaults)
MelkerConfig.init({
  policyConfig: policy.config,
  cliFlags: parsedArgs
});

// Get singleton instance
const config = MelkerConfig.get();

// Typed getters (schema-defined properties)
config.theme           // string
config.logLevel        // string
config.headlessEnabled // boolean
config.debugPort       // number | undefined

// Generic getters (any key, including custom)
config.getString('theme', 'auto')           // string with default
config.getBoolean('persist', false)         // boolean with default
config.getNumber('debug.port', 8080)        // number with default
config.getValue('custom.key')               // unknown (returns undefined if not set)
config.hasKey('custom.key')                 // boolean

// Late initialization (when config auto-inits before flags are parsed)
MelkerConfig.applyCliFlags(parsedArgs);
MelkerConfig.applyPolicyConfig(policy.config);

// Get formatted config text (for dev tools, --print-config)
MelkerConfig.getConfigText();

// Print to stdout
MelkerConfig.printConfig();

// Reset singleton (for testing)
MelkerConfig.reset();
```

## CLI Parser API

```typescript
import { parseCliFlags, generateFlagHelp } from './config/mod.ts';

// Parse CLI args based on schema
const { flags, remaining } = parseCliFlags(Deno.args);
// flags: Record<string, unknown> - parsed config values
// remaining: string[] - non-config args (file paths, launcher flags)

// Generate help text
generateConfigHelp();   // Full config reference
generateFlagHelp();     // CLI flags only (compact)
generateEnvVarHelp();   // Environment variables
```

## Example Config File

```json
// ~/.config/melker/config.json
{
  "theme": "fullcolor-dark",
  "log": {
    "level": "DEBUG"
  },
  "ai": {
    "model": "anthropic/claude-3-opus"
  },
  "dither": {
    "algorithm": "sierra-stable",
    "bits": 4
  }
}
```

## Example Policy with Config

Apps can define both standard and custom config values in their policy:

```xml
<policy>
{
  "name": "My App",
  "permissions": {
    "read": ["."],
    "net": ["api.example.com"]
  },
  "config": {
    "theme": "bw-std",
    "dither": {
      "algorithm": "ordered",
      "bits": 1
    },
    "myapp": {
      "scale": 2.5,
      "debug": true
    }
  }
}
</policy>
```

Custom config keys (like `myapp.scale`) are flattened to dot-notation and accessible via generic getters.

## Policy Config Schema

Apps can define a schema for custom config keys to enable **environment variable overrides**:

```xml
<policy>
{
  "name": "Plasma Demo",
  "permissions": { "shader": true },
  "config": {
    "plasma": {
      "scale": 1.5,
      "speed": 2.0,
      "debug": false
    }
  },
  "configSchema": {
    "plasma.scale": {
      "type": "number",
      "env": "PLASMA_SCALE",
      "description": "Plasma effect scale multiplier"
    },
    "plasma.speed": {
      "type": "number",
      "env": "PLASMA_SPEED"
    },
    "plasma.debug": {
      "type": "boolean",
      "env": "PLASMA_DEBUG"
    }
  }
}
</policy>
```

### Config Schema Properties

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Value type: `string`, `boolean`, `integer`, `number` |
| `default` | any | Default value (if not in config) |
| `min` | number | Minimum value (for number/integer, enables slider in DevTools) |
| `max` | number | Maximum value (for number/integer, enables slider in DevTools) |
| `step` | number | Step size for slider (auto: 1 for integer) |
| `env` | string | Environment variable name for override |
| `envInverted` | boolean | If true, env presence means opposite value |
| `description` | string | Documentation |

When `min` and `max` are both defined for a numeric type, the DevTools Edit Config tab displays a slider instead of a text input.

### Priority with Schema

For keys with a configSchema entry:
1. **Default** - from configSchema.default (lowest)
2. **Policy** - from policy.config
3. **Env var** - from configSchema.env (highest for app config)

CLI flags do not apply to app-defined config (only schema-defined keys).

### Auto-Permissions for Env Vars

When a `configSchema` declares an `env` field, the env var is **automatically added** to the subprocess permissions. You don't need to manually add it to `"env"` in permissions:

```json
{
  "permissions": { "shader": true },
  "configSchema": {
    "plasma.scale": { "type": "number", "env": "PLASMA_SCALE" }
  }
}
```

The subprocess will automatically have permission to read `PLASMA_SCALE` without needing `"env": ["PLASMA_SCALE"]` in permissions.

### Example Usage

```bash
# Override plasma.scale via env var (--trust for non-interactive/CI)
PLASMA_SCALE=3.0 ./melker.ts --trust plasma_demo.melker

# print-config shows the env override
./melker.ts --print-config plasma_demo.melker
# [Plasma (app)]
#   plasma.scale = 3 <- PLASMA_SCALE
#   plasma.speed = 2 <- policy (PLASMA_SPEED)
#   plasma.debug = false <- policy (PLASMA_DEBUG)
```

## Usage Examples

```typescript
import { MelkerConfig } from './config/mod.ts';

const config = MelkerConfig.get();

// Headless mode
if (config.headlessEnabled) {
  setupHeadless(config.headlessWidth, config.headlessHeight);
}

// Logging
const logger = createLogger({
  level: config.logLevel,
  file: config.logFile
});

// Theme
const theme = loadTheme(config.theme);

// Debug server
if (config.debugPort) {
  startDebugServer(config.debugPort, config.debugHost);
}

// Dithering
if (config.ditherAlgorithm) {
  canvas.setDither(config.ditherAlgorithm, config.ditherBits);
}
```

## Script Access

Any `.melker` app can access config via `$melker.config`:

```typescript
// Schema-defined config (typed properties)
const theme = $melker.config.theme;
const headless = $melker.config.headlessEnabled;

// Generic getters work with any key (including custom)
const scale = $melker.config.getNumber('myapp.scale', 1.0);
const debug = $melker.config.getBoolean('myapp.debug', false);
const name = $melker.config.getString('myapp.name', 'default');

// Check if key exists
if ($melker.config.hasKey('myapp.custom')) {
  const value = $melker.config.getValue('myapp.custom');
}
```

**Custom config keys** defined in `<policy>` are automatically available:

```xml
<policy>
{
  "permissions": { "read": ["."] },
  "config": {
    "plasma": { "scale": 1.5, "speed": 2.0 }
  }
}
</policy>

<script>
const scale = $melker.config.getNumber('plasma.scale', 1.0);  // 1.5
const speed = $melker.config.getNumber('plasma.speed', 1.0);  // 2.0
</script>
```

## Benefits

1. **Single source of truth** - schema.json defines everything
2. **Auto-generated CLI** - parseCliFlags reads schema for flag definitions
3. **Auto-generated help** - generateFlagHelp, generateConfigHelp from schema
4. **Type safety** - Typed getters on MelkerConfig
5. **Discoverable** - `cat schema.json` shows all options
6. **IDE support** - JSON Schema for config.json autocomplete
7. **Backward compatible** - Env vars still work as escape hatch
8. **Late initialization** - applyCliFlags/applyPolicyConfig for staged init
9. **Custom config** - Apps can define their own config keys in policy
