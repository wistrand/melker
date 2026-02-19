# Embedded Asset System Architecture

## Summary

Static assets (theme CSS, blue noise matrix, bitmap font) are embedded in the module graph as base64-encoded grayscale PNGs. At runtime, `decodePng()` from `fast-png` decodes them synchronously on first access. No async initialization, no runtime I/O, no extra dependencies.

## File Map

| File                                                                                   | Purpose                                                 |
|----------------------------------------------------------------------------------------|---------------------------------------------------------|
| [`src/assets.ts`](../src/assets.ts)                                                    | Runtime API: `getAsset()`, `getAssetText()`, `getAssetIds()` |
| [`src/assets-data.ts`](../src/assets-data.ts)                                          | Generated data — base64 PNG strings (do not edit)       |
| [`scripts/generate-embedded-assets.ts`](../scripts/generate-embedded-assets.ts)        | Generator — reads source files, encodes as PNG, writes `assets-data.ts` |
| [`scripts/assets.json`](../scripts/assets.json)                                        | Asset registry — IDs, source paths, and optional transforms |
| [`src/deps.ts`](../src/deps.ts)                                                        | `encodePng` / `decodePng` from `fast-png@8.0.0`        |

## Asset Registry

All asset definitions live in [`scripts/assets.json`](../scripts/assets.json). To add a new asset, add an entry and run `deno task build:assets`. Each entry has `id` (lookup key), `path` (source file relative to project root), and optional `transform` (`"png-grayscale"` to decode a source PNG to raw grayscale bytes before encoding).

## How It Works

### Encoding (build time)

```
source bytes (CSS, PSF2, raw pixels)
    |
    v
encodePng({ width: len, height: 1, channels: 1, depth: 8 })
    |
    v
grayscale PNG bytes (deflate-compressed internally by PNG)
    |
    v
base64 string → stored in src/assets-data.ts
```

Each asset's raw bytes are treated as a 1-pixel-tall grayscale image. PNG's internal deflate compression handles the size reduction. The `png-grayscale` transform option first decodes a source PNG to raw grayscale bytes before re-encoding (used for the blue noise matrix).

### Decoding (runtime)

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

| Consumer                                            | Usage                                          |
|-----------------------------------------------------|------------------------------------------------|
| `src/theme.ts` → `loadBuiltinThemes()`              | `getAssetText('theme/' + name)` for each theme |
| `src/video/dither/threshold.ts` → `getBuiltinBlueNoise()` | `getAsset('blue-noise-64')` for dither matrix |
| `src/components/segment-display/bitmap-fonts.ts` → `getFont5x7()` | `getAsset('font-5x7')` for PSF2 font |

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
