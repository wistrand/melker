<!-- Generated: docs/graphics-pipeline.html -->
# Plan: Graphics Pipeline Doc Page

## Context

`docs/graphics-pipeline.html` follows the same structure as `docs/data-visualization.html` and `docs/rich-content.html`. Covers the graphics rendering pipeline: graphics modes, dithering, per-pixel shaders, and image filters.

These features control how `<img>` and `<canvas>` components convert pixel data into terminal characters. Shader examples require `"shader": true` policy. Image examples require `"read"` permission.

## Page Structure

| # | Section       | Topic                  | Example file                              |
|---|---------------|------------------------|-------------------------------------------|
| 1 | Graphics modes | sextant, quadrant, halfblock, pattern side by side | `docs/examples/graphics/gfx-modes.melker` |
| 2 | Dithering     | none, sierra, atkinson, ordered side by side | `docs/examples/graphics/dithering.melker`  |
| 3 | Per-pixel shaders | Animated plasma effect on canvas | `docs/examples/graphics/shader.melker`    |
| 4 | Image filters | grayscale, invert, sepia (code only, no screenshot) | `docs/examples/graphics/filter.melker`    |
| 5 | Mode comparison | Table of all modes with resolution, Unicode version, font support | (no example) |
| 6 | Configuration | Environment variables, CLI flags, per-element props | (no example) |

## Files

| File                                     | Purpose                                      |
|------------------------------------------|----------------------------------------------|
| `docs/graphics-pipeline.html`            | The doc page                                 |
| `docs/examples/graphics/gfx-modes.melker`| 4 modes side by side (sextant, quadrant, halfblock, pattern) |
| `docs/examples/graphics/dithering.melker` | 4 dither algorithms with ditherBits="2"     |
| `docs/examples/graphics/shader.melker`   | Plasma effect using fbm and palette          |
| `docs/examples/graphics/filter.melker`   | 4 filters (original, grayscale, invert, sepia) |

## Example .melker Files

Each example is self-contained. Policy: `{"permissions": {"read": ["*"]}}` for images and filters, `{"permissions": {"read": ["*"], "shader": true}}` for shaders. Note: `onFilter` does not require shader permission.

### gfx-modes.melker
Four `<img>` components in a row, each with a different `gfxMode` prop: sextant, quadrant, halfblock, pattern. All render `melker-128.png` at 16x12 with `object-fit: contain`. No CLI `--gfx-mode` flag when generating output (per-element props must take effect).

### dithering.melker
Four `<img>` components showing dither algorithms: none, sierra-stable, atkinson, ordered. All use `gfxMode="sextant"` and `ditherBits="2"` to make dithering visible. Images are 16x12.

### shader.melker
A `<canvas>` with `onShader` pointing to a plasma function using `utils.fbm` and `utils.palette`. Uses `gfxMode="sextant"`, `shaderFps="30"` and `shaderRunTime="500"` for stdout capture. Lower frequency params (`u * 2 + time * 0.5`, `v * 2 + time * 0.3`, `time * 0.2`). Requires `"shader": true` policy.

`onShader` accepts a single callback or a pipeline array: `ShaderCallback | (ShaderCallback | null | undefined)[]`. Null slots in the array are skipped, enabling fixed-slot composition (e.g., `[mood1, mood2, loading, fisheye]`). 14 built-in shader effects are available via `$melker.shaderEffects`: fisheye, lightning, rain, bloom, sunrays, glitch, fog, fire, underwater, snow, darkness, sandstorm, magic, heat. Use in templates: `onShader="$melker.shaderEffects.rain()"`.

### shader-effects.melker
Showcases all 14 built-in shader effects applied to the same image. Uses `onShader="$melker.shaderEffects.<name>()"` directly in templates. Requires `"shader": true` policy.

### filter.melker
Four `<img>` components with `onFilter` handlers: original (no filter), grayscale, invert, sepia. Each filter function receives `(x, y, time, resolution, source)` and returns `[r, g, b, a]`. No shader permission needed — filters are one-shot transforms.

`onFilter` also supports pipeline arrays, same as `onShader`.

## Generating Terminal Output

```bash
run_example() {
  ./melker.ts --trust --stdout --stdout-width=60 --stdout-height=$2 \
    --color=always --stdout-timeout=2000 "docs/examples/graphics/$1" \
    2>/dev/null | deno run scripts/ansi2html.ts
}

# No --gfx-mode CLI flag so per-element gfxMode props take effect
run_example gfx-modes.melker 14
run_example dithering.melker 14
run_example shader.melker 16
run_example filter.melker 14   # not used (identical output)
```

Terminal output already generated and saved to:
- `/tmp/gfx-modes.html`
- `/tmp/dithering.html`
- `/tmp/shader.html`
- `/tmp/filter.html` (not used)

## Key Documentation Points

### Graphics modes section
- Each mode trades resolution for compatibility
- Set per-element via `gfxMode` prop on `<img>` or `<canvas>`
- Default mode is sextant (2x3 pixels per cell)
- quadrant: 2x2, Unicode 1.0, near-universal font support
- halfblock: 1x2, Unicode 1.0, nearly square pixel aspect
- block: 1x1, colored spaces, works everywhere
- pattern: ASCII characters chosen by brightness
- Protocol modes (sixel, kitty, iterm2) render native pixels

### Dithering section
- Dithering simulates colors outside the available palette
- `dither` prop: none, sierra-stable, floyd-steinberg, atkinson, ordered, blue-noise
- `ditherBits` prop (1-8): controls color depth, lower = more visible dithering
- Error diffusion (sierra, floyd-steinberg, atkinson): spreads quantization error to neighbors
- Ordered dithering: uses a threshold matrix, no error propagation

### Shader section
- `onShader` runs a function per pixel per frame
- Signature: `(x, y, time, resolution, source, utils) => [r, g, b, a]`
- Built-in utils: fbm, palette, smoothstep, mix, fract, noise2d, simplex2d, perlin2d, perlin3d
- `shaderFps` controls frame rate, `shaderRunTime` controls duration
- Requires `"shader": true` in policy (CPU-intensive)
- `resolution.pixelAspect` for aspect-correct effects
- **Pipeline arrays**: `onShader` accepts `ShaderCallback | (ShaderCallback | null)[]` — null slots are no-ops for slot-based composition
- **14 built-in effects** via `$melker.shaderEffects`: fisheye, lightning, rain, bloom, sunrays, glitch, fog, fire, underwater, snow, darkness, sandstorm, magic, heat
- Template usage: `onShader="$melker.shaderEffects.rain()"`

### Filter section
- `onFilter` runs once at image load (not animated)
- Same signature as shader but `source.getPixel(x, y)` reads the loaded image
- Common filters: grayscale, invert, sepia, color shift
- No shader permission needed — filters are one-shot, not CPU-intensive
- **Pipeline arrays**: `onFilter` also accepts pipeline arrays, same as `onShader`

### Mode comparison table

| Mode      | Pixels/cell | Resolution (80x24) | Unicode | Font support   |
|-----------|-------------|---------------------|---------|----------------|
| sextant   | 2x3         | 160x72              | 13.0    | Spotty         |
| quadrant  | 2x2         | 160x48              | 1.0     | Near-universal |
| halfblock | 1x2         | 80x48               | 1.0     | Near-universal |
| block     | 1x1         | 80x24               | N/A     | Universal      |
| pattern   | 2x3         | 160x72              | N/A     | Universal      |
| sixel     | native      | native               | N/A     | xterm, foot, WezTerm |
| kitty     | native      | native               | N/A     | Kitty          |
| iterm2    | native      | native               | N/A     | iTerm2, WezTerm, Rio |

### Configuration section
- Environment variable: `MELKER_GFX_MODE=quadrant`
- CLI flag: `melker --gfx-mode=quadrant`
- Per-element prop: `gfxMode="quadrant"`
- Priority: per-element prop > CLI flag > environment variable
- `melker --test-sextant` to check terminal sextant support

## Nav Dropdown Update

Add to all doc pages' dropdown menus, after "Rich Content":

```html
<a href="/graphics-pipeline.html">Graphics Pipeline</a>
```

## Font for Terminal Blocks

All doc pages load Cascadia Code from Google Fonts. The graphics pipeline page uses a special `text=` parameter to force inclusion of sextant glyphs (U+1FB00-U+1FB3B), box drawing (U+2500-U+257F), and block elements (U+2580-U+259F). Without `text=`, Google Fonts serves unicode-range subsets that omit these blocks on Android.

`shared.css` sets `pre.terminal` font-family to `'Cascadia Code', 'JetBrains Mono', 'SF Mono', Consolas, monospace`.

Pages without sextant chars use a simple font link:
```html
<link href="https://fonts.googleapis.com/css2?family=Cascadia+Code&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
```

Pages with sextant chars (graphics-pipeline.html) use the `text=` variant with all needed glyphs URL-encoded.

## Writing Style

- No em-dashes. Use periods, colons, commas, or "and" instead.
- No bragging language ("powerful", "seamless", "beautiful", etc.).
- Keep descriptions factual and concise.
