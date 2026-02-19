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

Three bundled assets are embedded as TypeScript modules so they're part of the module graph and cached at install time:

| Asset              | Source file                    | Embedded module                                          | Format              |
|--------------------|--------------------------------|----------------------------------------------------------|---------------------|
| Built-in themes    | `src/themes/*.css`             | `src/themes/mod.ts`                                      | CSS strings          |
| Blue noise matrix  | `media/blue-noise-64.png`      | `src/video/dither/blue-noise-64.ts`                      | `Uint8Array` literal |
| 5x7 bitmap font    | `src/components/segment-display/5x7.psf2` | `src/components/segment-display/font-5x7-data.ts` | Deflate + base64     |

**Themes** (`src/themes/mod.ts`): All 10 built-in theme CSS strings in a `Record<string, string>`. Imported by `src/theme.ts` — `loadBuiltinThemes()` is synchronous, no I/O.

**Blue noise** (`src/video/dither/blue-noise-64.ts`): 64x64 threshold matrix (4096 bytes) as a `Uint8Array` literal. Used directly by `threshold.ts` — no PNG decoding needed at runtime.

**Bitmap font** (`src/components/segment-display/font-5x7-data.ts`): PSF2 binary deflate-compressed to base64 (19KB → 13.5KB). Inflated on first use via `DecompressionStream`, then parsed with `parsePSF2()`.

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
3. **Type check**: `deno task check`
4. **Dry run**: `deno task publish:dry-run` — confirm 0 errors (2 expected dynamic import warnings)
5. **Publish**: `deno publish`
6. **Test install**: `deno install -g -A --name melker jsr:@wistrand/melker`
7. **Test run**: `melker examples/basics/hello.melker`
8. **Test upgrade**: `melker upgrade`

---

## Deno Tasks

| Task               | Command                                                    |
|--------------------|------------------------------------------------------------|
| `version:sync`     | Sync `deno.json` version from latest git tag               |
| `publish:dry-run`  | `deno publish --dry-run --allow-dirty`                     |
| `docs:showcase`    | Copy `examples/showcase/` to `docs/examples/showcase/`     |
