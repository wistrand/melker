# CSS Opacity Support

## Overview

Melker supports `opacity` and `background-opacity` CSS properties. Since ANSI terminals have no native transparency, opacity is implemented as **color blending before ANSI output** — element colors are blended against the effective parent background in linear light space, producing a final solid color.

## Properties

| CSS Property         | Style Key          | Range | Default | Description                              |
|----------------------|--------------------|-------|---------|------------------------------------------|
| `opacity`            | `opacity`          | 0–1   | 1       | Blends both foreground and background    |
| `background-opacity` | `backgroundOpacity`| 0–1   | 1       | Blends background only (text stays solid)|

Both accept numbers (`0.5`) or percentages (`50%`) in CSS. Values below `0.05` skip rendering the element entirely.

## Pipeline

```
CSS opacity → computeStyle() (inherit + multiply) → rendering blends colors → Cell (solid) → ANSI output
```

Blending happens at multiple points in `src/rendering.ts`:
- `_renderBackground()` — blends background fill color
- `_renderBorder()` — blends border foreground and background
- `_styleToCellStyle()` → `_renderContent()` — blends text foreground/background
- Canvas/img post-process (`_blendCellOpacity()` in `src/components/canvas.ts`) — blends pixel colors

## Style Inheritance

`opacity` inherits from parent and **multiplies** (CSS semantics):
```
parent opacity: 0.5 × child opacity: 0.5 = effective opacity: 0.25
```

`backgroundOpacity` does **not** inherit — it applies only to the element it's set on.

## Blend Algorithm

Linear-light blending using pre-computed LUTs from `src/color/oklab.ts`:

```
result = SRGB_TO_LINEAR[fg] * opacity + SRGB_TO_LINEAR[bg] * (1 - opacity)
```

Per-channel, converted back to sRGB via `linearToSrgb()` (4096-entry Uint8Array LUT).

## Color Tier Behavior

| Tier          | Approach                                                           | Quality              |
|---------------|--------------------------------------------------------------------|----------------------|
| **Truecolor** | Blend in linear light, emit as `38;2;R;G;B`                       | Excellent — smooth   |
| **256-color** | Same blend, then quantize to nearest palette index                 | Good                 |
| **16-color**  | Blend then use `nearestColor16Plus()` with Oklab                   | Moderate             |
| **No-color**  | Ignore opacity                                                     | Graceful degradation |

## Canvas / Image Opacity

Canvas and img elements render pixel colors from image data, bypassing the normal style-to-cell pipeline. Opacity is applied as a **post-process step** after `_renderToTerminal()`:

- `_blendCellOpacity()` in `src/components/canvas.ts` iterates all cells in the canvas bounds
- Mutates `cell.foreground` and `cell.background` in-place via direct `buffer.currentBuffer.cells` access
- Zero object allocations — parent background is unpacked once, blend weights are pre-computed
- Handles `ViewportDualBuffer` (scrollable containers) by resolving through the proxy to the underlying `TerminalBuffer`

## Animation

`opacity` and `backgroundOpacity` are in `NUMERIC_PROPS` in `src/css-animation.ts`, enabling:

```css
@keyframes fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.element {
  animation: fade-in 0.5s ease-out;
}
```

CSS transitions also work: `transition: opacity 0.3s ease;`

## Performance

- **Common case (opacity = 1)**: Zero cost — early exit skips all blend logic
- **Per-element blend** (~25-30ns): 6 LUT lookups + 6 multiply-adds + pack/unpack
- **Canvas post-process**: Zero-allocation loop — direct cell mutation, inlined LUT math, no `getCell`/`setCell` overhead
- **Near-zero opacity (<0.05)**: Element rendering is skipped entirely

## Usage

```xml
<!-- CSS style -->
<container style="opacity: 0.5; background-opacity: 0.3;">
  <text>Semi-transparent</text>
</container>

<!-- In stylesheet -->
<style>
  .faded { opacity: 0.25; }
  .glass { background-opacity: 0.5; }
  img { opacity: 0.8; }
</style>

<!-- Percentage syntax -->
<container style="opacity: 50%;">
  <text>Half opacity</text>
</container>
```

## Files

| File                          | Role                                                     |
|-------------------------------|----------------------------------------------------------|
| `src/types.ts`                | `opacity` and `backgroundOpacity` on `Style` interface   |
| `src/layout-style.ts`        | Inheritance and parent×child multiplication              |
| `src/rendering.ts`           | `_blendOpacity()`, blend in background/border/content    |
| `src/components/canvas.ts`   | `_blendCellOpacity()` post-process for canvas/img pixels |
| `src/css-animation.ts`       | `NUMERIC_PROPS` includes opacity for animation           |
| `src/stylesheet.ts`          | `parseStyleProperties()` normalizes percentage strings   |
| `src/components/color-utils.ts` | `normalizeStyle()` normalizes percentage strings      |
| `src/color/oklab.ts`         | `SRGB_TO_LINEAR`, `linearToSrgb` LUTs                   |

## Example

See [`examples/basics/opacity.melker`](../examples/basics/opacity.melker) — interactive demo with opacity and background-opacity sliders.
