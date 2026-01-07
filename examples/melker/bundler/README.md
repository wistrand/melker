# Bundler Demo

**Melker** - *Run text with meaning*

This example demonstrates the Deno.bundle() integration for .melker files,
enabling full npm: and jsr: import support.

## Requirements

- Deno 2.5+

## Running

```bash
# Direct execution (melker.ts has executable shebang)
./melker.ts examples/melker/bundler/bundler-demo.melker

# Or via deno run
deno run --allow-all melker.ts examples/melker/bundler/bundler-demo.melker
```

The launcher automatically adds `--unstable-bundle` if needed.

## Features Demonstrated

### External Script with npm: Import

The `date-utils.ts` file imports `date-fns` from npm:

```typescript
import { format, formatDistance, addDays, subDays } from "npm:date-fns";
```

This is loaded via `<script type="typescript" src="./date-utils.ts"/>`.

### Inline Script

The .melker file also contains an inline `<script>` block that shares scope
with the external script. Variables and functions defined in either script
are available to the other.

### String Event Handlers

Event handlers are written as inline strings:

```xml
<button title="Click" onClick="incrementCounter(); $melker.render()" />
```

The bundler compiles these into a registry (`__melker.__h0`, `__melker.__h1`, etc.)
and rewrites the template to call them.

### Auto-Render

After each handler executes, the UI is automatically re-rendered unless the
handler returns `false`.

## How It Works

1. The bundler detects npm:/jsr: imports in scripts
2. All scripts and handlers are combined into a single TypeScript file
3. `Deno.bundle()` compiles everything with full npm resolution
4. The bundled code is executed via dynamic import
5. Handlers are registered on `globalThis.__melker`
6. The template is rewritten to call registry handlers

## Cache

Bundles are cached in `~/.cache/melker/bundles/` based on content hash.
Use `--no-cache` to force re-bundling:

```bash
./melker.ts --no-cache examples/melker/bundler/bundler-demo.melker
```
