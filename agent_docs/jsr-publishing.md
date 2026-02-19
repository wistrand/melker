# Publish Melker to JSR

## Context

Melker has no distribution mechanism beyond `git clone` + symlink. Publishing to JSR (jsr.io) lets Deno users install melker globally with one command. The existing architecture (launcher spawns sandboxed subprocess via `import.meta.url` path resolution) works unchanged in JSR — cached modules preserve relative paths.

## End-User Experience

```bash
# Install
deno install -g -A --name melker jsr:@wistrand/melker

# Use
melker app.melker
melker https://example.com/app.melker

# Upgrade (git checkout: git pull, JSR install: reinstall latest)
melker upgrade
```

---

## JSR Config

`deno.json` fields for JSR:

```json
{
  "name": "@wistrand/melker",
  "version": "2026.2.6",
  "license": "MIT",
  "exports": {
    ".": "./melker.ts",
    "./lib": "./mod.ts"
  },
  "publish": {
    "include": [
      "mod.ts", "melker.ts", "melker-launcher.ts",
      "src/", "media/melker-128.png", "LICENSE.txt"
    ]
  }
}
```

- `exports."."` = CLI entry (enables `deno install -g jsr:@wistrand/melker`), `"./lib"` = library API
- `publish.include` is an allowlist — tests, benchmarks, examples, docs, scripts, skills stay out
- `src/` captures all runtime code including server-ui, components, engine, bundler
- `media/` assets are included for backwards compatibility but bundled assets are embedded in the module graph (see below)

---

## Embedded Assets

`deno install` only caches the static module graph (imports). Runtime `fetch()` and `Deno.readFile()` calls against `import.meta.url` fail for JSR installs because `import.meta.url` resolves to `https://jsr.io/...` — not a local file path, and JSR may not serve non-code assets.

All bundled assets are encoded as grayscale PNG (base64) in `src/assets-data.ts` (generated), with the runtime API in `src/assets.ts` (hand-written). Assets are decoded synchronously on first access via `decodePng()` and cached. This keeps them in the module graph so they're cached at `deno install` time.

| Asset ID prefix    | Source files                              | Count | Format                    |
|--------------------|-------------------------------------------|-------|---------------------------|
| `theme/*`          | `src/themes/*.css`                        | 10    | Grayscale PNG + base64    |
| `blue-noise-64`    | `media/blue-noise-64.png`                 | 1     | Grayscale PNG + base64    |
| `font-5x7`         | `src/components/segment-display/5x7.psf2` | 1     | Grayscale PNG + base64    |

Asset definitions live in [`scripts/assets.json`](../scripts/assets.json). Regenerate with `deno task build:assets`.

**Access**: `getAsset(id)` and `getAssetText(id)` are fully synchronous — they decode on first call via `decodePng()`, then cache. No initialization step needed.

Custom paths (`MELKER_BLUE_NOISE_PATH`, `MELKER_THEME_FILE`) still load from the filesystem at runtime.

---

## JSR-Compatible Entry Point

`melker.ts` wraps `Deno.realPath()` in try/catch with `import.meta.url`-based fallback for JSR cache:

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

---

## `upgrade` Subcommand

In `melker-launcher.ts`, placed in the early-exit chain (after `--clear-approvals`, before `parseCliFlags`).

Two modes, detected by checking for `.git` in the launcher's directory:

1. **Git checkout**: Prompts with `confirm()` (skippable with `--yes`), then runs `git pull`
2. **JSR install**: Fetches `jsr.io/@wistrand/melker/meta.json`, compares versions, detects shim name from `$DENO_INSTALL_ROOT/bin/` (or `~/.deno/bin/`), reinstalls with `-f` preserving the name

Version source: `import denoConfig from './deno.json' with { type: 'json' }`

---

## Version Sync Script

`scripts/sync-version.ts` reads latest git tag, strips `v` prefix and leading zeros, updates `deno.json` version field in-place via regex (preserves formatting).

```bash
deno task version:sync
# 2026.2.5 → 2026.2.6 (from v2026.02.6)
```

---

## Local Testing

```bash
# Install from local file
deno install -g -A --name melker ./melker.ts

# Or serve over HTTP to test the non-file code path
deno run --allow-net --allow-read tools/serve.ts
deno install -g -A -f --reload --name melker http://localhost:1990/melker.ts

# Uninstall
deno uninstall -g melker
```

---

## Publishing Checklist

1. **Claim scope**: Create `@wistrand` scope at https://jsr.io (browser, one-time)
2. **Sync version**: `deno task version:sync`
3. **Build**: `deno task build` (embedded assets, completions, skill zip, docs)
4. **Type check**: `deno task check`
5. **Dry run**: `deno task publish:dry-run` — confirm 0 errors (2 expected dynamic import warnings)
6. **Publish**: `deno publish`
7. **Test install**: `deno install -g -A --name melker jsr:@wistrand/melker`
8. **Test run**: `melker examples/basics/hello.melker`
9. **Test upgrade**: `melker upgrade`

---

## Deno Tasks

| Task               | Command                                                    |
|--------------------|------------------------------------------------------------|
| `version:sync`       | Sync `deno.json` version from latest git tag               |
| `build`              | Run all build steps (assets + completions + skill + docs)  |
| `build:assets`        | Regenerate embedded assets (themes, blue noise, font)      |
| `build:completions`  | Regenerate shell completions from config schema            |
| `build:skill`        | Build AI agent skill zip                                   |
| `build:docs`         | Copy `examples/showcase/` to `docs/examples/showcase/`     |
| `publish:dry-run`    | `deno publish --dry-run --allow-dirty`                     |
