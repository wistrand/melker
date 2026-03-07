# `<tile-map>` Component Architecture

## Summary

- Interactive slippy map rendered to a canvas with Mercator projection
- Extends `CanvasElement` — inherits dithering, graphics pipeline, shader support
- Built-in tile providers (OpenStreetMap, CARTO, OpenTopoMap, Esri Satellite)
- Mouse drag-to-pan, scroll-wheel zoom, double-click zoom
- Two-tier tile cache: in-memory LRU + disk cache via engine cache API
- Declarative SVG overlay (`<path>` and `<text>` elements with geo coordinates)
- Overlay drawing callback with geo coordinate transforms

## Overview

| Property    | Value                                                            |
|-------------|------------------------------------------------------------------|
| Type        | `tile-map`                                                       |
| File        | [src/components/tile-map.ts](../src/components/tile-map.ts)      |
| Extends     | `CanvasElement` (which extends `Element`)                        |
| Interfaces  | `Draggable`, `Wheelable`                                         |
| Layout      | Responsive — supports `width="100%"` / `height="100%"`           |
| Interaction | Mouse drag, scroll wheel, double-click                           |

## Class Hierarchy

```
Element -> CanvasElement -> TileMapElement
```

`TileMapElement extends CanvasElement` because it needs:
- `onPaint`-style canvas rendering (`drawImage`, `drawImageRegion`, `clear`)
- `decodeImageBytes` for PNG tile decoding
- Pixel aspect ratio handling (sextant 2x3 cells)
- Responsive width/height (same `parseDimension` pattern as `<img>`)
- Graphics pipeline (sextant, sixel, kitty, halfblock, etc.)
- Dither mode support
- Shader infrastructure (`_runShaderOverPaint`)
- Text label overlay (`drawText` / `drawTextColor`)

## Props

| Prop               | Type                       | Default         | Description                                             |
|--------------------|----------------------------|-----------------|---------------------------------------------------------|
| `lat`              | `number`                   | `51.5074`       | Center latitude                                         |
| `lon`              | `number`                   | `-0.1278`       | Center longitude                                        |
| `zoom`             | `number`                   | `5`             | Zoom level (0-20)                                       |
| `provider`         | `string`                   | `'openstreetmap'` | Key into providers map                                |
| `providers`        | `Record<string, TileProvider>` | —           | Custom providers (merged with built-ins)                |
| `width`            | `number \| string`         | `'100%'`        | Width in columns or percentage                          |
| `height`           | `number \| string`         | `'100%'`        | Height in rows or percentage                            |
| `interactive`      | `boolean`                  | `true`          | Enable mouse interaction (drag/scroll/double-click)     |
| `maxZoom`          | `number`                   | `20`            | Maximum zoom level                                      |
| `cacheSize`        | `number`                   | `256`           | In-memory tile cache size (tiles)                       |
| `diskCache`        | `boolean`                  | `true`          | Enable disk caching via engine cache API                |
| `diskCacheMaxMB`   | `number`                   | `200`           | Disk cache budget in MB                                 |
| `dither`           | `string`                   | `'auto'`        | Dithering algorithm (inherited from CanvasElement)      |
| `svgOverlay`       | `string`                   | —               | Declarative SVG `<path>` and `<text>` elements with lat/lon coords |
| `onOverlay`        | `(event) => void`          | —               | Overlay drawing callback (after tiles, before shader)   |
| `onMove`           | `(event) => void`          | —               | Fires when map position changes (drag, pan, setView)    |
| `onZoom`           | `(event) => void`          | —               | Fires when zoom level changes                           |
| `onClick`          | `(event) => void`          | —               | Fires on map click with lat/lon                         |
| `onLoadingChange`  | `(event) => void`          | —               | Fires when tile loading count changes                   |
| `onShader`         | `ShaderCallback`           | —               | Per-pixel post-processing (inherited from CanvasElement)|
| `shaderFps`        | `number`                   | `30`            | Shader frame rate; `0` for static filter                |
| `shaderRunTime`    | `number`                   | —               | Stop shader after N ms                                  |

## Built-in Providers

| Key                | Name              | Source                   | Max Zoom |
|--------------------|-------------------|--------------------------|----------|
| `openstreetmap`    | OpenStreetMap     | tile.openstreetmap.org   | 19       |
| `terrain`          | Terrain           | tile.opentopomap.org     | 15       |
| `streets`          | Streets           | CARTO (light_all)        | 18       |
| `voyager`          | Voyager           | CARTO (voyager)          | 18       |
| `voyager-nolabels` | Voyager No Labels | CARTO (voyager_nolabels) | 18       |
| `satellite`        | Satellite         | Esri (World_Imagery)     | 17       |

Provider hosts are defined in [src/policy/tile-map-hosts.ts](../src/policy/tile-map-hosts.ts) as `MAP_NET_HOSTS`, shared between the component (CARTO subdomain derivation) and the policy system (`"map": true` shortcut).

Custom providers can be added via the `providers` prop, which merges with built-ins.

## Usage

### Basic

```html
<tile-map lat="51.5074" lon="-0.1278" zoom="12" width="100%" height="100%" />
```

### With overlay and shader

```html
<tile-map
  id="map"
  lat="51.5074" lon="-0.1278" zoom="13"
  provider="satellite"
  width="100%" height="100%"
  dither="auto"
  onOverlay="$app.drawMarkers(event)"
  onShader="$app.nightVision()"
  shaderFps="0"
  onMove="$app.onMapMove(event)"
/>
```

### Policy

Apps using `<tile-map>` need the `"map": true` policy shortcut, which expands to the built-in tile server hosts:

```json
{
  "permissions": {
    "map": true
  }
}
```

If using shaders, also add `"shader": true`. App-specific hosts (e.g., Nominatim for geocoding) are still declared separately in `net`.

## Programmatic API

```typescript
const map = $melker.getElementById('map');

// Navigation
map.setView(lat, lon, zoom?);       // Jump to location
map.setZoom(zoom);                   // Change zoom level
map.panUp() / panDown() / panLeft() / panRight();  // Pan by a fraction of viewport
map.zoomIn() / zoomOut();            // Step zoom +/- 1

// Read state
map.getCenter();                     // { lat: number, lon: number }
map.getZoom();                       // number
map.getBoundsLatLon();               // { north, south, east, west }

// Coordinate transforms
map.latLonToPixel(lat, lon);         // { x, y } | null (null if off-screen)
map.pixelToLatLon(x, y);            // { lat, lon }

// Cache
map.clearCache();                    // Clear disk + memory tile cache

// Provider
map.props.provider = 'satellite';    // Switch tile provider
```

## Overlay Drawing (onOverlay)

The `onOverlay` callback fires after tiles are rendered but before shader post-processing. It provides the canvas drawing API and geo coordinate transforms.

### Overlay Event

```typescript
interface TileMapOverlayEvent {
  canvas: CanvasElement;    // drawLine, drawRect, drawCircle, drawText, setPixel, setColor, etc.
  bounds: Bounds;           // Element bounds in terminal cells
  geo: TileMapGeoContext;   // Coordinate transforms
}

interface TileMapGeoContext {
  latLonToPixel(lat: number, lon: number): { x: number; y: number } | null;
  pixelToLatLon(x: number, y: number): { lat: number; lon: number };
  getVisibleBounds(): { north: number; south: number; east: number; west: number };
  center: { lat: number; lon: number };  // Read-only
  zoom: number;                          // Read-only
  pixelAspect: number;                   // Read-only
}
```

`latLonToPixel` returns `null` when the coordinate is outside the visible viewport (useful for culling off-screen markers).

### Example

```typescript
export function drawMarkers(event) {
  const { canvas, geo } = event;
  for (const m of markers) {
    const pos = geo.latLonToPixel(m.lat, m.lon);
    if (!pos) continue;  // Off-screen
    canvas.setColor(0xFF0000FF);
    canvas.drawCircle(pos.x, pos.y, 4);
  }
}
```

## SVG Overlay (svgOverlay)

The `svgOverlay` prop provides a declarative alternative to `onOverlay` for drawing geo-anchored paths and text labels. Path coordinates use standard SVG order: **x=lon, y=lat**. Text elements use explicit `lat`/`lon` attributes.

### Syntax

```html
<tile-map svgOverlay='
  <path d="M -0.1278 51.5074 L -0.1419 51.5014 Z" stroke="red" fill="blue"/>
  <path d="M -0.076 51.508 L -0.098 51.513" stroke="#00FF00"/>
  <text lat="51.5074" lon="-0.1278" fill="#fff" text-anchor="middle">London</text>
'/>
```

### `<path>` attributes

| Attribute | Description                                                                |
|-----------|----------------------------------------------------------------------------|
| `d`       | SVG path commands in standard SVG order: x=lon, y=lat (M, L, H, V, Q, T, C, S, A, Z) |
| `stroke`  | CSS color string for outline                                               |
| `fill`    | CSS color string for fill                                                  |

Drawing order: fill first, then stroke on top. If neither is set, strokes with the current canvas color.

### `<text>` attributes

| Attribute      | Description                                                    |
|----------------|----------------------------------------------------------------|
| `lat`, `lon`   | Geo coordinates for label position (required)                  |
| `fill`         | Text foreground color (CSS string, default `#ffffff`)          |
| `bg`           | Text background color (CSS string). Alias: `background`        |
| `text-anchor`  | `"start"` (default), `"middle"` (center), or `"end"` (right)  |
| `align`        | Alternative to text-anchor: `"left"`, `"center"`, `"right"`   |

Text is rendered as terminal characters (not pixels), overlaid on the canvas after sextant rendering. Labels are geo-anchored and move with pan/zoom.

### Dynamic updates

```javascript
const map = $melker.getElementById('map');
map.props.svgOverlay = `
  <path d="M -74.0060 40.7128 L -118.2437 34.0522" stroke="red"/>
  <text lat="40.7128" lon="-74.006" fill="#ff0" text-anchor="middle">NYC</text>
`;
```

The component caches parsed elements and only re-parses when the string value changes.

## Render Pipeline

```
1. Tiles rendered to color buffer (internal onPaint)
     - Viewport tiling with Mercator projection
     - Over-zoom scaling (beyond provider maxZoom)
     - Pixel aspect ratio correction (sextant 2x3)
     - Fallback tiles from parent zoom levels while loading
2. Tile blur (box blur, optional) — smooths sextant rendering artifacts
3. Tile filter — Oklab adjustments OR color key classification
4. svgOverlay <path> elements — geo-anchored vector paths drawn to pixel buffer
5. onOverlay(canvas, bounds, geo) — app draws markers, routes, etc. to pixel buffer
6. onShader runs per-pixel over combined buffer — post-processing
7. Buffer rendered to terminal (sextant/sixel/kitty/halfblock/etc.)
8. svgOverlay <text> elements — rendered as terminal characters on top of canvas
9. Text labels from drawText/drawTextColor calls — rendered on top of canvas
```

Note: `<text>` elements and `drawText()` calls produce terminal characters, not pixels. They are rendered after the pixel buffer is converted to terminal cells (step 5), so they appear crisp regardless of canvas resolution.

## Tile Filter

The tile filter operates in screen space after tiles are composited into `_colorBuffer`, applying per-pixel adjustments in Oklab perceptual color space. There are two mutually exclusive modes: **Oklab adjustments** (contrast/saturation/brightness/hue) and **color key** classification.

### Why Screen Space

Decoded tiles are 256x256 (~65k pixels each), but the screen buffer is much smaller (e.g. sextant 320x144 = ~46k pixels total). Filtering the composited result avoids per-tile work, needs no cache key changes, and takes effect immediately on next render.

### Why Oklab

- **Brightness** on Oklab L is perceptually uniform — equal steps look equally bright on dark ocean and bright desert
- **Contrast** as a multiplier on L around midpoint is perceptually correct
- **Saturation** maps to Oklab chroma scaling (perceptually uniform, unlike HSL)
- **Hue** rotation in Oklab preserves perceived lightness (HSL causes brightness wobble)
- **Performance**: sRGB↔linear LUTs are pre-computed; one color space round-trip per pixel

### Oklab Adjustment Style Props

| Style prop         | Type     | Default | Description                              |
|--------------------|----------|---------|------------------------------------------|
| `tile-contrast`    | `number` | `1`     | 0-2, multiplier on L around midpoint     |
| `tile-saturation`  | `number` | `1`     | 0-2, multiplier on chroma                |
| `tile-brightness`  | `number` | `0`     | -1 to 1, additive on L (Oklab scale 0-1) |
| `tile-hue`         | `number` | `0`     | -180 to 180 degrees, rotation of a,b     |

Example:
```css
tile-map { tile-contrast: 1.4; tile-saturation: 0.6; }
```

### Blur Style Prop

| Style prop    | Type     | Default | Description                                |
|---------------|----------|---------|--------------------------------------------|
| `tile-blur`   | `number` | `0`     | Box blur radius in pixels (0=off, 1=3x3, 2=5x5) |

Applied before filtering. Smooths sextant rendering artifacts for cleaner color key classification. Uses a reusable `_blurTempBuffer` to avoid per-frame allocation.

### Color Key Style Props

Color key classifies pixels by Oklab chroma distance from a reference color, producing clean binary or tinted output (e.g. water vs land separation). Active when `tile-key-color` is set; disables Oklab adjustments.

| Style prop              | Type     | Default | Description                                    |
|-------------------------|----------|---------|------------------------------------------------|
| `tile-key-color`        | `color`  | —       | Reference color for keying (e.g. `#abd0e0`)    |
| `tile-key-threshold`    | `number` | `0.05`  | Oklab chroma distance cutoff                   |
| `tile-key-match`        | `number` | `0`     | L value for matching pixels (0=black)          |
| `tile-key-match-color`  | `color`  | —       | Color for matching pixels (overrides L value)  |
| `tile-key-other`        | `number` | `1`     | L value for non-matching pixels (1=white)      |
| `tile-key-other-color`  | `color`  | —       | Color for non-matching pixels (overrides L value) |

The distance metric uses chroma only (`sqrt((a-ak)² + (b-bk)²)`), ignoring lightness L. This separates features like water and land that differ in hue but may have similar brightness.

Example — dark water, white land:
```css
tile-map {
  tile-key-color: #abd0e0;
  tile-key-threshold: 0.04;
  tile-key-match: 0.1;
  tile-key-other: 1;
  tile-blur: 1;
}
```

Example — tinted output (blue water, gray land):
```css
tile-map {
  tile-key-color: #abd0e0;
  tile-key-threshold: 0.04;
  tile-key-match-color: #2a4a6b;
  tile-key-other-color: #c8c8c8;
  tile-blur: 1;
}
```

## Internal Architecture

### State Management

The component owns mutable internal state (`_centerLat`, `_centerLon`, `_zoom`, `_currentProvider`) initialized from props. To detect external prop changes vs. internal state drift (from drag/zoom), it tracks last-seen prop values (`_lastPropLat`, etc.). On each render, if a prop differs from its last-seen value, the internal state is updated; otherwise the internal state (modified by mouse interaction) is preserved.

### Tile Fetching

The fetch pipeline runs per-tile, fire-and-forget:

```
1. Check in-memory LRU cache -> hit: return immediately
2. Already fetching this tile? -> skip (deduplicated via _pendingFetches Set)
3. Check disk cache (engine.cache.read) -> hit: decode + cache in memory
4. Fetch from network -> decode -> cache in memory + write to disk cache
5. markDirty() + engine.render() to trigger re-paint with new tile
```

Tiles are decoded via `CanvasElement.decodeImageBytes()` (PNG -> RGBA pixel data).

### In-Memory Cache

LRU cache using `Map` insertion order. Configurable size via `cacheSize` prop (default: 256 tiles). On access, entries are re-inserted to maintain LRU ordering.

### Disk Cache

Uses the engine cache API (`engine.cache.read/write` in [src/engine-cache.ts](../src/engine-cache.ts)). Tiles are stored under the `tiles` namespace with keys like `openstreetmap/12/2048_1024`. The engine cache handles LRU eviction by namespace budget (`diskCacheMaxMB` prop, default: 200 MB).

### Fallback Tiles

When a tile is not yet loaded, the component searches up to 4 parent zoom levels for a cached tile and extracts the relevant quadrant, scaling it up. This provides immediate visual feedback while the correct tile loads.

### Mouse Interaction

- **Drag-to-pan**: Implements `Draggable` interface. Converts terminal cell delta to Mercator coordinate delta using current zoom scale.
- **Scroll-wheel zoom**: Implements `Wheelable` interface. Steps zoom +/- 1, clamped to [0, maxZoom].
- **Double-click zoom**: Detected via 400ms time threshold + 2-cell distance threshold. Zooms in at cursor position, adjusting center to keep the clicked location stationary.

### SVG Overlay Parsing

The `_parseSvgOverlay` method uses regex-based extraction (not a full XML parser) to parse `<path>` and `<text>` elements from the `svgOverlay` string. Results are cached and only re-parsed when the string value changes.

For `<path>` elements, the `d` attribute is parsed by `parseSVGPath()` from [canvas-path.ts](../src/components/canvas-path.ts), which tokenizes and converts all commands to absolute coordinates. The `_transformToPixel` method then converts lat/lon coordinates to pixel space via Mercator projection for each path command type.

For `<text>` elements, lat/lon is converted to pixel coordinates and passed to `canvas.drawTextColor()`, which queues the label for rendering as terminal characters after the pixel buffer is rasterized.

### Mercator Projection

Static utility functions exported for testability:

```typescript
latToMercatorY(lat)   // lat -> [0,1] Mercator Y
mercatorYToLat(y)     // [0,1] Mercator Y -> lat
lonToMercatorX(lon)   // lon -> [0,1] Mercator X
mercatorXToLon(x)     // [0,1] Mercator X -> lon
```

Tile coordinates: `TileMapElement.latLonToTile(lat, lon, zoom)` returns tile x/y and sub-tile offset.

### Responsive Sizing

Follows the same pattern as `<img>`: dimensions can be percentages (e.g., `"100%"`) resolved against parent bounds via `parseDimension()`. Canvas buffer is resized on bounds change.

## Policy System Integration

The `"map": true` policy shortcut ([src/policy/shortcut-utils.ts](../src/policy/shortcut-utils.ts)) expands to the hosts in `MAP_NET_HOSTS`. This works like other shortcuts (`"ai"`, `"clipboard"`, `"browser"`):

- Declared in `PolicyPermissions` interface as `map?: boolean`
- Expanded by `expandShortcutsInPlace()` into `net` array entries
- Listed in `BOOLEAN_PERMISSIONS` for CLI override support (`--allow-map`, `--deny-map`)
- Displayed as `map: enabled` in the approval prompt
- Map-derived hosts are filtered from the `net:` display line to avoid clutter

## AI Accessibility

The tile-map component integrates with the AI accessibility system ([src/ai/context.ts](../src/ai/context.ts), [src/ai/tools.ts](../src/ai/tools.ts)):

**Reading state**: The AI sees `[Tile Map#id: lat=N, lon=N, zoom=N, provider=NAME, paths=N, labels=N]` in the screen content. The `read_element` tool returns the same information plus available providers.

**Changing view**: `send_event` with `event_type="change"` and `value="lat=N,lon=N,zoom=N,provider=NAME"` (all fields optional). Calls `setView()` / `setZoom()` and updates the provider.

**Drawing overlay**: `send_event` with `event_type="draw"` and value containing `<path>` and/or `<text>` elements. Sets `svgOverlay` prop. Empty value clears the overlay.

## Keyboard Navigation

Keyboard bindings are **app-level**, not built into the component. Apps use `<command>` elements that call the programmatic API:

```html
<command key="ArrowUp,w,k" label="Pan Up" global onExecute="$app.panUp()" />
<command key="+,=" label="Zoom In" global onExecute="$app.zoomIn()" />
```

This keeps the component focused on rendering and mouse interaction, giving apps full control over key bindings.

## Files

| File                                                                                         | Description                              |
|----------------------------------------------------------------------------------------------|------------------------------------------|
| [src/components/tile-map.ts](../src/components/tile-map.ts)                                  | Component implementation                 |
| [src/policy/tile-map-hosts.ts](../src/policy/tile-map-hosts.ts)                              | Shared `MAP_NET_HOSTS` constant          |
| [src/engine-cache.ts](../src/engine-cache.ts)                                                | Engine cache API (disk tile cache)       |
| [src/ai/context.ts](../src/ai/context.ts)                                                    | AI screen content (tile-map case)        |
| [src/ai/tools.ts](../src/ai/tools.ts)                                                        | AI tools (read/change/draw tile-map)     |
| [src/policy/shortcut-utils.ts](../src/policy/shortcut-utils.ts)                              | `"map": true` shortcut expansion         |
| [src/policy/types.ts](../src/policy/types.ts)                                                | `map?: boolean` in PolicyPermissions     |
| [src/policy/permission-overrides.ts](../src/policy/permission-overrides.ts)                  | `--allow-map` / `--deny-map` CLI support |
| [src/policy/approval.ts](../src/policy/approval.ts)                                          | `map: enabled` in approval prompt        |
| [tests/tile_map_test.ts](../tests/tile_map_test.ts)                                          | Mercator math, providers, API tests      |
| [examples/showcase/map.melker](../examples/showcase/map.melker)                              | Full map viewer app                      |
| [examples/components/tile-map-overlay.melker](../examples/components/tile-map-overlay.melker) | Overlay demo (markers + route)           |
| [examples/components/tile-map-shader.melker](../examples/components/tile-map-shader.melker)  | Shader demo (night vision, sepia, etc.)  |
| [examples/components/tile-map-overlay-shader.melker](../examples/components/tile-map-overlay-shader.melker) | Combined overlay + shader demo |
| [examples/components/tile-map-svg-paths.melker](../examples/components/tile-map-svg-paths.melker) | SVG overlay demo (paths + labels)   |
