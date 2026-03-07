# SVG Overlay Architecture

## Overview

The SVG overlay system allows drawing `<path>` and `<text>` elements on any CanvasElement subclass. It is used by the AI assistant to annotate canvases, images, videos, and maps.

## Files

| File | Role |
|------|------|
| `src/svg-overlay.ts` | Shared SVG parser (`parseSvgOverlay`) and drawer (`drawSvgOverlay`) |
| `src/components/canvas.ts` | Base: `svgOverlay` prop, render pipeline integration, resize tracking, aspect correction |
| `src/components/tile-map.ts` | Geo overlay: remaps shared parser output to lat/lon, applies Mercator projection |
| `src/ai/tools.ts` | `draw` event handling for tile-map, canvas, img, video |
| `src/ai/context.ts` | AI draw hints with visual coordinate ranges |

## Coordinate Spaces

- **Canvas/img/video**: Aspect-corrected visual coordinates. X is divided by `getPixelAspectRatio()` so equal x/y distances appear equal on screen. AI context shows the visual range (e.g., `90x45` for a 60-wide sextant canvas).
- **Tile-map**: SVG coordinate order x=lon, y=lat. Tile-map's `_parseSvgOverlay` calls the shared parser then remaps `x`→`lon`, `y`→`lat` for geo projection.

## Render Pipeline (canvas.ts)

```
onPaint → shader post-process → SVG overlay → _renderToTerminal → text labels → _markClean
```

The overlay draws to `_colorBuffer` (drawing layer), which composites over `_imageColorBuffer` (image layer) during `_renderToTerminal`.

## Resize Tracking

When the overlay string changes, `_svgOverlayOriginW`/`_svgOverlayOriginH` capture the current buffer size. On subsequent renders, scale factors `bufferWidth/originW` and `bufferHeight/originH` rescale all coordinates proportionally.

## Clear-Before-Overlay Logic

When the overlay content changes (`_svgOverlayChanged` flag) and no user code manages the drawing buffer (`!onPaint && !onShader`), `_colorBuffer` is cleared to TRANSPARENT before drawing. This prevents stale pixels from old overlays showing through. The clear only runs on the frame where the overlay changes, not every frame, so other drawing-buffer content (e.g. video waveform) is preserved during steady-state rendering.

## Design Notes

- Overlay dithering is intentional — the overlay is part of the rendered image and is dithered consistently with the rest of the content.
- Tile-map overrides `_drawSvgOverlayPass()` to no-op since it draws its own geo-projected overlay in `_onPaint`.
- Tile-map uses shared `ParsedSvgElement` types directly, interpreting `x` as lon and `y` as lat.
- Origin tracks `gfxMode` and re-captures buffer dimensions on mode change so scale factors stay correct.
