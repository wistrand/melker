# SVG Overlay Architecture

## Overview

The SVG overlay system draws `<path>` and `<text>` elements on any CanvasElement subclass using named, ordered layers. Multiple sources (app code, AI assistant) manage independent layers without interfering with each other.

## Files

| File | Role |
|------|------|
| `src/svg-overlay.ts`            | Shared SVG parser (`parseSvgOverlay`) and drawer (`drawSvgOverlay`) — works per-string, layer-agnostic |
| `src/components/canvas.ts`      | Base: layer map, public API, render pipeline integration, resize tracking, aspect correction            |
| `src/components/tile-map.ts`    | Geo overlay: per-layer parse cache with lat/lon remapping and Mercator projection                       |
| `src/ai/tools.ts`               | `draw` event: parses `"name: <svg>"` → `ai:name` layer (order 1000), clears with `ai:` prefix          |
| `src/ai/context.ts`             | AI draw hints with visual coordinate ranges and layer names                                              |

## Layer API

Methods on canvas, img, video, and tile-map elements:

```typescript
element.setSvgOverlay(name: string, svg: string, order?: number): void
element.removeSvgOverlay(name: string): void
element.removeSvgOverlaysByPrefix(prefix: string): void
element.clearSvgOverlays(): void
element.getSvgOverlays(): Map<string, { svg: string; order: number }>
```

- **name** — unique layer identifier. Use `prefix:suffix` convention for grouping (e.g. `ai:highlights`, `plates`).
- **order** — draw order (default: 0). Lower draws first (behind). Equal order: alphabetical by name.
- **removeSvgOverlaysByPrefix** — remove all layers matching a prefix (e.g. `'ai:'` clears all AI layers).

## Coordinate Spaces

- **Canvas/img/video**: Aspect-corrected visual coordinates. X is divided by `getPixelAspectRatio()` so equal x/y distances appear equal on screen. AI context shows the visual range (e.g., `90x45` for a 60-wide sextant canvas).
- **Tile-map**: SVG coordinate order x=lon, y=lat. Tile-map's `_parseSvgOverlay` calls the shared parser then remaps `x`→`lon`, `y`→`lat` for geo projection.

## Render Pipeline

### Canvas/img/video (canvas.ts)

```
onPaint → shader post-process → SVG overlay layers (sorted by order) → _renderToTerminal → text labels → _markClean
```

The overlay draws to `_colorBuffer` (drawing layer), which composites over `_imageColorBuffer` (image layer) during `_renderToTerminal`.

### Tile-map (tile-map.ts)

```
tiles → blur → filter → SVG overlay layers (sorted by order, geo-projected) → onOverlay → shader → render → text labels
```

Tile-map overrides `_drawSvgOverlayPass()` to no-op and draws its own geo-projected layers in `_onPaint` via `_drawGeoSvgOverlays()`. Each layer gets its own parse cache (`_geoOverlayParsedCache`) with lat/lon coordinate extraction via `_parseSvgOverlay`, and path commands are transformed to pixel space via Mercator projection per frame.

## Internal Storage

### Canvas (base)

```typescript
protected _svgOverlayLayers: Map<string, { svg: string; order: number }>
protected _svgOverlayDirty: boolean

private _svgOverlayParsedCache: Map<string, { svg: string; parsed: ParsedSvgElement[] }>
private _svgOverlaySorted: { name: string; order: number; parsed: ParsedSvgElement[] }[]
```

### Tile-map (geo-specific)

```typescript
private _geoOverlayParsedCache: Map<string, { svg: string; parsed: ParsedSvgElement[] }>
private _geoOverlaySorted: { name: string; order: number; parsed: ParsedSvgElement[] }[]
```

Reuses parent's `_svgOverlayLayers` map and `_svgOverlayDirty` flag. `_rebuildGeoSvgOverlays()` re-parses only changed layers using `_parseSvgOverlay` (which extracts lat/lon) and rebuilds the sorted draw list.

### Dirty flag

`setSvgOverlay` / `removeSvgOverlay` / `removeSvgOverlaysByPrefix` set the dirty flag. On draw, the rebuild method re-parses only changed layers (by comparing cached SVG strings) and sorts by order then name.

## Resize Tracking

When overlay content changes, `_svgOverlayOriginW`/`_svgOverlayOriginH` capture the current buffer size. On subsequent renders, scale factors `bufferWidth/originW` and `bufferHeight/originH` rescale all coordinates proportionally. Origin also tracks `gfxMode` and re-captures buffer dimensions on mode change.

## Clear-Before-Overlay Logic

When overlay content changes (`_svgOverlayChanged` flag) and no user code manages the drawing buffer (`!onPaint && !onShader`), `_colorBuffer` is cleared to TRANSPARENT before drawing. This prevents stale pixels from old overlays showing through. The clear only runs on the frame where the overlay changes, not every frame, so other drawing-buffer content (e.g. video waveform) is preserved during steady-state rendering.

## AI Convention

AI tools use the `ai:` prefix with order 1000. The draw event value format is `"layername: <svg...>"` which maps to layer `ai:layername`. No prefix defaults to `ai:draw`. Each named layer is independent — the AI can add, update, or replace layers individually.

Examples:
- `"hour-markers: <path .../>"` → layer `ai:hour-markers`
- `"labels: <text ...>NYC</text>"` → layer `ai:labels`
- `"<path .../>"` → layer `ai:draw` (default)

Clearing: empty draw value calls `element.removeSvgOverlaysByPrefix('ai:')`. App layers are untouched.

## Design Notes

- Overlay dithering is intentional — the overlay is part of the rendered image and is dithered consistently with the rest of the content.
- Tile-map uses shared `ParsedSvgElement` types directly, interpreting `x` as lon and `y` as lat.
- The parser/drawer in `src/svg-overlay.ts` is layer-agnostic — it operates on individual SVG strings. All layer management lives in the component classes.
