# Script Usage in .melker Files

This document describes the identifiers and context available in `<script>` blocks and event handlers in `.melker` files.

## The `$melker` Object

The `$melker` object provides access to the runtime environment:

```typescript
$melker: {
  // Source metadata
  url: string;              // Source file URL (e.g. "file:///path/to/app.melker")
  dirname: string;          // Directory path (e.g. "/path/to")

  // User exports namespace - all script exports go here
  // Also available as $app alias
  exports: Record<string, any>;

  // DOM-like methods
  getElementById(id: string): any;
  querySelector(selector: string): any;
  querySelectorAll(selector: string): any[];

  // Rendering
  render(): void;
  forceRender(): void;

  // App lifecycle
  exit(): void;
  quit(): void;

  // UI utilities
  setTitle(title: string): void;
  alert(message: string): void;
  copyToClipboard(text: string): Promise<boolean>;

  // Element creation
  createElement(type: string, props?: Record<string, any>, ...children: any[]): any;

  // Dynamic imports
  melkerImport(specifier: string): Promise<any>;

  // AI tools
  registerAITool(tool: any): void;

  // State persistence
  persistenceEnabled: boolean;
  stateFilePath: string | null;

  // OAuth
  oauth: any;
  oauthConfig: any;

  // Logging
  logger: any;              // Pre-configured logger for the app
  getLogger(name: string): any;  // Create a named logger

  // Configuration (schema + custom keys from policy)
  config: {
    // Typed properties (schema-defined)
    theme: string;
    logLevel: string;
    headlessEnabled: boolean;
    debugPort: number | undefined;
    // ... other schema properties

    // Generic getters (any key, including custom)
    getString(key: string, defaultValue: string): string;
    getBoolean(key: string, defaultValue: boolean): boolean;
    getNumber(key: string, defaultValue: number): number;
    getValue(key: string): unknown;
    hasKey(key: string): boolean;
  };

  // Internal
  engine: any;
}
```

## Other Global Identifiers

| Identifier | Description |
|------------|-------------|
| `$melker` | Runtime context object |
| `$app` | Alias for `$melker.exports` (user-defined functions) |
| `$melker.url` | Source file URL (e.g. `file:///path/to/app.melker`) |
| `$melker.dirname` | Directory path (e.g. `/path/to`) |
| `argv` | Command line arguments (`string[]`) |

## Exported Script Variables

Any variables/functions exported from `<script>` blocks are added to `$melker.exports` (also available as `$app`):

```html
<script>
export function incrementCounter() {
  state.count++;
}

export const API_URL = 'https://api.example.com';
</script>

<!-- Access via $app (alias for $melker.exports) -->
<button onClick="$app.incrementCounter()" />
```

Supported export patterns:
- `export const/let/var/function/class name` (recommended)
- `export { name1, name2 }` (recommended)
- `exports = { name1, name2 }` (deprecated, inline scripts only)

**External scripts** (with `src` attribute) are imported as ES modules. They must use standard ES module exports:
```typescript
// utils.ts - external script file
declare const $melker: any;  // Declare runtime global

export function myFunction() { ... }
export const myVar = 'value';
```

The `exports = { ... }` convenience pattern does NOT work in external files - use `export function` or `export const` instead.

## Logging

### Using the Default Logger

```html
<script>
// Use the pre-configured app logger via context
$melker.logger.info('App started');
$melker.logger.debug('Debug info', { key: 'value' });
</script>
```

### Creating Named Loggers

Use `$melker.getLogger(name)` to create loggers with custom names for better log organization:

```html
<script>
const uiLogger = $melker.getLogger('UI');
const apiLogger = $melker.getLogger('API');

uiLogger.info('Button clicked');
apiLogger.debug('Fetching data');
</script>
```

**Note:** `getLogger` does **not** cache loggers. Each call creates a new wrapper object. Store loggers in variables rather than calling `getLogger` repeatedly:

```html
<!-- Good: Store logger once -->
<script>
const logger = $melker.getLogger('MyComponent');
</script>
<button onClick="logger.info('clicked')" />

<!-- Avoid: Creates new wrapper on each click -->
<button onClick="$melker.getLogger('MyComponent').info('clicked')" />
```

### Log Levels

Available log methods (in order of severity):
- `trace(message, context?)` - Most verbose
- `debug(message, context?)`
- `info(message, context?)`
- `warn(message, context?)`
- `error(message, error?, context?)`
- `fatal(message, error?, context?)`

Set log level via environment variable:
```bash
MELKER_LOG_LEVEL=DEBUG ./melker.ts app.melker
```

## Script Types

### Sync Scripts (default)

Run immediately when the bundle loads, before rendering:

```html
<script>
const state = { count: 0 };
</script>
```

### Init Scripts

Run before first render, support `await`:

```html
<script async="init">
const data = await fetch('/api/data').then(r => r.json());
</script>
```

### Ready Scripts

Run after first render, support `await`:

```html
<script async="ready">
// DOM is rendered, can access elements
const el = $melker.getElementById('my-element');
</script>
```

## External Scripts

Load scripts from external files:

```html
<script src="./lib/utils.ts"></script>
<script src="./state.ts" async="init"></script>
```

Relative imports in external scripts are automatically resolved.

## Configuration

Apps can access configuration via `$melker.config`. This includes both schema-defined settings and custom app-specific config from the policy.

### Reading Config

```html
<script>
// Schema-defined properties (typed)
const theme = $melker.config.theme;
const headless = $melker.config.headlessEnabled;

// Generic getters (any key, with default values)
const scale = $melker.config.getNumber('myapp.scale', 1.0);
const debug = $melker.config.getBoolean('myapp.debug', false);
const name = $melker.config.getString('myapp.name', 'Untitled');

// Check existence
if ($melker.config.hasKey('myapp.optional')) {
  const value = $melker.config.getValue('myapp.optional');
}
</script>
```

### Defining Custom Config

Add custom config in the `<policy>` tag:

```xml
<policy>
{
  "permissions": { "read": ["."] },
  "config": {
    "myapp": {
      "scale": 2.0,
      "debug": true,
      "name": "My App"
    }
  }
}
</policy>
```

Nested objects are flattened to dot-notation: `myapp.scale`, `myapp.debug`, `myapp.name`.

### Enabling Env Var Overrides

Add a `configSchema` to enable environment variable overrides for custom config:

```xml
<policy>
{
  "permissions": { "read": ["."] },
  "config": {
    "myapp": { "scale": 2.0 }
  },
  "configSchema": {
    "myapp.scale": {
      "type": "number",
      "env": "MYAPP_SCALE"
    }
  }
}
</policy>
```

Now users can run: `MYAPP_SCALE=5.0 ./melker.ts app.melker`

**Auto-permissions**: Env vars in `configSchema` are automatically added to subprocess permissions - no need to add them to `"env"` in permissions.

**Debugging**: If an env var isn't accessible, a warning is logged once:
```
[Env] WARN: Access denied for env var: MYAPP_SCALE (add to policy permissions or configSchema)
```

### Config Priority

For app-defined config (highest priority last):
1. Schema defaults (from `configSchema.default`)
2. Policy config (`<policy>` tag `config`)
3. Environment variables (from `configSchema.env`)

Note: CLI flags only apply to Melker's built-in config, not app-defined config.

See `agent_docs/config-architecture.md` for full details.
