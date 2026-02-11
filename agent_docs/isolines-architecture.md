# Isolines Graphics Mode Architecture

Contour line rendering for canvas using marching squares algorithm.

## Overview

The `isolines` and `isolines-filled` graphics modes render scalar fields as contour lines using box-drawing characters (╭╮╰╯─│). Shared code in `src/isoline.ts` is used by both the canvas component and data-heatmap.

## Files

| File                              | Purpose                                                                        |
|-----------------------------------|--------------------------------------------------------------------------------|
| `src/isoline.ts`                  | Shared marching squares algorithm, threshold generation, color space conversions |
| `src/components/canvas-render.ts` | `renderIsolinesToTerminal()` function                                          |
| `src/components/canvas.ts`        | Isoline props on canvas component                                              |
| `src/config/schema.json`          | Default configuration with env var overrides                                   |

## Configuration

| Config Key              | Env Var                  | Default  | Description                              |
|-------------------------|--------------------------|----------|------------------------------------------|
| `render.isolineCount`   | `MELKER_ISOLINE_COUNT`   | 2        | Number of contour lines                  |
| `render.isolineMode`    | `MELKER_ISOLINE_MODE`    | quantile | Distribution: equal, quantile, nice      |
| `render.isolineSource`  | `MELKER_ISOLINE_SOURCE`  | oklab    | Scalar source channel                    |
| `render.isolineFill`    | `MELKER_ISOLINE_FILL`    | source   | Fill mode: source, color, color-mean     |
| `render.isolineColor`   | `MELKER_ISOLINE_COLOR`   | (empty)  | Contour color: color string, none, auto  |

## Scalar Sources

| Source                           | Description                                 | Range |
|----------------------------------|---------------------------------------------|-------|
| `luma`                           | BT.601 luminance (0.299R + 0.587G + 0.114B) | 0-255 |
| `oklab`                          | Oklab perceptual lightness (default)        | 0-255 |
| `oklch-hue`                      | Oklch hue angle (groups by color)           | 0-255 |
| `red`, `green`, `blue`, `alpha`  | Individual channels                         | 0-255 |

### Oklab Color Space

Oklab is perceptually uniform - similar-looking colors have similar L values. The conversion:

```
sRGB → Linear RGB → LMS (cone response) → Oklab (L, a, b)
```

Oklch hue is computed as `atan2(b, a)` for color-based grouping.

## Marching Squares Algorithm

Each terminal cell is a 2×2 quad of scalar values. The algorithm determines which box-drawing character to render based on which corners are above/below the threshold.

### Corner Encoding

```
topLeft(8)  ───  topRight(4)
    │               │
    │     cell      │
    │               │
bottomLeft(1) ── bottomRight(2)
```

4-bit case = `(TL << 3) | (TR << 2) | (BR << 1) | BL`

### Character Mapping

| Case | Binary | Corners Above | Character   |
|------|--------|---------------|-------------|
| 0    | 0000   | none          | (none)      |
| 1    | 0001   | BL            | ╮           |
| 2    | 0010   | BR            | ╭           |
| 3    | 0011   | BL, BR        | ─           |
| 4    | 0100   | TR            | ╰           |
| 5    | 0101   | TR, BL        | │ (saddle)  |
| 6    | 0110   | TR, BR        | │           |
| 7    | 0111   | TR, BR, BL    | ╯           |
| 8    | 1000   | TL            | ╯           |
| 9    | 1001   | TL, BL        | │           |
| 10   | 1010   | TL, BR        | │ (saddle)  |
| 11   | 1011   | TL, BR, BL    | ╰           |
| 12   | 1100   | TL, TR        | ─           |
| 13   | 1101   | TL, TR, BL    | ╭           |
| 14   | 1110   | TL, TR, BR    | ╮           |
| 15   | 1111   | all           | (none)      |

## Threshold Generation

### Equal Mode

Evenly spaced thresholds between min and max:

```typescript
step = (max - min) / (count + 1)
values = [min + step, min + 2*step, ..., min + count*step]
```

### Quantile Mode

Places thresholds at **midpoints between unique values** to ensure edges are always detected:

1. Extract sorted unique values from scalar field
2. Compute midpoints between adjacent unique values
3. Sample evenly from midpoints

This guarantees thresholds fall between actual data values, so marching squares always finds crossings.

### Nice Mode

Rounds thresholds to "nice" numbers (multiples of 1, 2, 5, 10, etc.) for human-readable labels.

### Minimum Spacing Enforcement

Post-processing step removes thresholds that are too close together:

```typescript
minSpacing = range / (count + 1)
```

This prevents double contours on sharp edges that become gradient zones after area averaging.

## Sampling Strategy

The sampling strategy addresses the challenge of detecting thin features (1-2px lines) that might pass between sample points. It combines sub-cell sampling with area averaging.

### Pixel Buffer Resolution

The canvas pixel buffer uses sextant resolution:

```
pixelsPerCellX = 2 × scale
pixelsPerCellY = 3 × scale
```

For scale=1, each terminal cell represents a 2×3 pixel region in the buffer.

### Sub-cell Sampling (2×)

The scalar grid is sampled at 2× terminal resolution:

```
subSample = 2
subPixelsX = pixelsPerCellX / subSample  // 1 pixel per sub-cell (scale=1)
subPixelsY = pixelsPerCellY / subSample  // 1.5 pixels per sub-cell (scale=1)

gridWidth  = terminalWidth × subSample + 1
gridHeight = terminalHeight × subSample + 1
```

This creates 3×3 sample points per terminal cell instead of 2×2:

```
Terminal cell:          Sub-sampled grid:
┌─────────┐            S───S───S
│         │            │   │   │
│         │     →      S───S───S
│         │            │   │   │
└─────────┘            S───S───S
```

Grid-to-pixel coordinate mapping:

```typescript
pixelX = Math.floor(gx × subPixelsX)
pixelY = Math.floor(gy × subPixelsY)
```

### Area Averaging (3×3)

Each grid sample averages a 3×3 pixel region (radius=1) around the center:

```typescript
const avgRadius = 1;

for (dy = -avgRadius; dy <= avgRadius; dy++) {
  for (dx = -avgRadius; dx <= avgRadius; dx++) {
    // Clamp to buffer bounds
    px = clamp(centerX + dx, 0, bufferWidth - 1)
    py = clamp(centerY + dy, 0, bufferHeight - 1)

    // Composite: drawing layer over image layer
    color = colorBuffer[py × bufferWidth + px]
    if (color === TRANSPARENT) {
      color = imageColorBuffer[py × bufferWidth + px]
    }

    // Only count non-transparent pixels
    if (color !== TRANSPARENT) {
      sum += getScalarFromColor(color, source)
      count++
    }
  }
}

scalar = count > 0 ? sum / count : 0
```

Key details:
- **Edge clamping**: Pixels outside buffer bounds are clamped, not skipped
- **Layer compositing**: Drawing layer takes precedence over image layer
- **Transparency handling**: Transparent pixels excluded from average (count tracks valid pixels)
- **Empty regions**: Return 0 if all 9 pixels are transparent

### Why Both Techniques?

| Problem                          | Sub-cell Sampling        | Area Averaging                 |
|----------------------------------|--------------------------|--------------------------------|
| Line passes between corners      | ✓ Finer grid catches it  | ✗                              |
| Line is 1px, misses all samples  | ✗                        | ✓ Contributes ~11% to neighbors |
| Sharp edges create aliasing      | ✗                        | ✓ Smooths transitions          |

### Terminal Cell Corner Selection

For marching squares, each terminal cell uses corners from the sub-sampled grid:

```typescript
baseGx = tx × subSample  // tx = terminal cell X
baseGy = ty × subSample  // ty = terminal cell Y

tl = scalarGrid[baseGy][baseGx]                      // top-left
tr = scalarGrid[baseGy][baseGx + subSample]          // top-right
bl = scalarGrid[baseGy + subSample][baseGx]          // bottom-left
br = scalarGrid[baseGy + subSample][baseGx + subSample]  // bottom-right
```

The intermediate sub-sample points (at `baseGx + 1`, etc.) improve the quality of the corner values through the area averaging, even though marching squares only uses the 4 corners.

### Visual Summary

```
Pixel Buffer (6×9 for 3×3 terminal cells, scale=1):

  ┌─┬─┬─┬─┬─┬─┐
  │ │ │ │ │ │ │  ← 2 pixels wide per cell
  ├─┼─┼─┼─┼─┼─┤
  │ │ │ │ │ │ │
  ├─┼─┼─┼─┼─┼─┤
  │ │ │ │ │ │ │  ← 3 pixels tall per cell
  ├─┼─┼─┼─┼─┼─┤
  │ │ │ │ │ │ │
  ...

Sub-sampled Grid (7×7 for 3×3 terminal cells):

  S─S─S─S─S─S─S    Grid point spacing:
  │ │ │ │ │ │ │    - X: 1 pixel (2/2)
  S─S─S─S─S─S─S    - Y: 1.5 pixels (3/2)
  │ │ │ │ │ │ │
  S─S─S─S─S─S─S    Each S samples 3×3 pixels
  │ │ │ │ │ │ │    centered on that position
  S─S─S─S─S─S─S
  ...

Terminal Output (3×3 cells):

  ┌───┬───┬───┐    Each cell uses 4 corner
  │ ╭ │ ─ │ ╮ │    values from sub-sampled
  ├───┼───┼───┤    grid (every 2nd point)
  │ │ │   │ │ │
  ├───┼───┼───┤
  │ ╰ │ ─ │ ╯ │
  └───┴───┴───┘
```

## Rendering Pipeline

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Build scalar grid (sub-sampled + area averaged)          │
│    - Sample at 2× resolution                                 │
│    - Average 3×3 pixels per sample                          │
│    - Track min/max/all values                               │
│    - If color-mean: also accumulate averaged RGB per point   │
├──────────────────────────────────────────────────────────────┤
│ 2. Generate isoline thresholds                              │
│    - Use configured mode (equal/quantile/nice)               │
│    - Enforce minimum spacing                                 │
├──────────────────────────────────────────────────────────────┤
│ 2b. Classify band colors (color-mean only)                  │
│    - Iterate grid points (not raw pixels)                    │
│    - Classify by scalar into bands, average stored RGB       │
├──────────────────────────────────────────────────────────────┤
│ 3. Render each terminal cell                                │
│    - If isolineColor≠'none': run marching squares            │
│    - Compute fill color (for bg and/or auto contour fg)      │
│    - If filled: bgColor = fill color                         │
│    - If isolineColor='auto': fgColor = fill color            │
│    - Write to terminal buffer                               │
└──────────────────────────────────────────────────────────────┘
```

## Two Modes

| Mode               | Fill | Description                                       |
|--------------------|------|---------------------------------------------------|
| `isolines`         | No   | Box-drawing characters only, transparent background |
| `isolines-filled`  | Yes  | Box-drawing + background fill (controlled by `isolineFill`) |

### Fill Modes (`isolineFill`)

The `isolineFill` prop (or `MELKER_ISOLINE_FILL` env var) controls how background color is computed in `isolines-filled` mode.

| Value         | Description                                                        |
|---------------|--------------------------------------------------------------------|
| `source`      | Grayscale derived from scalar values (default)                     |
| `color`       | Per-cell averaged color from the original pixel buffer             |
| `color-mean`  | One mean color per isoline band from all pixels in that band       |

#### `source` (default)

Computes a grayscale value from the cell's average scalar:

```typescript
avg = (tl + tr + bl + br) / 4
t = (avg - min) / (max - min)  // normalize to 0-1
gray = 64 + t * 128            // map to 64-192 range
```

Result: a topographic map effect where brightness tracks the scalar source.

#### `color`

Samples the actual 2x3 pixel block for each terminal cell and averages their RGB values. Same technique as `block` graphics mode. Each cell gets its own color — essentially block mode with isoline contour lines overlaid.

#### `color-mean`

Precomputes one mean color per isoline band. Bands are the regions between consecutive thresholds (plus below-first and above-last). All pixels in the visible area are classified into bands by their scalar value, and the RGB values are averaged per band.

Result: flat uniform color per region, like a choropleth map with contour boundaries. Useful when you want distinct regions rather than per-cell color variation.

The band classification:
```
Band 0: scalar < threshold[0]
Band 1: threshold[0] <= scalar < threshold[1]
...
Band N: scalar >= threshold[N-1]
```

### Contour Color (`isolineColor`)

The `isolineColor` prop (or `MELKER_ISOLINE_COLOR` env var) controls the foreground color of the contour line characters.

| Value          | Description                                                         |
|----------------|---------------------------------------------------------------------|
| (empty/unset)  | Default: uses `style.foreground` or theme default                   |
| color string   | All auto-generated contour lines use this color (e.g. `'white'`)    |
| `none`         | Hide contour lines entirely (filled mode still renders backgrounds) |
| `auto`         | Derive contour color from the fill mode logic                       |

#### Priority chain

```
isoline.color (per-threshold) > isolineColor prop > style.foreground > theme default
```

Per-isoline colors (via manual `isolines` array with `color` field) always take priority over `isolineColor`.

#### `auto` behavior

When `isolineColor='auto'`, the contour line foreground uses the same color that the fill mode would produce:

| Fill mode     | Auto contour color                                              |
|---------------|-----------------------------------------------------------------|
| `source`      | Grayscale value from the cell's scalar average                  |
| `color`       | Per-cell averaged RGB from the original pixel buffer            |
| `color-mean`  | The mean color of the isoline band the cell falls into          |

In unfilled `isolines` mode, this gives you colored contour lines without any background fill. In filled `isolines-filled` mode, the contour lines match the background (blending in).

## Canvas Props

```typescript
interface CanvasProps {
  gfxMode?: 'isolines' | 'isolines-filled' | ...;
  isolineCount?: number;        // Override config default
  isolineMode?: IsolineMode;    // 'equal' | 'quantile' | 'nice'
  isolines?: Isoline[];         // Manual thresholds (overrides count)
  isolineSource?: IsolineSource; // 'luma' | 'oklab' | 'oklch-hue' | 'red' | ...
  isolineFill?: IsolineFill;    // 'source' | 'color' | 'color-mean'
  isolineColor?: IsolineColor;  // 'none' | 'auto' | color string
}
```

## Usage Examples

```xml
<!-- Basic isolines -->
<canvas gfxMode="isolines" src="./image.png" />

<!-- Filled with grayscale (default) -->
<canvas gfxMode="isolines-filled" isolineCount="5" />

<!-- Filled with original image colors -->
<canvas gfxMode="isolines-filled" isolineFill="color" />

<!-- Filled with one mean color per isoline band -->
<canvas gfxMode="isolines-filled" isolineFill="color-mean" />

<!-- Hue-based grouping -->
<canvas gfxMode="isolines" isolineSource="oklch-hue" />

<!-- Manual thresholds -->
<canvas gfxMode="isolines" isolines={[{value: 64}, {value: 128}, {value: 192}]} />

<!-- White contour lines -->
<canvas gfxMode="isolines-filled" isolineFill="color" isolineColor="white" />

<!-- Colored contour lines derived from fill mode (no fill background) -->
<canvas gfxMode="isolines" isolineColor="auto" isolineFill="color" />

<!-- Choropleth: filled bands, no contour lines -->
<canvas gfxMode="isolines-filled" isolineFill="color-mean" isolineColor="none" />
```

Environment variable usage:

```bash
MELKER_ISOLINE_COUNT=5 MELKER_ISOLINE_SOURCE=oklab ./melker.ts --gfx-mode=isolines app.melker
MELKER_ISOLINE_FILL=color-mean ./melker.ts --gfx-mode=isolines-filled app.melker
MELKER_ISOLINE_COLOR=white ./melker.ts --gfx-mode=isolines-filled app.melker
MELKER_ISOLINE_COLOR=none MELKER_ISOLINE_FILL=color-mean ./melker.ts --gfx-mode=isolines-filled app.melker
```

## Performance

| Operation              | Complexity                                    |
|------------------------|-----------------------------------------------|
| Build scalar grid      | O(W × H × 9) for 3×3 averaging               |
| + color accumulation   | +3 adds per pixel when color-mean active      |
| Generate thresholds    | O(W × H) for quantile (unique values)         |
| Classify band colors   | O(W × H) iterates grid points (color-mean)    |
| Render cells           | O(W × H × N) for N isolines                  |

Isolines mode is typically faster than sextant mode because:
- No 6-pixel sampling per cell (scalar grid pre-computed)
- No color quantization
- Simple threshold comparisons
