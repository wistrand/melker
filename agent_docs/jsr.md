# JSR Distribution

Publishing to JSR (jsr.io) lets Deno users install melker globally with one command. The existing architecture (launcher spawns sandboxed subprocess via `import.meta.url` path resolution) works unchanged in JSR — cached modules preserve relative paths. See [cli-reference.md](cli-reference.md) for end-user installation instructions.

```bash
# Install (-A grants all permissions to the launcher; apps run sandboxed via <policy>)
deno install -g -A jsr:@wistrand/melker

# Use
melker app.melker
melker https://melker.sh/examples/demo.melker

# Upgrade (git checkout: git pull, JSR install: reinstall latest)
melker upgrade
```

---

## JSR Config

`deno.json` fields for JSR:

```json
{
  "name": "@wistrand/melker",
  "version": "<calver>",
  "license": "MIT",
  "exports": {
    ".": "./melker.ts",
    "./lib": "./mod.ts"
  },
  "publish": {
    "include": [
      "mod.ts", "melker.ts", "melker-launcher.ts",
      "src/", "media/melker-128.png", "LICENSE.txt"
    ],
    "exclude": [
      "src/globals-ambient.d.ts"
    ]
  },
  "engines": {
    "deno": ">=2.5.0"
  }
}
```

- `version`: CalVer format `YYYY.M.PATCH` — synced from git tags via `deno task version:sync`
- `exports."."` = CLI entry (enables `deno install -g jsr:@wistrand/melker`), `"./lib"` = library API
- `publish.include` is an allowlist — tests, benchmarks, examples, docs, scripts, skills stay out
- `publish.exclude` removes `src/globals-ambient.d.ts` (contains `declare global` which JSR rejects)
- `README.md` is not published — the `@module` JSDoc in `melker.ts` serves as the JSR package page (JSR defaults to `readmeSource=jsdoc`, which prefers `@module` over README)
- `src/` captures all runtime code including server-ui, components, engine, bundler
- `media/` assets are included for backwards compatibility but bundled assets are embedded in the module graph
- `engines` declares the minimum Deno version (2.5+ for `Deno.bundle()`)

---

## Code Adaptations

### Global Types Split

**Problem:** JSR rejects packages that contain `declare global` blocks — "modifying global types is not allowed". Tracked in [denoland/deno#23427](https://github.com/denoland/deno/issues/23427) (proposed `*globals.ts` naming convention, still open).

**Root cause:** `src/globals.d.ts` contained both exported interfaces (`MelkerRegistry`, `MelkerContext`, etc.) and a `declare global` block for `globalThis.*` variables. `src/types.ts` imported `globals.d.ts`, pulling the `declare global` into the published module graph.

**Solution:** Three-layer architecture:

| File                        | Contains                                        | Published to JSR? |
|-----------------------------|-------------------------------------------------|-------------------|
| `src/globals.d.ts`          | Exported interfaces only (no `declare global`)  | Yes               |
| `src/globals-ambient.d.ts`  | `declare global` block for `globalThis.*` types | No (excluded)     |
| `src/global-accessors.ts`   | Typed getter/setter functions for globals        | Yes               |

Key changes:

- `src/types.ts` — Removed `import './globals.d.ts'` (was pulling `declare global` into module graph)
- `deno.json` — Added `"compilerOptions": { "types": ["./src/globals-ambient.d.ts"] }` for local type checking
- `deno.json` — Added `"publish": { "exclude": ["src/globals-ambient.d.ts"] }` to keep it out of JSR

### Global Accessors

After removing `declare global` from published code, all `globalThis.melkerEngine`, `globalThis.__melkerRequestRender`, etc. accesses produce TS7017 errors ("no index signature").

`src/global-accessors.ts` provides typed wrapper functions:

```typescript
const g = globalThis as any;

export function getGlobalEngine(): MelkerEngine | undefined {
  return g.melkerEngine;
}
export function setGlobalEngine(engine: MelkerEngine): void {
  g.melkerEngine = engine;
}
// ... getGlobalRequestRender, setGlobalRequestRender, getGlobalRenderCount,
//     setGlobalRenderCount, getGlobalLogger, setGlobalEmergencyCleanup
```

84 usages across 20 importing files: `src/engine.ts`, `src/rendering.ts`, `src/terminal-lifecycle.ts`, and 17 component files (`canvas.ts`, `canvas-render.ts`, `canvas-render-sextant.ts`, `canvas-render-quadrant.ts`, `canvas-render-isolines.ts`, `canvas-render-dithered.ts`, `canvas-render-graphics.ts`, `canvas-shader-runner.ts`, `markdown.ts`, `markdown-image.ts`, `img.ts`, `text.ts`, `data-table.ts`, `data-tree.ts`, `split-pane.ts`, `graph/graph.ts`, `file-browser/file-browser.ts`).

### Bundler Data URL Import

**Problem:** When Melker is loaded from a remote origin (JSR registry URL), the bundler's `import(\`file://${bundleFile}\`)` fails because Deno blocks `file://` imports from HTTP/HTTPS-origin modules. Tracked in [denoland/deno#25360](https://github.com/denoland/deno/issues/25360).

**Solution:** Import bundled code via `data:` URL instead of writing to a temp file:

```typescript
// src/bundler/mod.ts, executeBundle()
const bytes = new TextEncoder().encode(assembled.bundledCode);
let binary = '';
for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
const encoded = btoa(binary);
await import(`data:application/javascript;base64,${encoded}`);
```

`data:` URLs have no origin, so they're importable from any context — `file://`, `http://`, `https://`. The byte-by-byte `String.fromCharCode` loop handles Unicode safely (`btoa()` only accepts Latin-1). Temp file write is preserved for the `retainBundle` debug option only.

### Slow Types

JSR requires explicit return type annotations on all exported functions (no inferred types), aligning with TS `isolatedDeclarations` ([jsr-io/jsr#444](https://github.com/jsr-io/jsr/issues/444)). `deno publish --dry-run` reports violations. All exported functions in `mod.ts` and its transitive exports were annotated with explicit return types. `--allow-slow-types` exists as an escape hatch but penalizes the package score.

---

## Embedded Assets

`deno install` only caches the static module graph (imports). Runtime `Deno.readFile()` calls against `import.meta.url` fail for JSR installs because `import.meta.url` resolves to `https://jsr.io/...` — not a local file path. Import attributes ([denoland/deno#25354](https://github.com/denoland/deno/issues/25354)) help for static imports, but dynamic asset discovery (listing themes, serving a directory) has no path forward ([denoland/deno#28872](https://github.com/denoland/deno/issues/28872), open).

All bundled assets are encoded as grayscale PNG (base64) in `src/assets-data.ts` (generated), with the runtime API in `src/assets.ts` (hand-written). Assets are decoded synchronously on first access via `decodePng()` and cached. This keeps them in the module graph so they're cached at `deno install` time.

| Asset ID prefix             | Source files                              | Count | Format                 |
|-----------------------------|-------------------------------------------|-------|------------------------|
| `theme/*`                   | `src/themes/*.css`                        | 10    | Grayscale PNG + base64 |
| `blue-noise-64`             | `media/blue-noise-64.png`                 | 1     | Grayscale PNG + base64 |
| `font-5x7`                  | `src/components/segment-display/5x7.psf2` | 1     | Grayscale PNG + base64 |
| `logo-128`                  | `media/melker-128.png`                    | 1     | Grayscale PNG + base64 |
| `server-ui/*`               | `src/server-ui/index.{html,css,js}`       | 3     | Grayscale PNG + base64 |
| `macos-audio-record.swift`  | `src/ai/macos-audio-record.swift`         | 1     | Grayscale PNG + base64 |

Asset definitions live in [`scripts/assets.json`](../scripts/assets.json). Regenerate with `deno task build:assets`.

**Access**: `getAsset(id)` and `getAssetText(id)` are fully synchronous — they decode on first call via `decodePng()`, then cache. No initialization step needed. For development, `MELKER_DYNAMIC_ASSETS=true` reads source files from disk instead (see [embedded-assets-architecture.md](embedded-assets-architecture.md)).

**Files that previously used filesystem reads:**
- `src/theme.ts` — Theme CSS files, now via `getAssetText('theme/<name>')`
- `src/server.ts` — Server UI HTML/CSS/JS, now via `getAssetText('server-ui/<file>')`
- `src/components/segment-display/bitmap-fonts.ts` — PSF2 font, now via `getAsset('font-5x7')`
- `src/video/dither/threshold.ts` — Blue noise PNG, now via `getAsset('blue-noise-64')`
- `src/ai/audio.ts` — Swift recording script, now via `getAssetText('macos-audio-record.swift')`
- `src/oauth/callback-server.ts` — OAuth callback HTML, now via `getAssetText()`

Custom paths (`MELKER_BLUE_NOISE_PATH`, `MELKER_THEME_FILE`) still load from the filesystem at runtime.

---

## Entry Point & Subcommands

### Entry Point Fallback

`melker.ts` wraps `Deno.realPath()` in try/catch with `import.meta.url`-based fallback for JSR cache. `Deno.realPath()` fails in JSR cache contexts ([denoland/deno#28217](https://github.com/denoland/deno/issues/28217), closed as "not planned"):

```typescript
if (selfUrl.protocol === 'file:') {
  try {
    const realPath = await Deno.realPath(selfUrl.pathname);
    const realDir = realPath.replace(/\/[^/]+$/, '');
    launcherUrl = `file://${realDir}/melker-launcher.ts`;
  } catch {
    launcherUrl = new URL('./melker-launcher.ts', selfUrl).href;
  }
}
```

### `info` Subcommand

In `melker-launcher.ts`, early-exit chain (after `--clear-approvals`, before `parseCliFlags`). Displays version (from `deno.json`), install type (git checkout / JSR install / remote URL), install path (resolved from `import.meta.url`), platform, and Deno version.

### `upgrade` Subcommand

Same early-exit chain. Two modes, detected by `detectInstallType()` (checks for `.git` directory):

1. **Git checkout**: Prompts with `confirm()` (skippable with `--yes`), then runs `git pull`
2. **JSR/remote install**: Fetches `{JSR_URL}/@wistrand/melker/meta.json` (respects `JSR_URL` env var, defaults to `https://jsr.io`), compares versions, detects shim name via `findInstalledShim()` (scans `$DENO_INSTALL_ROOT/bin/` or `~/.deno/bin/`), reinstalls with `-f` preserving the name

Version source: `import denoConfig from './deno.json' with { type: 'json' }`

---

## Module Documentation

### `@module` JSDoc

JSR defaults to `readmeSource=jsdoc`, which uses `@module` JSDoc from the main entry point (`.` export) for the package page. Both entry points have `@module` JSDoc blocks:

- `melker.ts` (`.` export) — Full package documentation: installation, usage, creating apps, components, TypeScript API, permission sandboxing, upgrade, documentation links
- `mod.ts` (`./lib` export) — Library usage documentation with import examples

`README.md` is not published to JSR — the `@module` JSDoc covers all JSR-facing content with absolute GitHub links. The GitHub README uses relative links and git-oriented install instructions that don't apply on JSR.

The `build:doc` task generates HTML API docs: `deno doc --html --name=melker --output=docs/api melker.ts mod.ts`

---

## JSR vs HTTPS

The two distribution paths serve different roles and are complementary — neither is secondary.

| Path            | Role                                                                                                                          |
|-----------------|-------------------------------------------------------------------------------------------------------------------------------|
| **HTTPS run**   | **Distribution** — share, discover, try, automate. Enables the project's central promise: share a URL, inspect the policy, approve it, run it. |
| **JSR install** | **Installation** — daily use, offline, deterministic. Better runtime characteristics for repeated use.                        |

### How Each Path Works

**JSR install** (`deno install -g -A jsr:@wistrand/melker`):
1. Downloads the package from JSR, creates a shim script in `~/.deno/bin/melker`
2. The shim runs `melker.ts` → resolves via `Deno.realPath()` (with JSR cache fallback) → imports `melker-launcher.ts` from the same directory
3. All code is colocated: policy system, config system, content loader, assets — all resolved as relative `./src/...` imports against the local JSR cache
4. The runner subprocess (`src/melker-runner.ts`) is spawned from the same local tree
5. All 17 embedded assets are available locally in `src/assets-data.ts`

**HTTPS run** (`deno run --allow-all https://melker.sh/melker.ts`):
1. Hits a Netlify edge function at `docs/netlify/edge-functions/melker.ts`
2. The edge function generates a thin wrapper that `import()`s `melker-launcher.ts` from `raw.githubusercontent.com` — it does **not** serve the real `melker.ts`
3. `melker-launcher.ts` imports its dependencies — all resolved as relative URLs against the GitHub raw content URL
4. The runner subprocess is spawned using the remote URL for `src/melker-runner.ts`
5. The runner then imports `../mod.ts`, `./bundler/mod.ts`, etc. — each a separate HTTP fetch from GitHub on first run

### Comparison

| Dimension                        | JSR install                                                                                          | HTTPS run                                                                                                                     |
|----------------------------------|------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------|
| **Module resolution**            | Local filesystem, deterministic                                                                      | HTTP fetch chain through GitHub raw URLs, each import = a network round-trip on first run                                     |
| **Startup latency**              | Near-instant (local files)                                                                           | Cold start: dozens of HTTP fetches as Deno walks the import graph. Warm (cached): fast, but depends on Deno's module cache    |
| **Offline support**              | Fully works offline after install                                                                    | Fails unless everything is in Deno's cache (`--cached-only` after first run)                                                  |
| **Lockfile integrity**           | `deno.lock` published with package, pins dependency hashes                                           | No lockfile — Deno fetches whatever is at HEAD (or pinned tag)                                                                |
| **Version pinning**              | `jsr:@wistrand/melker@<version>` — immutable, auditable via JSR registry                            | `melker.sh/melker-v2026.01.1.ts` pins the launcher, but transitive deps resolve to that tag's tree. No lockfile verification |
| **`--reload` detection**         | N/A — `wasLauncherReloaded()` returns `false` immediately (`url.protocol === 'file:'`)               | Mtime forensic detection: checks `<DENO_DIR>/remote/https/<host>/<SHA256>` modified within 5s. Auto-forwards to subprocess   |
| **Subprocess spawn**             | Spawns `deno run ... /path/to/src/melker-runner.ts` — clean local path                               | Spawns `deno run ... https://raw.githubusercontent.com/.../src/melker-runner.ts` — triggers another remote import chain       |
| **Embedded assets**              | Available locally, synchronous decode, zero network I/O at runtime                                   | Same assets in fetched source, but initial fetch must traverse the full import graph remotely                                  |
| **Permission sandbox**           | `--allow-read` needs temp dir, app dir, cwd, XDG state, Deno cache. No `--allow-net` for melker host | Same — Deno's module loading bypasses `--allow-net` restrictions (see below), and all runtime assets are embedded             |
| **Upgrade**                      | `melker upgrade` → fetches `jsr.io/@wistrand/melker/meta.json`, runs `deno install -g -f`            | `deno run --reload https://melker.sh/melker.ts` re-fetches everything. No upgrade concept; just cache invalidation            |
| **Edge function indirection**    | None — runs the actual code directly                                                                 | `melker.sh/melker.ts` returns a generated wrapper, not the real `melker.ts`. Extra indirection, extra failure point           |
| **`import.meta.url` semantics**  | `file:///.../.deno/.../melker-launcher.ts` — stable filesystem URL                                   | `https://raw.githubusercontent.com/.../melker-launcher.ts` — all relative URL resolutions go back to GitHub                   |
| **Error diagnostics**            | Stack traces point to local paths                                                                    | Stack traces point to `raw.githubusercontent.com` URLs — harder to debug                                                      |

### Module Loading vs `--allow-net`

Deno's module loading is **not** subject to `--allow-net` restrictions. The permission system controls runtime APIs (`fetch()`, `Deno.connect()`, `WebSocket`, etc.), not the module graph resolution phase.

When the launcher spawns a subprocess with a remote runner URL, Deno resolves the entire import graph **before** the permission sandbox takes effect. Module fetching is a privileged operation performed by the runtime, not by user code.

This means the removed `--allow-net` for melker's own origin in `src/policy/flags.ts` is correct for **both** paths — it was about runtime `fetch()` calls (themes, server-ui, Swift script), which are all embedded now.

### `--reload` Auto-Forwarding

When running from a remote URL, the `--reload` flag before the URL only affects the parent process. `Deno.args` doesn't include Deno runtime flags, so the subprocess wouldn't get `--reload`.

The launcher detects `--reload` by checking its own module cache file mtime. Deno's remote module cache lives at `<DENO_DIR>/remote/<scheme>/<host[_PORT<n>]>/SHA256(pathname)`. If the cache file was written within the last 5 seconds, `--reload` was used, and it's auto-forwarded to the subprocess. Detection only runs when `import.meta.url` is remote — zero cost for local and JSR runs.

### Edge Function Wrapper Design

The Netlify edge function generates a wrapper instead of serving the real `melker.ts`. The real `melker.ts` already handles the remote case, so the wrapper technically bypasses working code. This is an aesthetic issue, not a functional one.

Alternatives considered:
- **Full proxy**: Serve all `*.ts` from `melker.sh` by proxying GitHub — clean but adds latency
- **Export `run()` from `melker.ts`**: Smallest change with most payoff
- **HTTP redirect**: Clean but loses version-not-found error handling
- **Keep as-is**: Current design works correctly — pragmatic solution (current choice)

---

## Version Sync

`scripts/sync-version.ts` reads latest git tag, strips `v` prefix and leading zeros, updates `deno.json` version field in-place via regex (preserves formatting).

```bash
deno task version:sync
```

---

## Publishing Checklist

1. **Claim scope**: Create `@wistrand` scope at https://jsr.io (browser, one-time)
2. **Sync version**: `deno task version:sync`
3. **Build**: `deno task build` (embedded assets, completions, skill zip, docs, lockfile)
4. **Type check**: `deno task check`
5. **Dry run**: `deno task publish:dry-run` — confirms 0 errors (2 expected dynamic import warnings)
6. **Publish**: `deno task publish`
7. **Test install**: `deno install -g -A jsr:@wistrand/melker`
8. **Test run**: `melker examples/basics/hello.melker`
9. **Test upgrade**: `melker upgrade`

---

## Local Testing

```bash
# Install from local file
deno install -g -A ./melker.ts

# Or serve over HTTP to test the non-file code path
deno run --allow-net --allow-read tools/serve.ts
deno install -g -A -f --reload http://localhost:1990/melker.ts

# Uninstall
deno uninstall -g melker
```

---

## Deno Tasks

| Task                   | Description                                                          |
|------------------------|----------------------------------------------------------------------|
| `version:sync`         | Sync `deno.json` version from latest git tag                         |
| `build`                | Run all build steps (assets + completions + skill + docs + lock)     |
| `build:assets`         | Regenerate embedded assets (themes, blue noise, font, logo)          |
| `build:completions`    | Regenerate shell completions from config schema                      |
| `build:skill`          | Build AI agent skill zip                                             |
| `build:docs`           | Copy `examples/showcase/` to `docs/examples/showcase/`               |
| `build:doc`            | Generate HTML API docs from `@module` JSDoc                          |
| `build:lock`           | Regenerate `deno.lock` (runtime deps only)                           |
| `publish:dry-run`      | Dry-run publish to JSR                                               |
| `publish`              | Publish to JSR                                                       |
| `publish:test-dry-run` | Dry-run publish to test JSR server (`JSR_URL=https://jsr.test`)      |
| `publish:test`         | Publish to test JSR server (`JSR_URL=https://jsr.test`)              |

---

## Summary of Modified Files

| File                                             | Adaptation                                        |
|--------------------------------------------------|---------------------------------------------------|
| `deno.json`                                      | JSR config, compilerOptions.types, publish.exclude |
| `melker.ts`                                      | Fallback path resolution, `@module` JSDoc         |
| `melker-launcher.ts`                             | upgrade/info subcommands, JSR_URL support          |
| `mod.ts`                                         | `@module` JSDoc, slow type annotations            |
| `src/globals.d.ts`                               | Removed `declare global` block                    |
| `src/globals-ambient.d.ts`                       | New — extracted `declare global`, excluded from JSR|
| `src/global-accessors.ts`                        | New — typed getters/setters for globals            |
| `src/types.ts`                                   | Removed `import './globals.d.ts'`                 |
| `src/bundler/mod.ts`                             | Data URL import instead of `file://` import       |
| `src/engine.ts`                                  | Global accessors                                  |
| `src/rendering.ts`                               | Global accessors                                  |
| `src/terminal-lifecycle.ts`                      | Global accessors                                  |
| `src/theme.ts`                                   | Embedded asset access                             |
| `src/server.ts`                                  | Embedded asset access                             |
| `src/oauth/callback-server.ts`                   | Embedded asset access                             |
| `src/ai/audio.ts`                                | Embedded asset access                             |
| `src/video/dither/threshold.ts`                  | Embedded asset access                             |
| `src/components/segment-display/bitmap-fonts.ts` | Embedded asset access                             |
| `src/assets.ts`                                  | New — runtime asset decode API                    |
| `src/assets-data.ts`                             | New (generated) — base64-encoded assets           |
| `src/components/*.ts` (16 files)                 | Global accessors                                  |
| `.gitignore`                                     | Added `docs/api/`                                 |
