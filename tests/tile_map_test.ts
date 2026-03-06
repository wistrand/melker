import { assertEquals, assertAlmostEquals, assertNotEquals } from 'jsr:@std/assert';
import {
  latToMercatorY, mercatorYToLat, lonToMercatorX, mercatorXToLon,
  TileMapElement, BUILT_IN_PROVIDERS,
  type TileMapGeoContext, type TileMapOverlayEvent,
} from '../src/components/tile-map.ts';

// ===== Mercator Projection Tests =====

Deno.test('Mercator: equator maps to Y=0.5', () => {
  assertAlmostEquals(latToMercatorY(0), 0.5, 1e-10);
});

Deno.test('Mercator: prime meridian maps to X=0.5', () => {
  assertAlmostEquals(lonToMercatorX(0), 0.5, 1e-10);
});

Deno.test('Mercator: lat round-trip at various latitudes', () => {
  for (const lat of [0, 10, 30, 45, 60, 80, -30, -60, -80]) {
    const y = latToMercatorY(lat);
    const roundTrip = mercatorYToLat(y);
    assertAlmostEquals(roundTrip, lat, 1e-8, `lat ${lat} round-trip failed`);
  }
});

Deno.test('Mercator: lon round-trip at various longitudes', () => {
  for (const lon of [0, 45, 90, 135, 180, -45, -90, -135, -180]) {
    const x = lonToMercatorX(lon);
    const roundTrip = mercatorXToLon(x);
    assertAlmostEquals(roundTrip, lon, 1e-8, `lon ${lon} round-trip failed`);
  }
});

Deno.test('Mercator: northern latitudes map to Y < 0.5', () => {
  const y = latToMercatorY(51.5);
  assertEquals(y < 0.5, true, `Expected Y < 0.5 for lat=51.5, got ${y}`);
});

Deno.test('Mercator: southern latitudes map to Y > 0.5', () => {
  const y = latToMercatorY(-33.8);
  assertEquals(y > 0.5, true, `Expected Y > 0.5 for lat=-33.8, got ${y}`);
});

Deno.test('Mercator: antimeridian lon=180 maps to X=1', () => {
  assertAlmostEquals(lonToMercatorX(180), 1.0, 1e-10);
});

Deno.test('Mercator: lon=-180 maps to X=0', () => {
  assertAlmostEquals(lonToMercatorX(-180), 0.0, 1e-10);
});

// ===== Tile Coordinate Tests =====

Deno.test('Tile coords: zoom 0 returns single tile', () => {
  const result = TileMapElement.latLonToTile(0, 0, 0);
  assertEquals(result.x, 0);
  assertEquals(result.y, 0);
});

Deno.test('Tile coords: offset is in [0,1)', () => {
  const result = TileMapElement.latLonToTile(51.5, -0.1, 10);
  assertEquals(result.offsetX >= 0 && result.offsetX < 1, true);
  assertEquals(result.offsetY >= 0 && result.offsetY < 1, true);
});

Deno.test('Tile coords: zoom level increases tile count', () => {
  const z5 = TileMapElement.latLonToTile(51.5, -0.1, 5);
  const z10 = TileMapElement.latLonToTile(51.5, -0.1, 10);
  assertEquals(z10.x > z5.x, true, 'Higher zoom should produce larger tile X');
  assertEquals(z10.y > z5.y, true, 'Higher zoom should produce larger tile Y');
});

// ===== Provider URL Tests =====

Deno.test('Provider URL: {z}/{x}/{y} substitution', () => {
  const provider = { name: 'test', url: 'https://example.com/{z}/{x}/{y}.png', attribution: '', maxZoom: 19 };
  const url = TileMapElement.getTileUrl(10, 20, 5, provider);
  assertEquals(url, 'https://example.com/5/10/20.png');
});

Deno.test('Provider URL: {s} subdomain rotation', () => {
  const provider = { name: 'test', url: 'https://{s}.example.com/{z}/{x}/{y}.png', attribution: '', maxZoom: 19, subdomains: ['a', 'b', 'c'] };
  const url = TileMapElement.getTileUrl(0, 0, 1, provider);
  assertEquals(url.includes('.example.com/'), true);
  // Subdomain should be one of a, b, c
  const match = url.match(/https:\/\/([abc])\.example\.com/);
  assertEquals(match !== null, true, `URL should contain subdomain: ${url}`);
});

Deno.test('Provider URL: all built-in providers have valid URLs', () => {
  for (const [key, provider] of Object.entries(BUILT_IN_PROVIDERS)) {
    const url = TileMapElement.getTileUrl(10, 20, 5, provider);
    assertEquals(url.includes('{z}'), false, `${key}: unresolved {z} in URL`);
    assertEquals(url.includes('{x}'), false, `${key}: unresolved {x} in URL`);
    assertEquals(url.includes('{y}'), false, `${key}: unresolved {y} in URL`);
    assertEquals(url.includes('{s}'), false, `${key}: unresolved {s} in URL`);
    assertEquals(url.startsWith('https://'), true, `${key}: URL should be https`);
  }
});

// ===== Component Tests =====

Deno.test('TileMapElement: default props', () => {
  const el = new TileMapElement({});
  assertEquals(el.type, 'tile-map');
  const center = el.getCenter();
  assertAlmostEquals(center.lat, 51.5074, 0.001);
  assertAlmostEquals(center.lon, -0.1278, 0.001);
  assertEquals(el.getZoom(), 5);
});

Deno.test('TileMapElement: custom lat/lon/zoom', () => {
  const el = new TileMapElement({ lat: 40.7128, lon: -74.006, zoom: 10 });
  const center = el.getCenter();
  assertAlmostEquals(center.lat, 40.7128, 0.001);
  assertAlmostEquals(center.lon, -74.006, 0.001);
  assertEquals(el.getZoom(), 10);
});

Deno.test('TileMapElement: setView updates center', () => {
  const el = new TileMapElement({});
  el.setView(35.6762, 139.6503, 8);
  const center = el.getCenter();
  assertAlmostEquals(center.lat, 35.6762, 0.001);
  assertAlmostEquals(center.lon, 139.6503, 0.001);
  assertEquals(el.getZoom(), 8);
});

Deno.test('TileMapElement: panUp changes latitude', () => {
  const el = new TileMapElement({ lat: 50, lon: 0, zoom: 5 });
  const before = el.getCenter().lat;
  el.panUp();
  assertEquals(el.getCenter().lat > before, true);
});

Deno.test('TileMapElement: zoomIn/zoomOut', () => {
  const el = new TileMapElement({ zoom: 5 });
  el.zoomIn();
  assertEquals(el.getZoom(), 6);
  el.zoomOut();
  assertEquals(el.getZoom(), 5);
});

Deno.test('TileMapElement: zoomIn capped at maxZoom', () => {
  const el = new TileMapElement({ zoom: 20, maxZoom: 20 });
  el.zoomIn();
  assertEquals(el.getZoom(), 20);
});

Deno.test('TileMapElement: zoomOut capped at 0', () => {
  const el = new TileMapElement({ zoom: 0 });
  el.zoomOut();
  assertEquals(el.getZoom(), 0);
});

Deno.test('TileMapElement: custom providers merge with built-ins', () => {
  const custom = {
    'custom-tiles': {
      name: 'Custom',
      url: 'https://custom.example.com/{z}/{x}/{y}.png',
      attribution: 'Custom',
      maxZoom: 15,
    },
  };
  const el = new TileMapElement({ providers: custom, provider: 'custom-tiles' });
  // Should not throw, provider should be accessible
  assertEquals(el.getZoom(), 5);
});

Deno.test('TileMapElement: onMove fires on setView', () => {
  let fired = false;
  const el = new TileMapElement({
    onMove: () => { fired = true; },
  });
  el.setView(40, 10);
  assertEquals(fired, true);
});

Deno.test('TileMapElement: onZoom fires on setZoom', () => {
  let zoomValue = -1;
  const el = new TileMapElement({
    onZoom: (e) => { zoomValue = e.zoom; },
  });
  el.setZoom(12);
  assertEquals(zoomValue, 12);
});

// ===== Geo Context Tests (latLonToPixel / pixelToLatLon) =====

Deno.test('TileMapElement: latLonToPixel returns center for map center', () => {
  const el = new TileMapElement({ lat: 51.5, lon: -0.1, zoom: 10, width: 40, height: 20 });
  const px = el.latLonToPixel(51.5, -0.1);
  assertNotEquals(px, null);
  if (px) {
    // Should be roughly at buffer center
    const bw = el.getBufferWidth();
    const bh = el.getBufferHeight();
    assertAlmostEquals(px.x, bw / 2, 2);
    assertAlmostEquals(px.y, bh / 2, 2);
  }
});

Deno.test('TileMapElement: latLonToPixel returns null for far off-screen', () => {
  const el = new TileMapElement({ lat: 51.5, lon: -0.1, zoom: 15, width: 40, height: 20 });
  // At zoom 15, Tokyo is well off-screen from London
  const px = el.latLonToPixel(35.68, 139.69);
  assertEquals(px, null);
});

Deno.test('TileMapElement: pixelToLatLon round-trips with latLonToPixel', () => {
  const el = new TileMapElement({ lat: 48.8, lon: 2.35, zoom: 10, width: 60, height: 30 });
  // Pick a point near center (guaranteed on-screen)
  const testLat = 48.85;
  const testLon = 2.3;
  const px = el.latLonToPixel(testLat, testLon);
  assertNotEquals(px, null);
  if (px) {
    const back = el.pixelToLatLon(px.x, px.y);
    assertAlmostEquals(back.lat, testLat, 0.05);
    assertAlmostEquals(back.lon, testLon, 0.05);
  }
});

Deno.test('TileMapElement: getBoundsLatLon north > south', () => {
  const el = new TileMapElement({ lat: 40, lon: -74, zoom: 10, width: 40, height: 20 });
  const bounds = el.getBoundsLatLon();
  assertEquals(bounds.north > bounds.south, true, `north ${bounds.north} should be > south ${bounds.south}`);
});

Deno.test('TileMapElement: onOverlay fires during paint', () => {
  let overlayFired = false;
  let geoContext: TileMapGeoContext | null = null;
  const el = new TileMapElement({
    lat: 51.5, lon: -0.1, zoom: 5, width: 40, height: 20,
    onOverlay: (event: TileMapOverlayEvent) => {
      overlayFired = true;
      geoContext = event.geo;
    },
  });
  // Trigger a paint by calling the internal handler via the onPaint prop
  if (el.props.onPaint) {
    el.props.onPaint({ canvas: el, bounds: { x: 0, y: 0, width: 40, height: 20 } });
  }
  assertEquals(overlayFired, true);
  assertNotEquals(geoContext, null);
  if (geoContext) {
    const g = geoContext as TileMapGeoContext;
    assertAlmostEquals(g.center.lat, 51.5, 0.01);
    assertAlmostEquals(g.center.lon, -0.1, 0.01);
    assertEquals(g.zoom, 5);
  }
});
