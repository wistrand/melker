# Embedded Asset System Architecture

## Summary

Static assets (theme CSS, blue noise matrix, bitmap font, logo PNG, server UI, macOS audio script) are embedded in the module graph as base64-encoded grayscale PNGs. At runtime, `decodePng()` from `fast-png` decodes them synchronously on first access. No async initialization, no runtime I/O, no extra dependencies.

This means Melker has **zero runtime file/network access** to its own source tree — all assets are in the module graph. The subprocess needs no `--allow-read` for `src/` or `media/`, and no `--allow-net` for the melker host when running from a remote URL.

For development, `MELKER_DYNAMIC_ASSETS=true` reads assets directly from source files instead, so changes are visible without running `deno task build:assets`.

## File Map

| File                                                                                   | Purpose                                                    |
|----------------------------------------------------------------------------------------|------------------------------------------------------------|
| [`src/assets.ts`](../src/assets.ts)                                                    | Runtime API: `getAsset()`, `getAssetText()`, `getAssetIds()` |
| [`src/assets-data.ts`](../src/assets-data.ts)                                          | Generated — base64 PNG data + source paths (do not edit)   |
| [`scripts/generate-embedded-assets.ts`](../scripts/generate-embedded-assets.ts)        | Generator — reads source files, encodes as PNG, writes `assets-data.ts` |
| [`scripts/assets.json`](../scripts/assets.json)                                        | Asset registry — IDs and source paths                      |
| [`src/deps.ts`](../src/deps.ts)                                                        | `encodePng` / `decodePng` from `fast-png@8.0.0`           |

## Asset Registry

All asset definitions live in [`scripts/assets.json`](../scripts/assets.json). To add a new asset, add an entry and run `deno task build:assets`. Each entry has `id` (lookup key) and `path` (source file relative to project root).

## How It Works

### Encoding (build time)

```
source bytes (CSS, HTML, JS, Swift, PSF2, PNG)
    |
    v
encodePng({ width: len, height: 1, channels: 1, depth: 8 })
    |
    v
grayscale PNG bytes (deflate-compressed internally by PNG)
    |
    v
base64 string → stored in src/assets-data.ts (ASSET_DATA)
```

Each asset's raw bytes are treated as a 1-pixel-tall grayscale image. PNG's internal deflate compression handles the size reduction.

The generator also computes relative paths from `src/` to each source file and stores them in `ASSET_PATHS` (used for dynamic loading).

### Decoding (runtime, default)

```
base64 string from ASSET_DATA[id]
    |
    v
atob() → Uint8Array (PNG bytes)
    |
    v
decodePng() → { data: Uint8Array }   (synchronous, from fast-png)
    |
    v
decoded.data = original source bytes
    |
    v
cached in Map for subsequent access
```

All synchronous. First call to `getAsset(id)` decodes and caches; subsequent calls return from cache.

### Dynamic loading (development, opt-in)

When `assets.dynamic` config is enabled (`MELKER_DYNAMIC_ASSETS=true`), `getAsset()` reads the source file directly from disk using `ASSET_PATHS` resolved against `assets.ts`'s `import.meta.url`. If the read fails (JSR cache, permissions, missing file), it falls back to the embedded base64 decode.

```
MelkerConfig.get().dynamicAssets === true?
    |
    v
ASSET_PATHS[id] (e.g. './themes/bw-std.css')
    |
    v
new URL(rel, new URL('.', import.meta.url))   (resolves to src/ directory)
    |
    v
Deno.readFileSync(url) → Uint8Array
    |
    v (on failure: fall back to decodeEmbedded)
cached in Map for subsequent access
```

**Config**: `assets.dynamic` in `src/config/schema.json`, env var `MELKER_DYNAMIC_ASSETS`, default `false`. This is opt-in because JSR/remote installs have no local source tree.

This means you can edit a theme CSS, restart melker, and see the change immediately — without running `deno task build:assets`.

## API

```typescript
import { getAsset, getAssetText, getAssetIds } from './assets.ts';

// Binary asset (Uint8Array)
const fontData = getAsset('font-5x7');

// Text asset (string)
const css = getAssetText('theme/fullcolor-dark');

// List assets by prefix
const themeIds = getAssetIds('theme/');  // ['theme/bw-std', 'theme/bw-dark', ...]
```

All functions are synchronous. No initialization step required.

## Consumers

| Consumer                                                          | Usage                                          |
|-------------------------------------------------------------------|------------------------------------------------|
| `src/theme.ts` → `loadBuiltinThemes()`                           | `getAssetText('theme/' + name)` for each theme |
| `src/video/dither/threshold.ts` → `getBuiltinBlueNoise()`        | `getAsset('blue-noise-64')` → decoded by consumer via `decodePngToMatrix()` |
| `src/components/segment-display/bitmap-fonts.ts` → `getFont5x7()`| `getAsset('font-5x7')` for PSF2 font          |
| `src/oauth/callback-server.ts` → logo endpoint                   | `getAsset('logo-128')` for OAuth callback page |
| `src/server.ts` → `_getServerUI()`                               | `getAssetText('server-ui/*')` for web UI       |
| `src/ai/audio.ts` → `_getSwiftScriptPath()`                      | `getAssetText('macos-audio-record.swift')`     |

## Why PNG

PNG is used as a compression container (not for image data). Key properties:

- **Synchronous decode** — `decodePng()` from `fast-png` is pure JS, returns immediately
- **Grayscale mode** — color type 0, 8-bit: 1 byte per pixel, decoded data equals original bytes
- **Deflate compression** — same algorithm as raw deflate, ~2% overhead from PNG framing
- **No new dependencies** — `fast-png` already in `deps.ts` for image rendering
- **Height = 1** — minimizes PNG filter byte overhead (1 byte total); data has no 2D structure to exploit

## Regenerating

```bash
deno task build:assets
```

This reads source files, encodes each as a grayscale PNG, base64-encodes, and writes `src/assets-data.ts`. Part of the umbrella `deno task build`.
