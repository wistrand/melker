# Map Viewer Example

A full-featured map viewer demonstrating advanced Melker patterns.

**Source:** [examples/showcase/map.melker](../examples/showcase/map.melker)

## Melker Patterns Demonstrated

### Tile Map Component

The `<tile-map>` component handles all map rendering, tile fetching, caching, and mouse interaction. Apps focus on UI around the map.

```xml
<tile-map id="map" lat="51.5074" lon="-0.1278" zoom="5"
          provider="openstreetmap" width="100%" height="100%"
          onOverlay="$app.drawOverlay(event)"
          onTooltip="$app.onTooltip(event)"
          onMove="$app.onMove(event)" />
```

See [tile-map-architecture.md](tile-map-architecture.md) for full component docs.

### Command Line Arguments via Template Substitution

Arguments are accessed using `${argv[N]:-default}` syntax in both markup and scripts:

```xml
<slider value="${argv[2]:-5}" />
<select selectedValue="${argv[3]:-openstreetmap}">
```

```typescript
// In <script type="typescript">
const argLocation = "${argv[1]:-}".trim();
const argZoom = "${argv[2]:-}".trim();

// Initialize variables from args at parse time (before first render)
export let zoom = argZoom ? parseInt(argZoom, 10) : 5;
```

### Variable Sharing Between Script Blocks

Exported `let` variables can't be directly modified from `<script async="ready">` because primitive exports are copied by value to `$app`. Use setter functions:

```typescript
// Main <script type="typescript">
export let zoom = 5;
export function setZoom(z: number) { zoom = z; }
export function setCenter(lat: number, lon: number) {
  centerLat = lat;
  centerLon = lon;
}

// <script async="ready">
$app.setZoom(12);     // Works - calls function in main script scope
$app.zoom = 12;       // Doesn't work - sets copy, not original
```

### Overlay Drawing

The `onOverlay` callback provides canvas drawing API with geo coordinate transforms:

```typescript
export function drawOverlay(event) {
  const { canvas, geo } = event;
  for (const marker of markers) {
    const pos = geo.latLonToPixel(marker.lat, marker.lon);
    if (!pos) continue;  // Off-screen
    canvas.fillCircleCorrectedColor(pos.x, pos.y, 3, 'red');
    canvas.drawTextColor(pos.x, pos.y - 10, marker.name, '#fff', { align: 'center' });
  }
}
```

### SVG Overlay Layers

Declarative paths and text labels with geo coordinates, managed as named layers:

```typescript
const map = $melker.getElementById('map');
map.setSvgOverlay('routes', `
  <path d="M -0.1 51.5 L 2.3 48.8" stroke="red"/>
  <text lat="51.5" lon="-0.1" fill="#fff" text-anchor="middle">London</text>
`);
map.removeSvgOverlay('routes');  // Remove the layer
```

### Autocomplete with Async Search

```xml
<autocomplete
  id="search"
  placeholder="Search..."
  minChars="3"
  onSearch="$app.onSearchInput(event.query)"
  onSelect="$app.onLocationSelect(event)"
/>
```

```typescript
// Return array of options from async search
export async function onSearchInput(query: string): Promise<{ id: string; label: string }[]> {
  const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${query}&format=json`);
  const data = await response.json();
  return data.map(item => ({ id: item.place_id, label: item.display_name }));
}

export function onLocationSelect(event: { value: string; label: string }) {
  // Navigate map to selected location
}
```

### Mouse Event Handlers on Canvas

```xml
<img
  onMouseDown="$app.onMouseDown(event)"
  onMouseMove="$app.onMouseMove(event)"
  onMouseUp="$app.onMouseUp(event)"
  onWheel="$app.onWheel(event)"
  onKeyPress="$app.onKeyPress(event)"
/>
```

```typescript
export function onMouseDown(event: { x: number; y: number; button: number; shiftKey?: boolean }) {
  // x, y are terminal cell coordinates
  // Convert to buffer pixels: bufferX = x * 2, bufferY = y * 3 (sextant)
}

export function onWheel(event: { deltaY: number; x: number; y: number }) {
  const zoomingIn = event.deltaY < 0;
}
```

### Help Tag with Markdown

The `<help>` tag content is shown in DevTools (F12 > Help tab):

```xml
<help>
## Usage
```
app.melker [args]
```

| Argument | Description      |
|----------|------------------|
| foo      | Does something   |
</help>
```

### Loading Indicator Pattern

```typescript
let loadingCount = 0;

function setLoading(loading: boolean) {
  if (loading) {
    loadingCount++;
  } else {
    loadingCount = Math.max(0, loadingCount - 1);
  }
  const el = $melker.getElementById('loading');
  el.setValue(loadingCount > 0 ? `${loadingCount}` : '');

  // Trigger render when loading finishes to clear text
  if (loadingCount === 0) {
    $melker.render();
  }
}

// Usage in async operations
setLoading(true);
try {
  await fetchData();
} finally {
  setLoading(false);
}
```

## Permissions

The `map` shortcut covers all built-in tile providers. Add app-specific hosts separately:

```json
{
  "permissions": {
    "map": true,
    "net": ["nominatim.openstreetmap.org"],
    "browser": true
  }
}
```
