# Map Viewer Example

A tile-based map viewer demonstrating advanced Melker patterns.

**Source:** [examples/showcase/map.melker](../examples/showcase/map.melker)

## Melker Patterns Demonstrated

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

### Delaying First Render

To show blank canvas until async operation completes:

```typescript
// Main script - flag based on whether we need to wait
let waitingForLocation = !!argLocation;
export function setReady() { waitingForLocation = false; }

// In onPaint handler - early return if waiting
export function onPaint(event) {
  canvas.clear();
  if (waitingForLocation) return;  // Don't render content yet
  // ... render content
}

// Ready script - clear flag when done
const results = await $app.onSearchInput(location);
$app.setReady();  // Now onPaint will render
$app.updateUI();
```

### Canvas onPaint Handler

The `onPaint` callback receives canvas API and bounds for custom drawing:

```typescript
export function onPaint(event: { canvas: any; bounds: { width: number; height: number } }) {
  const { canvas, bounds } = event;
  const bufferWidth = canvas.getBufferWidth();
  const bufferHeight = canvas.getBufferHeight();
  const pixelAspect = canvas.getPixelAspectRatio();  // ~0.67 for sextant

  canvas.clear();
  canvas.drawImage(tile, x, y, width, height);
  canvas.drawImageRegion(tile, sx, sy, sw, sh, dx, dy, dw, dh);
}
```

### Triggering Re-render from Async Code

After async operations, manually trigger re-render:

```typescript
function requestRepaint() {
  const mapEl = $melker.getElementById('map') as any;
  mapEl.markDirty();    // Mark canvas content as changed
  $melker.render();     // Trigger actual render pass
}

// In async fetch callback
const tile = await fetchTile(x, y, z);
requestRepaint();  // Show newly loaded tile
```

### Decoding Images Programmatically

Canvas elements expose `decodeImageBytes()` (sync, PNG/JPEG/GIF) and `decodeImageBytesAsync()` (async, all formats including WebP) for loading images from raw bytes:

```typescript
const response = await fetch(tileUrl);
const bytes = new Uint8Array(await response.arrayBuffer());

const mapEl = $melker.getElementById('map') as any;
const decoded = mapEl.decodeImageBytes(bytes);       // sync (PNG/JPEG/GIF)
const decoded = await mapEl.decodeImageBytesAsync(bytes);  // async (all formats + WebP)
// decoded: { width, height, data: Uint8ClampedArray, bytesPerPixel }
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
  const response = await fetch(`https://api.example.com/search?q=${query}`);
  const data = await response.json();
  return data.map(item => ({ id: item.id, label: item.name }));
}

export function onLocationSelect(event: { value: string; label: string }) {
  // event.value is the selected option's id
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

### File Caching with LRU Eviction

Tiles are cached on disk under `$melker.cacheDir/tiles/{provider}/{z}/{x}_{y}.png`. An in-memory index tracks file size and last-access time for LRU eviction when total size exceeds 200 MB (evicts to 80% with hysteresis).

```typescript
// Data structure
interface FileCacheEntry {
  path: string;
  size: number;       // bytes on disk
  lastAccess: number; // Date.now() on last read or write
}
const fileCacheIndex = new Map<string, FileCacheEntry>();
let fileCacheTotalBytes = 0;
const MAX_FILE_CACHE_BYTES = 200 * 1024 * 1024;
```

**Eager initialization**: `initTileCache()` starts eagerly in the main `<script>` block (at parse time), not in `<script async="ready">`. The returned promise is stored as `fileCacheReady`, and `fetchTile()` awaits it before checking the file cache. This prevents a race where the first `onPaint` would fire before the cache directory is ready, causing tiles to bypass the file cache and always hit the network.

```typescript
// Main <script> — starts immediately at parse time
const fileCacheReady = initTileCache();

// In fetchTile() — gates on init before file cache check
await fileCacheReady;
```

**Startup scan**: `initTileCache()` walks the cache directory, stats each `.png`, and populates the index sorted by mtime (oldest first). This seeds LRU order from filesystem timestamps.

**Access tracking**: `loadTileFromFile()` updates `lastAccess` and moves the entry to the end of the Map (LRU promotion). Filesystem mtime is not reliable for reads, so tracking is in-memory only.

**Eviction**: `saveTileToFile()` adds entries to the index and triggers `evictOldFiles()` when over budget. Eviction iterates the Map from oldest, deleting files until at 80% of the limit. All deletions are logged at `info` level via `$melker.logger`.

A `clearFileCache()` function is available for full manual purge — it deletes all cached files and cleans up empty subdirectories.

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

Network permissions for tile servers and geocoding:

```json
{
  "permissions": {
    "net": [
      "tile.openstreetmap.org",
      "cartodb-basemaps-a.global.ssl.fastly.net",
      "cartodb-basemaps-b.global.ssl.fastly.net",
      "cartodb-basemaps-c.global.ssl.fastly.net",
      "cartodb-basemaps-d.global.ssl.fastly.net",
      "tile.opentopomap.org",
      "server.arcgisonline.com",
      "nominatim.openstreetmap.org"
    ],
    "browser": true
  }
}
```
