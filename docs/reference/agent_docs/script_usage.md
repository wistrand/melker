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
  querySelector(selector: string): any;       // CSS selectors (see below)
  querySelectorAll(selector: string): any[];  // Returns all matches

  // Supported CSS selectors:
  // - Type: text, button, container
  // - ID: #myId
  // - Class: .myClass
  // - Universal: * (matches all)
  // - Compound: button.primary
  // - Descendant (space): container text (any nested)
  // - Child (>): container > text (direct children)
  // - Comma (OR): button, .clickable

  // Rendering
  render(): void;
  skipRender(): void;       // Skip auto-render after handler

  // App lifecycle
  exit(): Promise<void>;
  quit(): Promise<void>;    // Alias for exit()

  // UI utilities
  setTitle(title: string): void;
  alert(message: string): void;
  copyToClipboard(text: string): Promise<boolean>;  // Requires clipboard: true in policy (auto-policy default)
  openBrowser(url: string): Promise<boolean>;  // Requires browser: true in policy

  // Toast notifications (non-modal)
  // Note: Calling show() with identical message+type resets timer and shows count (2), (3)...
  toast: {
    show(message: string, options?: ToastOptions): string;  // Returns toast ID
    dismiss(id: string): void;
    dismissAll(): void;
    setPosition(position: 'top' | 'bottom'): void;
  };

  // Dev Tools (F12 overlay)
  devtools: {
    show(): void;       // Open Dev Tools overlay
    hide(): void;       // Close Dev Tools overlay
    toggle(): void;     // Toggle Dev Tools overlay
    isOpen(): boolean;  // Check if Dev Tools is open
  };

  // Element creation
  createElement(type: string, props?: Record<string, any>, ...children: any[]): any;

  // Dynamic imports
  melkerImport(specifier: string): Promise<any>;

  // AI tools
  registerAITool(tool: any): void;

  // AI utilities
  ai: {
    createStreamingExtractor(body: ReadableStream<Uint8Array>, options?: {
      onField?: Record<string, (partial: string, complete: boolean) => void>;
      onContent?: (content: string) => void;
      onComplete?: (json: unknown) => void;
      onError?: (error: Error) => void;
    }): { result: Promise<string>; abort(): void };

    extractImageFromResponse(json: unknown, options?: {
      signal?: AbortSignal;
    }): Promise<string>;
  };

  // State bindings (optional — see state-binding-architecture.md, bind-selection-architecture.md)
  createState(initial: Record<string, any>): Record<string, any>;

  // State persistence
  persistenceEnabled: boolean;
  stateFilePath: string | null;

  // App-specific cache directory (always exists)
  cacheDir: string;

  // Persistent cache API (binary data, survives restarts)
  cache: {
    read(namespace: string, key: string): Promise<Uint8Array | null>;
    write(namespace: string, key: string, data: Uint8Array, options?: { maxBytes?: number }): Promise<void>;
    delete(namespace: string, key: string): Promise<boolean>;
    scan(namespace: string): Promise<string[]>;
    clear(namespace: string): Promise<number>;
    stats(namespace: string): Promise<{ entries: number; totalBytes: number }>;
  };

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
    serverPort: number | undefined;
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

| Identifier        | Description                                          |
|-------------------|------------------------------------------------------|
| `$melker`         | Runtime context object                               |
| `$app`            | Alias for `$melker.exports` (user-defined functions) |
| `$melker.url`     | Source file URL (e.g. `file:///path/to/app.melker`)  |
| `$melker.dirname` | Directory path (e.g. `/path/to`)                     |
| `argv`            | Command line arguments (`string[]`). `argv[0]` = .melker file path, `argv[1+]` = user args. Same indexing as template `${argv[N]}`. |

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

**Important: Primitive exports are copied by value.** When you export a primitive (number, string, boolean), `$app.varName` holds a copy. Assigning `$app.varName = newValue` modifies the copy, not the original variable:

```html
<script>
  export let count = 0;
  export function setCount(n) { count = n; }  // Use setter to modify original
</script>

<script async="ready">
  $app.count = 10;     // WRONG - modifies copy, original still 0
  $app.setCount(10);   // CORRECT - modifies original via setter
</script>
```

Objects are copied by reference, so `$app.obj.prop = value` does modify the original.

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

**Note:** Loggers are cached by name, so calling `getLogger('MyComponent')` multiple times returns the same logger instance.

### Log Levels

Available log methods (in order of severity):
- `debug(message, ...args)`
- `info(message, ...args)`
- `warn(message, ...args)`
- `error(message, ...args)`

Set log level via environment variable:
```bash
MELKER_LOG_LEVEL=DEBUG ./melker.ts app.melker
```

## Script Types

### Sync Scripts (default)

Emitted as a standalone ES module. `export` works — exports become `$app.*` handlers. Runs at import time, before render:

```html
<script>
const state = { count: 0 };
export function increment() { state.count++; }
</script>
```

### Init Scripts

Code is wrapped inside an async function body. `export` does NOT work here. Runs before first render, supports `await`:

```html
<script async="init">
const data = await fetch('/api/data').then(r => r.json());
</script>
```

### Ready Scripts (Recommended for Initialization)

Run after first render, support `await`. **This is the preferred pattern for post-render initialization:**

```html
<script async="ready">
// DOM is rendered, can access elements
const el = $melker.getElementById('my-element');
el.setValue('Initialized!');
</script>
```

**Calling exported functions from ready scripts:**

```html
<script type="typescript">
  export function init() {
    const canvas = $melker.getElementById('myCanvas');
    // Initialize canvas, start timers, etc.
  }
</script>

<script type="typescript" async="ready">
  $app.init();
</script>
```

**Note:** Functions called via `$app.*` must be exported from their script block.

### onMount (Alternative Pattern)

The `$melker.engine.onMount()` API provides programmatic callback registration:

```html
<script>
$melker.engine.onMount(() => {
  const el = $melker.getElementById('my-element');
  // Initialize after render
});
</script>
```

**When to use each:**
- `async="ready"` - Preferred, declarative, cleaner separation
- `onMount()` - When you need to register callbacks from within other logic
- Markdown format (`.md` files) - Use `// @melker script ready` directive instead of `async="ready"` attribute

### onBeforeExit (Ctrl+C Confirmation)

The `$melker.engine.onBeforeExit()` hook intercepts Ctrl+C and lets the app confirm before exiting (e.g., for unsaved changes). The standard double-press convention applies: a second Ctrl+C within 3 seconds force-exits regardless of what the hook returns.

```html
<script type="typescript" async="ready">
$melker.engine.onBeforeExit(() => {
  return $melker.confirm('You have unsaved changes. Quit?');
});
</script>
```

The handler must return `true` to allow exit, or `false` to cancel it. Multiple handlers can be registered — if any returns `false`, exit is cancelled.

Returns an unsubscribe function:

```html
<script type="typescript" async="ready">
const off = $melker.engine.onBeforeExit(() => {
  return $melker.confirm('Discard changes?');
});
// Later: off() to remove the hook
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

## AI Utilities

The `$melker.ai` namespace provides helpers for working with OpenAI-compatible APIs.

### Streaming JSON Extractor

Process SSE (Server-Sent Events) streams from chat completion APIs. Progressively extracts JSON string fields as they arrive:

```html
<script>
export async function fetchStory() {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({ model: 'google/gemini-2.5-flash', messages: [...], stream: true })
  });

  const stream = $melker.ai.createStreamingExtractor(res.body, {
    onField: {
      narrative: (partial, complete) => {
        $melker.getElementById('story').props.text = partial;
        $melker.render();
      },
    },
    onComplete: (json) => applyFullResponse(json),
    onError: (err) => showError(err.message),
  });

  const fullText = await stream.result;
  // stream.abort() to cancel early
}
</script>
```

Options:
- `onField` — Map of field name to callback. Called repeatedly as each JSON string field grows. `complete` is true when the field's closing quote is received.
- `onContent` — Called with the full accumulated content after each chunk.
- `onComplete` — Called with the fully parsed JSON when the stream ends.
- `onError` — Called if the stream fails or JSON is malformed.

Returns `{ result: Promise<string>, abort(): void }`.

### Image Response Extractor

Normalize image responses from OpenAI-compatible APIs into a `data:` URL. Handles all known response formats (OpenRouter, Gemini inline_data, DALL-E data[].b64_json, markdown image URLs, etc.):

```html
<script>
export async function generateImage(prompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: 'openai/gpt-image-1',
      messages: [{ role: 'user', content: prompt }],
      modalities: ['image', 'text'],
      max_tokens: 1024
    }),
    signal: abortController.signal
  });

  const json = await res.json();
  const dataUrl = await $melker.ai.extractImageFromResponse(json, {
    signal: abortController.signal  // for secondary fetches (remote URL formats)
  });

  $melker.getElementById('my-image').setSrc(dataUrl);
}
</script>
```

Throws if no image data is found in the response.

## See Also

- [tutorial.html](../docs/tutorial.html) — Step-by-step first app tutorial
- [config-architecture.md](config-architecture.md) — Full config system details
- [debugging.md](debugging.md) — Logging and debugging tools
- [melker-file-format.md](melker-file-format.md) — .melker file syntax
- [dx-footguns.md](dx-footguns.md) — Common mistakes to avoid
