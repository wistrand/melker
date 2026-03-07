// Tile map component - interactive slippy map rendered to a canvas
// Extends CanvasElement for tile rendering with mouse drag/scroll/double-click

import { Element, type Bounds, type ComponentRenderContext, type IntrinsicSizeContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { CanvasElement, type CanvasProps } from './canvas.ts';
import type { Draggable, Wheelable } from '../core-types.ts';
import { registerComponent } from '../element.ts';
import { getGlobalEngine } from '../global-accessors.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';
import { getLogger } from '../logging.ts';
import { parseDimension, isResponsiveDimension } from '../utils/dimensions.ts';
import { MAP_NET_HOSTS } from '../policy/tile-map-hosts.ts';
import { type PathCommand, drawPath, drawPathColor, fillPathColor } from './canvas-path.ts';
import { parseSvgOverlay, type ParsedSvgElement } from '../svg-overlay.ts';
import { srgbToOklab, oklabToSrgb } from '../color/oklab.ts';
import { TRANSPARENT } from './color-utils.ts';

const logger = getLogger('TileMapElement');

const TILE_SIZE = 256; // Standard web map tile size in pixels

/** Coerce a prop value to number (handles strings from template attributes, e.g. negative numbers). */
function toNum(v: unknown, fallback: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = Number(v); return isNaN(n) ? fallback : n; }
  return fallback;
}

// ===== Tile Provider =====

export interface TileProvider {
  name: string;
  url: string;
  attribution: string;
  maxZoom: number;
  subdomains?: string[];
}

// Derive CARTO subdomains from the shared host list
const CARTO_SUBDOMAINS = MAP_NET_HOSTS
  .filter(h => h.startsWith('cartodb-basemaps-'))
  .map(h => h.replace('cartodb-basemaps-', '').charAt(0));

export const BUILT_IN_PROVIDERS: Record<string, TileProvider> = {
  'terrain': {
    name: 'Terrain',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '(C) OpenTopoMap (CC-BY-SA)',
    maxZoom: 15,
  },
  'streets': {
    name: 'Streets',
    url: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png',
    attribution: '(C) OpenStreetMap, (C) CARTO',
    maxZoom: 18,
    subdomains: CARTO_SUBDOMAINS,
  },
  'voyager-nolabels': {
    name: 'Voyager No Labels',
    url: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/rastertiles/voyager_nolabels/{z}/{x}/{y}.png',
    attribution: '(C) OpenStreetMap, (C) CARTO',
    maxZoom: 18,
    subdomains: CARTO_SUBDOMAINS,
  },
  'voyager': {
    name: 'Voyager',
    url: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/rastertiles/voyager/{z}/{x}/{y}.png',
    attribution: '(C) OpenStreetMap, (C) CARTO',
    maxZoom: 18,
    subdomains: CARTO_SUBDOMAINS,
  },
  'openstreetmap': {
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '(C) OpenStreetMap contributors',
    maxZoom: 19,
  },
  'satellite': {
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '(C) Esri, Maxar, Earthstar Geographics',
    maxZoom: 17,
  },
};

// ===== Decoded Tile =====

interface DecodedTile {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  bytesPerPixel: number;
}

// ===== Fallback Tile =====

interface FallbackTile {
  tile: DecodedTile;
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
}

// ===== Overlay / Geo Context =====

export interface TileMapGeoContext {
  /** Convert lat/lon to buffer pixel coordinates. Returns null if off-screen. */
  latLonToPixel(lat: number, lon: number): { x: number; y: number } | null;
  /** Convert buffer pixel coordinates back to lat/lon. */
  pixelToLatLon(x: number, y: number): { lat: number; lon: number };
  /** Get visible bounds in lat/lon. */
  getVisibleBounds(): { north: number; south: number; east: number; west: number };
  /** Current map center (read-only). */
  center: { lat: number; lon: number };
  /** Current zoom level (read-only). */
  zoom: number;
  /** Pixel aspect ratio (read-only). */
  pixelAspect: number;
}

export interface TileMapOverlayEvent {
  /** Canvas drawing API (drawLine, drawRect, drawCircle, drawText, setPixel, etc.) */
  canvas: CanvasElement;
  /** Element bounds in terminal cells. */
  bounds: Bounds;
  /** Coordinate transform utilities. */
  geo: TileMapGeoContext;
}

// ===== Props =====

export interface TileMapProps extends Omit<CanvasProps, 'width' | 'height' | 'onPaint'> {
  lat?: number;
  lon?: number;
  zoom?: number;
  provider?: string;
  providers?: Record<string, TileProvider>;
  width?: number | string;
  height?: number | string;
  interactive?: boolean;
  maxZoom?: number;
  cacheSize?: number;
  diskCache?: boolean;
  diskCacheMaxMB?: number;
  svgOverlay?: string;
  onOverlay?: (event: TileMapOverlayEvent) => void;
  onMove?: (event: { lat: number; lon: number; zoom: number }) => void;
  onZoom?: (event: { zoom: number }) => void;
  onClick?: (event: { lat: number; lon: number; x: number; y: number }) => void;
  onLoadingChange?: (event: { count: number }) => void;
}

// ===== Mercator Projection (static for testability) =====

export function latToMercatorY(lat: number): number {
  const latRad = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
}

export function mercatorYToLat(y: number): number {
  const n = Math.PI - 2 * Math.PI * y;
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function lonToMercatorX(lon: number): number {
  return (lon + 180) / 360;
}

export function mercatorXToLon(x: number): number {
  return x * 360 - 180;
}

// ===== Component =====

export class TileMapElement extends CanvasElement implements Draggable, Wheelable {
  declare props: TileMapProps & CanvasProps;

  // Internal map state
  private _centerLat: number;
  private _centerLon: number;
  private _zoom: number;
  private _currentProvider: string;

  // Last-seen prop values (to detect external prop changes vs internal state drift)
  private _lastPropLat: number;
  private _lastPropLon: number;
  private _lastPropZoom: number;
  private _lastPropProvider: string;

  // In-memory tile cache (LRU via Map insertion order)
  private _tileCache = new Map<string, DecodedTile>();
  private _maxCacheSize: number;
  private _pendingFetches = new Set<string>();
  private _fetchAbortControllers = new Map<string, AbortController>();
  private _loadingCount = 0;

  // Blur temp buffer (reused across frames)
  private _blurTempBuffer: Uint32Array | null = null;

  // Drag state
  private _isDragging = false;
  private _dragStartX = 0;
  private _dragStartY = 0;
  private _dragStartLat = 0;
  private _dragStartLon = 0;

  // Double-click detection
  private _lastClickTime = 0;
  private _lastClickX = 0;
  private _lastClickY = 0;

  // Last rendered position (for converting absolute screen coords to element-relative)
  private _boundsX = 0;
  private _boundsY = 0;

  // SVG paths overlay cache (geo-specific, separate from parent canvas overlay)
  private _lastGeoSvgOverlayStr: string | undefined;
  private _parsedGeoSvgOverlay: ParsedSvgElement[] = [];

  constructor(props: TileMapProps, children: Element[] = []) {
    const origWidth = props.width ?? '100%';
    const origHeight = props.height ?? '100%';
    const usesResponsive = isResponsiveDimension(origWidth) || isResponsiveDimension(origHeight);
    const canvasWidth = isResponsiveDimension(origWidth) ? 30 : (typeof origWidth === 'number' ? origWidth : 30);
    const canvasHeight = isResponsiveDimension(origHeight) ? 15 : (typeof origHeight === 'number' ? origHeight : 15);

    super(
      {
        ...props,
        width: origWidth,
        height: origHeight,
        style: {
          ...(usesResponsive ? {} : { flexShrink: 0 }),
          ...props.style,
        },
      } as CanvasProps,
      children,
    );

    if (usesResponsive) {
      this.setSize(canvasWidth, canvasHeight);
    }

    // Override type
    (this as { type: string }).type = 'tile-map';

    // Initialize map state from props
    // Note: schema coercion handles positive numbers but not negative ones (regex
    // limitation in template parser), so we coerce lat/lon which are commonly negative.
    this._centerLat = toNum(props.lat, 51.5074);
    this._centerLon = toNum(props.lon, -0.1278);
    this._zoom = Math.max(0, Math.min(toNum(props.maxZoom, 20), toNum(props.zoom, 5)));
    this._currentProvider = props.provider ?? 'openstreetmap';
    this._maxCacheSize = toNum(props.cacheSize, 256);

    // Track initial prop values for change detection
    this._lastPropLat = this._centerLat;
    this._lastPropLon = this._centerLon;
    this._lastPropZoom = toNum(props.zoom, 5);
    this._lastPropProvider = this._currentProvider;

    // Store original dimensions
    this._originalWidth = origWidth;
    this._originalHeight = origHeight;

    // Default dither to 'auto'
    if (props.dither === undefined) {
      this.props.dither = 'auto';
    }

    // Set internal onPaint handler
    this.props.onPaint = (event) => this._onPaint(event);
  }

  // Skip buffer copy - we rewrite every frame
  protected override _copyPreviousToCurrent(): void {}
  // Tile-map draws its own geo-projected overlay in _onPaint; skip the base pixel-coord pass.
  protected override _drawSvgOverlayPass(): void {}

  // Always interactive (handles drag + wheel internally)
  override isInteractive(): boolean {
    return this.props.interactive !== false;
  }

  // ===== Mercator math (instance methods delegate to statics) =====

  /** Compute Mercator scale factors for a given buffer height, pixel aspect ratio, and zoom level. */
  private _getMercatorScale(bufferHeight: number, pixelAspect: number, zoom?: number): {
    scaledTileW: number; scaledTileH: number;
    mercatorPerPixelX: number; mercatorPerPixelY: number;
  } {
    const z = zoom ?? this._zoom;
    const scale = bufferHeight / TILE_SIZE;
    const scaledTileH = TILE_SIZE * scale;
    const scaledTileW = scaledTileH / pixelAspect;
    const n = Math.pow(2, z);
    return {
      scaledTileW, scaledTileH,
      mercatorPerPixelX: 1 / (scaledTileW * n),
      mercatorPerPixelY: 1 / (scaledTileH * n),
    };
  }

  /** Convert lat/lon to buffer pixel coordinates given Mercator projection parameters. */
  private static _geoToPixel(
    lat: number, lon: number,
    centerMercX: number, centerMercY: number,
    mercatorPerPixelX: number, mercatorPerPixelY: number,
    halfW: number, halfH: number,
  ): { px: number; py: number } {
    const mercX = lonToMercatorX(lon);
    const mercY = latToMercatorY(lat);
    return {
      px: halfW + (mercX - centerMercX) / mercatorPerPixelX,
      py: halfH + (mercY - centerMercY) / mercatorPerPixelY,
    };
  }

  static latLonToTile(lat: number, lon: number, z: number): { x: number; y: number; offsetX: number; offsetY: number } {
    const n = Math.pow(2, z);
    const xFloat = lonToMercatorX(lon) * n;
    const yFloat = latToMercatorY(lat) * n;
    const x = Math.floor(xFloat);
    const y = Math.floor(yFloat);
    return { x, y, offsetX: xFloat - x, offsetY: yFloat - y };
  }

  // ===== Tile URL =====

  static getTileUrl(tileX: number, tileY: number, z: number, provider: TileProvider): string {
    let url = provider.url;
    if (provider.subdomains && provider.subdomains.length > 0) {
      const subdomain = provider.subdomains[(tileX + tileY) % provider.subdomains.length];
      url = url.replace('{s}', subdomain);
    }
    url = url.replace('{z}', z.toString());
    url = url.replace('{x}', tileX.toString());
    url = url.replace('{y}', tileY.toString());
    return url;
  }

  // ===== Cache key =====

  private static _tileCacheKey(tileX: number, tileY: number, z: number, providerKey: string): string {
    return `${providerKey}/${z}/${tileX}/${tileY}`;
  }

  // ===== Provider resolution =====

  private _getProviders(): Record<string, TileProvider> {
    const custom = this.props.providers;
    if (custom) {
      return { ...BUILT_IN_PROVIDERS, ...custom };
    }
    return BUILT_IN_PROVIDERS;
  }

  private _getProvider(): TileProvider {
    const providers = this._getProviders();
    return providers[this._currentProvider] ?? providers['openstreetmap'] ?? BUILT_IN_PROVIDERS['openstreetmap'];
  }

  // ===== In-memory LRU cache =====

  private _getTileFromCache(key: string): DecodedTile | undefined {
    const tile = this._tileCache.get(key);
    if (tile) {
      this._tileCache.delete(key);
      this._tileCache.set(key, tile);
    }
    return tile;
  }

  private _setTileInCache(key: string, tile: DecodedTile): void {
    while (this._tileCache.size >= this._maxCacheSize) {
      const oldestKey = this._tileCache.keys().next().value;
      if (oldestKey) {
        this._tileCache.delete(oldestKey);
      } else {
        break;
      }
    }
    this._tileCache.set(key, tile);
  }

  // ===== Fallback tiles =====

  private _findFallbackTile(tileX: number, tileY: number, z: number, providerKey: string): FallbackTile | null {
    for (let zoomDiff = 1; zoomDiff <= 4 && z - zoomDiff >= 0; zoomDiff++) {
      const parentZ = z - zoomDiff;
      const parentX = tileX >> zoomDiff;
      const parentY = tileY >> zoomDiff;
      const cacheKey = TileMapElement._tileCacheKey(parentX, parentY, parentZ, providerKey);
      const parentTile = this._getTileFromCache(cacheKey);
      if (parentTile) {
        const divisor = 1 << zoomDiff;
        const sectionSize = TILE_SIZE / divisor;
        const localX = tileX - (parentX << zoomDiff);
        const localY = tileY - (parentY << zoomDiff);
        return {
          tile: parentTile,
          srcX: localX * sectionSize,
          srcY: localY * sectionSize,
          srcW: sectionSize,
          srcH: sectionSize,
        };
      }
    }
    return null;
  }

  // ===== Tile fetching =====

  private _abortPendingFetches(): void {
    for (const controller of this._fetchAbortControllers.values()) {
      controller.abort();
    }
  }

  private _setLoading(loading: boolean): void {
    if (loading) {
      this._loadingCount++;
    } else {
      this._loadingCount = Math.max(0, this._loadingCount - 1);
    }
    if (this.props.onLoadingChange) {
      this.props.onLoadingChange({ count: this._loadingCount });
    }
  }

  private async _fetchTile(tileX: number, tileY: number, z: number, providerKey: string): Promise<DecodedTile | null> {
    const cacheKey = TileMapElement._tileCacheKey(tileX, tileY, z, providerKey);

    const cached = this._getTileFromCache(cacheKey);
    if (cached) return cached;

    if (this._pendingFetches.has(cacheKey)) return null;

    this._pendingFetches.add(cacheKey);
    const abortController = new AbortController();
    this._fetchAbortControllers.set(cacheKey, abortController);
    this._setLoading(true);

    try {
      let bytes: Uint8Array | null = null;

      // Try disk cache first
      if (this.props.diskCache !== false) {
        const engineCache = getGlobalEngine()?.cache;
        if (engineCache) {
          bytes = await engineCache.read('tiles', `${providerKey}/${z}/${tileX}/${tileY}`);
          if (bytes) {
            logger.debug(`Tile from disk cache: ${cacheKey}`);
          }
        }
      }

      // Fetch from network
      if (!bytes) {
        const provider = this._getProviders()[providerKey];
        if (!provider) return null;
        const url = TileMapElement.getTileUrl(tileX, tileY, z, provider);
        logger.debug(`Fetching tile: ${cacheKey}`);
        const response = await fetch(url, { signal: abortController.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        bytes = new Uint8Array(arrayBuffer);

        // Save to disk cache (fire and forget)
        if (this.props.diskCache !== false) {
          const engineCache = getGlobalEngine()?.cache;
          if (engineCache) {
            const maxBytes = (this.props.diskCacheMaxMB ?? 200) * 1024 * 1024;
            engineCache.write('tiles', `${providerKey}/${z}/${tileX}/${tileY}`, bytes, { maxBytes });
          }
        }
      }

      // Decode
      const decoded = this.decodeImageBytes(bytes);
      this._setTileInCache(cacheKey, decoded);

      // Request re-render
      this.markDirty();
      const engine = getGlobalEngine();
      if (engine) engine.render();

      return decoded;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        logger.debug(`Tile fetch aborted: ${cacheKey}`);
      } else {
        logger.warn(`Failed to fetch tile ${cacheKey}: ${error}`);
      }
      return null;
    } finally {
      this._pendingFetches.delete(cacheKey);
      this._fetchAbortControllers.delete(cacheKey);
      this._setLoading(false);
    }
  }

  // ===== Tile blur (box blur) =====

  private _applyTileBlur(bufferWidth: number, bufferHeight: number): void {
    const radius = Number(this.props.style?.tileBlur ?? 0);
    if (radius <= 0) return;

    const buf = this._colorBuffer;
    const len = bufferWidth * bufferHeight;

    // Allocate or reallocate temp buffer
    if (!this._blurTempBuffer || this._blurTempBuffer.length < len) {
      this._blurTempBuffer = new Uint32Array(len);
    }
    const tmp = this._blurTempBuffer;

    for (let y = 0; y < bufferHeight; y++) {
      for (let x = 0; x < bufferWidth; x++) {
        const idx = y * bufferWidth + x;
        if (buf[idx] === TRANSPARENT) { tmp[idx] = TRANSPARENT; continue; }

        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        const y0 = Math.max(0, y - radius);
        const y1 = Math.min(bufferHeight - 1, y + radius);
        const x0 = Math.max(0, x - radius);
        const x1 = Math.min(bufferWidth - 1, x + radius);

        for (let ny = y0; ny <= y1; ny++) {
          for (let nx = x0; nx <= x1; nx++) {
            const px = buf[ny * bufferWidth + nx];
            if (px === TRANSPARENT) continue;
            rSum += (px >> 24) & 0xFF;
            gSum += (px >> 16) & 0xFF;
            bSum += (px >> 8) & 0xFF;
            count++;
          }
        }

        if (count === 0) { tmp[idx] = TRANSPARENT; continue; }
        const alpha = buf[idx] & 0xFF;
        tmp[idx] = (((rSum / count) & 0xFF) << 24) |
                   (((gSum / count) & 0xFF) << 16) |
                   (((bSum / count) & 0xFF) << 8) | alpha;
      }
    }

    // Copy result back
    buf.set(tmp.subarray(0, len));
  }

  // ===== Tile filter (Oklab perceptual adjustments / color key) =====

  private _applyTileFilter(bufferWidth: number, bufferHeight: number): void {
    const style = this.props.style;
    const keyColor = style?.tileKeyColor;

    if (keyColor !== undefined && keyColor !== null) {
      // Color key mode: classify pixels by Oklab chroma distance from reference
      this._applyColorKey(bufferWidth, bufferHeight, keyColor as number);
      return;
    }

    const contrast = Number(style?.tileContrast ?? 1);
    const saturation = Number(style?.tileSaturation ?? 1);
    const brightness = Number(style?.tileBrightness ?? 0);
    const hue = Number(style?.tileHue ?? 0);

    // Short-circuit if all defaults
    if (contrast === 1 && saturation === 1 && brightness === 0 && hue === 0) return;

    const buf = this._colorBuffer;
    const len = bufferWidth * bufferHeight;

    // Precompute hue rotation
    const needsHue = hue !== 0;
    const hueRad = hue * (Math.PI / 180);
    const cosH = Math.cos(hueRad);
    const sinH = Math.sin(hueRad);

    for (let i = 0; i < len; i++) {
      const px = buf[i];
      if (px === TRANSPARENT) continue;

      // Unpack RGBA (R in high byte)
      const r = (px >> 24) & 0xFF;
      const g = (px >> 16) & 0xFF;
      const b = (px >> 8) & 0xFF;
      const alpha = px & 0xFF;

      // sRGB → Oklab
      const [L0, a0, b0] = srgbToOklab(r, g, b);

      // Brightness (additive) then contrast (multiply around midpoint)
      let L = L0 + brightness;
      L = 0.5 + (L - 0.5) * contrast;
      if (L < 0) L = 0; else if (L > 1) L = 1;

      let a1 = a0;
      let b1 = b0;

      // Saturation (chroma scaling)
      if (saturation !== 1) {
        a1 *= saturation;
        b1 *= saturation;
      }

      // Hue rotation
      if (needsHue) {
        const a2 = a1 * cosH - b1 * sinH;
        const b2 = a1 * sinH + b1 * cosH;
        a1 = a2;
        b1 = b2;
      }

      // Oklab → sRGB
      const [rr, gg, bb] = oklabToSrgb(L, a1, b1);

      // Repack
      buf[i] = ((rr & 0xFF) << 24) | ((gg & 0xFF) << 16) | ((bb & 0xFF) << 8) | alpha;
    }
  }

  private _applyColorKey(bufferWidth: number, bufferHeight: number, keyColorPacked: number): void {
    const style = this.props.style;
    const threshold = Number(style?.tileKeyThreshold ?? 0.05);
    const matchL = Number(style?.tileKeyMatch ?? 0);
    const otherL = Number(style?.tileKeyOther ?? 1);
    const matchColorPacked = style?.tileKeyMatchColor;
    const otherColorPacked = style?.tileKeyOtherColor;

    // Unpack key color and convert to Oklab
    const kr = (keyColorPacked >> 24) & 0xFF;
    const kg = (keyColorPacked >> 16) & 0xFF;
    const kb = (keyColorPacked >> 8) & 0xFF;
    const [, ak, bk] = srgbToOklab(kr, kg, kb);

    // Precompute match/other output colors
    let matchR: number, matchG: number, matchB: number;
    let otherR: number, otherG: number, otherB: number;

    if (matchColorPacked !== undefined && matchColorPacked !== null) {
      matchR = (matchColorPacked >> 24) & 0xFF;
      matchG = (matchColorPacked >> 16) & 0xFF;
      matchB = (matchColorPacked >> 8) & 0xFF;
    } else {
      [matchR, matchG, matchB] = oklabToSrgb(matchL, 0, 0);
    }

    if (otherColorPacked !== undefined && otherColorPacked !== null) {
      otherR = (otherColorPacked >> 24) & 0xFF;
      otherG = (otherColorPacked >> 16) & 0xFF;
      otherB = (otherColorPacked >> 8) & 0xFF;
    } else {
      [otherR, otherG, otherB] = oklabToSrgb(otherL, 0, 0);
    }

    const thresholdSq = threshold * threshold;
    const buf = this._colorBuffer;
    const len = bufferWidth * bufferHeight;

    for (let i = 0; i < len; i++) {
      const px = buf[i];
      if (px === TRANSPARENT) continue;

      const r = (px >> 24) & 0xFF;
      const g = (px >> 16) & 0xFF;
      const b = (px >> 8) & 0xFF;
      const alpha = px & 0xFF;

      const [, a, ob] = srgbToOklab(r, g, b);

      // Chroma distance (ignore L)
      const da = a - ak;
      const db = ob - bk;
      const distSq = da * da + db * db;

      const isMatch = distSq < thresholdSq;
      const rr = isMatch ? matchR : otherR;
      const gg = isMatch ? matchG : otherG;
      const bb = isMatch ? matchB : otherB;

      buf[i] = ((rr & 0xFF) << 24) | ((gg & 0xFF) << 16) | ((bb & 0xFF) << 8) | alpha;
    }
  }

  // ===== Paint handler =====

  private _onPaint(event: { canvas: CanvasElement; bounds: Bounds }): void {
    const canvas = event.canvas as unknown as TileMapElement;
    const bufferWidth = canvas.getBufferWidth();
    const bufferHeight = canvas.getBufferHeight();

    if (bufferWidth <= 0 || bufferHeight <= 0) return;

    canvas.clear();

    const pixelAspect = canvas.getPixelAspectRatio?.() || (2 / 3);
    const provider = this._getProvider();
    const providerMaxZoom = provider.maxZoom;
    const tileZoom = Math.min(this._zoom, providerMaxZoom);
    const overZoom = this._zoom - tileZoom;
    const overZoomScale = Math.pow(2, overZoom);

    const centerTile = TileMapElement.latLonToTile(this._centerLat, this._centerLon, tileZoom);

    const baseScale = bufferHeight / TILE_SIZE;
    const scale = baseScale * overZoomScale;
    const scaledTileH = Math.floor(TILE_SIZE * scale);
    const scaledTileW = Math.floor(scaledTileH / pixelAspect);

    if (scaledTileH <= 0 || scaledTileW <= 0) return;

    const tilesX = Math.ceil(bufferWidth / scaledTileW) + 2;
    const tilesY = Math.ceil(bufferHeight / scaledTileH) + 2;
    const centerBufferX = bufferWidth / 2;
    const centerBufferY = bufferHeight / 2;
    const tileOffsetX = centerTile.offsetX * scaledTileW;
    const tileOffsetY = centerTile.offsetY * scaledTileH;
    const halfTilesX = Math.floor(tilesX / 2);
    const halfTilesY = Math.floor(tilesY / 2);

    for (let dy = -halfTilesY; dy <= halfTilesY; dy++) {
      for (let dx = -halfTilesX; dx <= halfTilesX; dx++) {
        const tileX = centerTile.x + dx;
        const tileY = centerTile.y + dy;

        const maxTile = Math.pow(2, tileZoom);
        if (tileY < 0 || tileY >= maxTile) continue;

        const wrappedTileX = ((tileX % maxTile) + maxTile) % maxTile;
        const screenX = ((centerBufferX - tileOffsetX + dx * scaledTileW) | 0);
        const screenY = ((centerBufferY - tileOffsetY + dy * scaledTileH) | 0);

        const cacheKey = TileMapElement._tileCacheKey(wrappedTileX, tileY, tileZoom, this._currentProvider);
        const tile = this._getTileFromCache(cacheKey);

        if (tile) {
          canvas.drawImage(tile, screenX, screenY, scaledTileW, scaledTileH);
        } else {
          const fallback = this._findFallbackTile(wrappedTileX, tileY, tileZoom, this._currentProvider);
          if (fallback) {
            canvas.drawImageRegion(
              fallback.tile,
              fallback.srcX, fallback.srcY, fallback.srcW, fallback.srcH,
              screenX, screenY, scaledTileW, scaledTileH,
            );
          }
          // Fire-and-forget: fetch tile async, will trigger re-render on completion
          this._fetchTile(wrappedTileX, tileY, tileZoom, this._currentProvider);
        }
      }
    }

    // Apply blur then filter after tiles, before overlays
    this._applyTileBlur(bufferWidth, bufferHeight);
    this._applyTileFilter(bufferWidth, bufferHeight);

    // Draw svgOverlay overlay (after tiles, before onOverlay)
    if (this.props.svgOverlay) {
      const ms = this._getMercatorScale(bufferHeight, pixelAspect);
      const cMercX = lonToMercatorX(this._centerLon);
      const cMercY = latToMercatorY(this._centerLat);
      this._drawSvgOverlay(canvas, cMercX, cMercY, ms.mercatorPerPixelX, ms.mercatorPerPixelY, bufferWidth / 2, bufferHeight / 2);
    }

    // Call onOverlay after tiles are rendered
    if (this.props.onOverlay) {
      const geo = this._createGeoContext(bufferWidth, bufferHeight, pixelAspect);
      this.props.onOverlay({ canvas, bounds: event.bounds, geo });
    }
  }

  // ===== Render override (prop sync + responsive sizing) =====

  override render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Track element position for absolute-to-relative coordinate conversion
    this._boundsX = bounds.x;
    this._boundsY = bounds.y;

    // Sync props -> internal state only when the prop itself changed externally
    // (e.g., app sets el.props.lat = 40). Internal changes (drag/zoom) update
    // _centerLat directly without touching props, so we compare against the
    // last-seen prop value to avoid snapping back.
    if (this.props.lat !== undefined) {
      const lat = toNum(this.props.lat, this._centerLat);
      if (lat !== this._lastPropLat) { this._centerLat = lat; this._lastPropLat = lat; }
    }
    if (this.props.lon !== undefined) {
      const lon = toNum(this.props.lon, this._centerLon);
      if (lon !== this._lastPropLon) { this._centerLon = lon; this._lastPropLon = lon; }
    }
    if (this.props.zoom !== undefined) {
      const z = toNum(this.props.zoom, this._zoom);
      if (z !== this._lastPropZoom) {
        this._zoom = Math.max(0, Math.min(toNum(this.props.maxZoom, 20), z));
        this._lastPropZoom = z;
      }
    }
    if (this.props.provider !== undefined && this.props.provider !== this._lastPropProvider) {
      this._currentProvider = this.props.provider;
      this._lastPropProvider = this.props.provider;
    }

    // Responsive sizing (same pattern as ImgElement)
    if (bounds.width > 0 && bounds.height > 0) {
      const boundsChanged = bounds.width !== this._lastBoundsWidth || bounds.height !== this._lastBoundsHeight;
      if (boundsChanged) {
        this._lastBoundsWidth = bounds.width;
        this._lastBoundsHeight = bounds.height;
        const newWidth = parseDimension(this._originalWidth, bounds.width, 30);
        const newHeight = parseDimension(this._originalHeight, bounds.height, 15);
        if (newWidth > 0 && newHeight > 0 && (newWidth !== this._terminalWidth || newHeight !== this._terminalHeight)) {
          this.setSize(newWidth, newHeight);
        }
      }
    }

    super.render(bounds, style, buffer, context);
  }

  override intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    const width = parseDimension(this._originalWidth, context.availableSpace.width, 30);
    const height = parseDimension(this._originalHeight, context.availableSpace.height, 15);
    return {
      width: width > 0 ? width : (this._terminalWidth || 30),
      height: height > 0 ? height : (this._terminalHeight || 15),
    };
  }

  // ===== Draggable interface =====

  getDragZone(_x: number, _y: number): string | null {
    if (this.props.interactive === false) return null;
    return 'map';
  }

  handleDragStart(zone: string, x: number, y: number): void {
    if (zone !== 'map') return;

    const now = Date.now();
    const timeDelta = now - this._lastClickTime;
    const distX = Math.abs(x - this._lastClickX);
    const distY = Math.abs(y - this._lastClickY);

    // Double-click detection
    if (timeDelta < 400 && distX <= 2 && distY <= 2) {
      this._zoomToLocation(x, y, true);
      this._lastClickTime = 0;
      return;
    }

    this._lastClickTime = now;
    this._lastClickX = x;
    this._lastClickY = y;

    this._isDragging = true;
    this._dragStartX = x;
    this._dragStartY = y;
    this._dragStartLat = this._centerLat;
    this._dragStartLon = this._centerLon;
  }

  handleDragMove(zone: string, x: number, y: number): void {
    if (zone !== 'map' || !this._isDragging) return;

    const dx = x - this._dragStartX;
    const dy = y - this._dragStartY;
    const pixelDeltaX = dx * this._pixelsPerCellX;
    const pixelDeltaY = dy * this._pixelsPerCellY;

    const bufferHeight = this.getBufferHeight();
    const pixelAspect = this.getPixelAspectRatio?.() || (2 / 3);
    const { mercatorPerPixelX, mercatorPerPixelY } = this._getMercatorScale(bufferHeight, pixelAspect);

    const startMercX = lonToMercatorX(this._dragStartLon);
    const startMercY = latToMercatorY(this._dragStartLat);

    const newMercX = startMercX - pixelDeltaX * mercatorPerPixelX;
    const newMercY = startMercY - pixelDeltaY * mercatorPerPixelY;

    this._centerLon = mercatorXToLon(newMercX);
    this._centerLat = mercatorYToLat(newMercY);
    this._centerLat = Math.max(-85, Math.min(85, this._centerLat));
    while (this._centerLon > 180) this._centerLon -= 360;
    while (this._centerLon < -180) this._centerLon += 360;

    this._fireMove();
    this.markDirty();
  }

  handleDragEnd(zone: string, x: number, y: number): void {
    if (zone !== 'map') return;
    const wasDragging = this._isDragging;
    this._isDragging = false;

    // Fire onClick if the drag distance was tiny (i.e. a click, not a pan)
    if (wasDragging && this.props.onClick) {
      const dx = x - this._dragStartX;
      const dy = y - this._dragStartY;
      if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) {
        const bufferWidth = this.getBufferWidth();
        const bufferHeight = this.getBufferHeight();
        const pixelAspect = this.getPixelAspectRatio?.() || (2 / 3);

        const mouseBufferX = (x - this._boundsX) * this._pixelsPerCellX;
        const mouseBufferY = (y - this._boundsY) * this._pixelsPerCellY;
        const centerBufferX = bufferWidth / 2;
        const centerBufferY = bufferHeight / 2;
        const offsetX = mouseBufferX - centerBufferX;
        const offsetY = mouseBufferY - centerBufferY;

        const { mercatorPerPixelX, mercatorPerPixelY } = this._getMercatorScale(bufferHeight, pixelAspect);

        const centerMercX = lonToMercatorX(this._centerLon);
        const centerMercY = latToMercatorY(this._centerLat);
        const clickLon = mercatorXToLon(centerMercX + offsetX * mercatorPerPixelX);
        const clickLat = mercatorYToLat(centerMercY + offsetY * mercatorPerPixelY);

        this.props.onClick({ lat: clickLat, lon: clickLon, x, y });
      }
    }
  }

  // ===== Wheelable interface =====

  canHandleWheel(_x: number, _y: number): boolean {
    return this.props.interactive !== false;
  }

  handleWheel(_deltaX: number, deltaY: number, x?: number, y?: number): boolean {
    const zoomingIn = deltaY < 0;
    if (x !== undefined && y !== undefined) {
      // Zoom towards mouse pointer (convert absolute screen coords to element-relative)
      this._zoomToLocation(x - this._boundsX, y - this._boundsY, zoomingIn);
    } else {
      // Fallback: zoom around center
      const providerMaxZoom = this._getProvider().maxZoom;
      const maxZoom = Math.min(this.props.maxZoom ?? 20, providerMaxZoom);
      if (zoomingIn && this._zoom >= maxZoom) return true;
      if (!zoomingIn && this._zoom <= 0) return true;
      this._zoom = zoomingIn ? this._zoom + 1 : this._zoom - 1;
      this._abortPendingFetches();
      this._fireZoom();
      this._fireMove();
      this.markDirty();
      getGlobalEngine()?.render();
    }
    return true;
  }

  // ===== Zoom to location (double-click) =====

  private _zoomToLocation(screenX: number, screenY: number, zoomIn: boolean): void {
    const providerMaxZoom = this._getProvider().maxZoom;
    const maxZoom = Math.min(this.props.maxZoom ?? 20, providerMaxZoom);
    if (zoomIn && this._zoom >= maxZoom) return;
    if (!zoomIn && this._zoom <= 0) return;

    const bufferWidth = this.getBufferWidth();
    const bufferHeight = this.getBufferHeight();
    const pixelAspect = this.getPixelAspectRatio?.() || (2 / 3);

    const mouseBufferX = screenX * this._pixelsPerCellX;
    const mouseBufferY = screenY * this._pixelsPerCellY;
    const centerBufferX = bufferWidth / 2;
    const centerBufferY = bufferHeight / 2;
    const offsetX = mouseBufferX - centerBufferX;
    const offsetY = mouseBufferY - centerBufferY;

    const oldScale = this._getMercatorScale(bufferHeight, pixelAspect);

    const centerMercX = lonToMercatorX(this._centerLon);
    const centerMercY = latToMercatorY(this._centerLat);
    const mouseMercX = centerMercX + offsetX * oldScale.mercatorPerPixelX;
    const mouseMercY = centerMercY + offsetY * oldScale.mercatorPerPixelY;

    this._zoom = zoomIn ? this._zoom + 1 : this._zoom - 1;
    this._abortPendingFetches();

    const newScale = this._getMercatorScale(bufferHeight, pixelAspect);

    const newCenterMercX = mouseMercX - offsetX * newScale.mercatorPerPixelX;
    const newCenterMercY = mouseMercY - offsetY * newScale.mercatorPerPixelY;

    this._centerLon = mercatorXToLon(newCenterMercX);
    this._centerLat = mercatorYToLat(newCenterMercY);
    this._centerLat = Math.max(-85, Math.min(85, this._centerLat));
    while (this._centerLon > 180) this._centerLon -= 360;
    while (this._centerLon < -180) this._centerLon += 360;

    this._fireZoom();
    this._fireMove();
    this.markDirty();
    getGlobalEngine()?.render();
  }

  // ===== Event firing =====

  private _fireMove(): void {
    if (this.props.onMove) {
      this.props.onMove({ lat: this._centerLat, lon: this._centerLon, zoom: this._zoom });
    }
  }

  private _fireZoom(): void {
    if (this.props.onZoom) {
      this.props.onZoom({ zoom: this._zoom });
    }
  }

  // ===== SVG Paths =====

  // Shared parser returns x/y; tile-map interprets x as lon, y as lat.
  private _parseSvgOverlay(str: string): ParsedSvgElement[] {
    return parseSvgOverlay(str);
  }

  private _transformToPixel(
    commands: PathCommand[],
    centerMercX: number, centerMercY: number,
    mercatorPerPixelX: number, mercatorPerPixelY: number,
    halfW: number, halfH: number,
  ): PathCommand[] {
    const toPixel = (lat: number, lon: number) =>
      TileMapElement._geoToPixel(lat, lon, centerMercX, centerMercY, mercatorPerPixelX, mercatorPerPixelY, halfW, halfH);

    const result: PathCommand[] = [];
    // SVG standard order: x=lon, y=lat. toPixel takes (lat, lon).
    let curLat = 0, curLon = 0;

    for (const cmd of commands) {
      switch (cmd.type) {
        case 'M': {
          const p = toPixel(cmd.y, cmd.x);
          result.push({ type: 'M', x: p.px, y: p.py });
          curLon = cmd.x; curLat = cmd.y;
          break;
        }
        case 'L': {
          const p = toPixel(cmd.y, cmd.x);
          result.push({ type: 'L', x: p.px, y: p.py });
          curLon = cmd.x; curLat = cmd.y;
          break;
        }
        case 'T': {
          const p = toPixel(cmd.y, cmd.x);
          result.push({ type: 'T', x: p.px, y: p.py });
          curLon = cmd.x; curLat = cmd.y;
          break;
        }
        case 'H': {
          // H = horizontal = change x = change longitude
          const p = toPixel(curLat, cmd.x);
          result.push({ type: 'L', x: p.px, y: p.py });
          curLon = cmd.x;
          break;
        }
        case 'V': {
          // V = vertical = change y = change latitude
          const p = toPixel(cmd.y, curLon);
          result.push({ type: 'L', x: p.px, y: p.py });
          curLat = cmd.y;
          break;
        }
        case 'Q': {
          const ctl = toPixel(cmd.cy, cmd.cx);
          const ep = toPixel(cmd.y, cmd.x);
          result.push({ type: 'Q', cx: ctl.px, cy: ctl.py, x: ep.px, y: ep.py });
          curLon = cmd.x; curLat = cmd.y;
          break;
        }
        case 'C': {
          const c1 = toPixel(cmd.c1y, cmd.c1x);
          const c2 = toPixel(cmd.c2y, cmd.c2x);
          const ep = toPixel(cmd.y, cmd.x);
          result.push({ type: 'C', c1x: c1.px, c1y: c1.py, c2x: c2.px, c2y: c2.py, x: ep.px, y: ep.py });
          curLon = cmd.x; curLat = cmd.y;
          break;
        }
        case 'S': {
          const c2 = toPixel(cmd.c2y, cmd.c2x);
          const ep = toPixel(cmd.y, cmd.x);
          result.push({ type: 'S', c2x: c2.px, c2y: c2.py, x: ep.px, y: ep.py });
          curLon = cmd.x; curLat = cmd.y;
          break;
        }
        case 'A': {
          // Scale radii from degrees to buffer pixels.
          // rx is along x-axis (longitude), ry along y-axis (latitude).
          const scaleLon = 1 / (mercatorPerPixelX * 360);
          const cosLat = Math.cos(curLat * Math.PI / 180);
          const scaleLat = 1 / (mercatorPerPixelY * 360 * (cosLat > 0.01 ? cosLat : 0.01));
          const pixelAspect = mercatorPerPixelX / mercatorPerPixelY;
          const ep = toPixel(cmd.y, cmd.x);
          result.push({
            type: 'A',
            rx: Math.abs(cmd.rx * scaleLon),
            ry: Math.abs(cmd.ry * scaleLat * pixelAspect),
            rotation: cmd.rotation,
            largeArc: cmd.largeArc,
            sweep: cmd.sweep,
            x: ep.px,
            y: ep.py,
          });
          curLon = cmd.x; curLat = cmd.y;
          break;
        }
        case 'Z':
          result.push({ type: 'Z' });
          break;
      }
    }
    return result;
  }

  private _drawSvgOverlay(
    canvas: CanvasElement,
    centerMercX: number, centerMercY: number,
    mercatorPerPixelX: number, mercatorPerPixelY: number,
    halfW: number, halfH: number,
  ): void {
    // Re-parse only when the string changes
    if (this.props.svgOverlay !== this._lastGeoSvgOverlayStr) {
      this._lastGeoSvgOverlayStr = this.props.svgOverlay;
      this._parsedGeoSvgOverlay = this.props.svgOverlay
        ? this._parseSvgOverlay(this.props.svgOverlay)
        : [];
    }

    for (const el of this._parsedGeoSvgOverlay) {
      if (el.kind === 'text') {
        // x=lon, y=lat in SVG coordinate convention
        const p = TileMapElement._geoToPixel(el.y, el.x, centerMercX, centerMercY, mercatorPerPixelX, mercatorPerPixelY, halfW, halfH);
        const color = el.fill || '#ffffff';
        canvas.drawTextColor(p.px, p.py, el.text, color, {
          align: el.align,
          bg: el.bg,
        });
        continue;
      }

      const transformed = this._transformToPixel(
        el.commands,
        centerMercX, centerMercY,
        mercatorPerPixelX, mercatorPerPixelY,
        halfW, halfH,
      );

      const hasFill = el.fill && el.fill !== 'none';
      const hasStroke = el.stroke && el.stroke !== 'none';
      if (hasFill) {
        fillPathColor(canvas, transformed, el.fill!);
      }
      if (hasStroke) {
        drawPathColor(canvas, transformed, el.stroke!);
      }
      if (!hasFill && !hasStroke) {
        drawPath(canvas, transformed);
      }
    }
  }

  // ===== Geo Context =====

  private _createGeoContext(bufferWidth: number, bufferHeight: number, pixelAspect: number): TileMapGeoContext {
    const centerLat = this._centerLat;
    const centerLon = this._centerLon;
    const zoom = this._zoom;

    const { mercatorPerPixelX, mercatorPerPixelY } = this._getMercatorScale(bufferHeight, pixelAspect);
    const centerMercX = lonToMercatorX(centerLon);
    const centerMercY = latToMercatorY(centerLat);
    const halfW = bufferWidth / 2;
    const halfH = bufferHeight / 2;

    return {
      latLonToPixel(lat: number, lon: number): { x: number; y: number } | null {
        const mercX = lonToMercatorX(lon);
        const mercY = latToMercatorY(lat);
        const px = halfW + (mercX - centerMercX) / mercatorPerPixelX;
        const py = halfH + (mercY - centerMercY) / mercatorPerPixelY;
        // Off-screen check
        if (px < 0 || px >= bufferWidth || py < 0 || py >= bufferHeight) return null;
        return { x: Math.round(px), y: Math.round(py) };
      },
      pixelToLatLon(x: number, y: number): { lat: number; lon: number } {
        const mercX = centerMercX + (x - halfW) * mercatorPerPixelX;
        const mercY = centerMercY + (y - halfH) * mercatorPerPixelY;
        let lon = mercatorXToLon(mercX);
        while (lon > 180) lon -= 360;
        while (lon < -180) lon += 360;
        return { lat: mercatorYToLat(mercY), lon };
      },
      getVisibleBounds(): { north: number; south: number; east: number; west: number } {
        const halfWidthMerc = halfW * mercatorPerPixelX;
        const halfHeightMerc = halfH * mercatorPerPixelY;
        return {
          north: mercatorYToLat(centerMercY - halfHeightMerc),
          south: mercatorYToLat(centerMercY + halfHeightMerc),
          east: mercatorXToLon(centerMercX + halfWidthMerc),
          west: mercatorXToLon(centerMercX - halfWidthMerc),
        };
      },
      center: { lat: centerLat, lon: centerLon },
      zoom,
      pixelAspect,
    };
  }

  /** Convert lat/lon to buffer pixel coordinates. Returns null if off-screen. */
  latLonToPixel(lat: number, lon: number): { x: number; y: number } | null {
    const bufferWidth = this.getBufferWidth();
    const bufferHeight = this.getBufferHeight();
    const pixelAspect = this.getPixelAspectRatio?.() || (2 / 3);
    const geo = this._createGeoContext(bufferWidth, bufferHeight, pixelAspect);
    return geo.latLonToPixel(lat, lon);
  }

  /** Convert buffer pixel coordinates to lat/lon. */
  pixelToLatLon(x: number, y: number): { lat: number; lon: number } {
    const bufferWidth = this.getBufferWidth();
    const bufferHeight = this.getBufferHeight();
    const pixelAspect = this.getPixelAspectRatio?.() || (2 / 3);
    const geo = this._createGeoContext(bufferWidth, bufferHeight, pixelAspect);
    return geo.pixelToLatLon(x, y);
  }

  // ===== Programmatic API =====

  setView(lat: number, lon: number, zoom?: number): void {
    this._centerLat = Math.max(-85, Math.min(85, lat));
    this._centerLon = lon;
    while (this._centerLon > 180) this._centerLon -= 360;
    while (this._centerLon < -180) this._centerLon += 360;
    if (zoom !== undefined) {
      this._zoom = Math.max(0, Math.min(this.props.maxZoom ?? 20, zoom));
    }
    this._fireMove();
    this.markDirty();
    getGlobalEngine()?.render();
  }

  setZoom(z: number): void {
    this._zoom = Math.max(0, Math.min(this.props.maxZoom ?? 20, z));
    this._fireZoom();
    this._fireMove();
    this.markDirty();
    getGlobalEngine()?.render();
  }

  getCenter(): { lat: number; lon: number } {
    return { lat: this._centerLat, lon: this._centerLon };
  }

  getZoom(): number {
    return this._zoom;
  }

  getBoundsLatLon(): { north: number; south: number; east: number; west: number } {
    const bufferWidth = this.getBufferWidth();
    const bufferHeight = this.getBufferHeight();
    const pixelAspect = this.getPixelAspectRatio?.() || (2 / 3);

    const { mercatorPerPixelX, mercatorPerPixelY } = this._getMercatorScale(bufferHeight, pixelAspect);
    const halfWidthMerc = (bufferWidth / 2) * mercatorPerPixelX;
    const halfHeightMerc = (bufferHeight / 2) * mercatorPerPixelY;

    const centerMercX = lonToMercatorX(this._centerLon);
    const centerMercY = latToMercatorY(this._centerLat);

    return {
      north: mercatorYToLat(centerMercY - halfHeightMerc),
      south: mercatorYToLat(centerMercY + halfHeightMerc),
      east: mercatorXToLon(centerMercX + halfWidthMerc),
      west: mercatorXToLon(centerMercX - halfWidthMerc),
    };
  }

  panUp(): void {
    const pan = this._getPanDegrees();
    this._centerLat = Math.min(85, this._centerLat + pan);
    this._fireMove();
    this.markDirty();
    getGlobalEngine()?.render();
  }

  panDown(): void {
    const pan = this._getPanDegrees();
    this._centerLat = Math.max(-85, this._centerLat - pan);
    this._fireMove();
    this.markDirty();
    getGlobalEngine()?.render();
  }

  panLeft(): void {
    const pan = this._getPanDegrees();
    this._centerLon -= pan;
    while (this._centerLon < -180) this._centerLon += 360;
    this._fireMove();
    this.markDirty();
    getGlobalEngine()?.render();
  }

  panRight(): void {
    const pan = this._getPanDegrees();
    this._centerLon += pan;
    while (this._centerLon > 180) this._centerLon -= 360;
    this._fireMove();
    this.markDirty();
    getGlobalEngine()?.render();
  }

  zoomIn(): void {
    const maxZoom = this.props.maxZoom ?? 20;
    if (this._zoom < maxZoom) {
      this._zoom++;
      this._fireZoom();
      this._fireMove();
      this.markDirty();
      getGlobalEngine()?.render();
    }
  }

  zoomOut(): void {
    if (this._zoom > 0) {
      this._zoom--;
      this._fireZoom();
      this._fireMove();
      this.markDirty();
      getGlobalEngine()?.render();
    }
  }

  async clearCache(): Promise<void> {
    this._tileCache.clear();
    const engineCache = getGlobalEngine()?.cache;
    if (engineCache) {
      await engineCache.clear('tiles');
    }
  }

  private _getPanDegrees(): number {
    const panAmount = 0.1;
    const degreesPerPixel = 360 / (TILE_SIZE * Math.pow(2, this._zoom));
    return TILE_SIZE * panAmount * degreesPerPixel;
  }
}

// ===== Registration =====

registerComponent({
  type: 'tile-map',
  componentClass: TileMapElement,
  defaultProps: {
    lat: 51.5074,
    lon: -0.1278,
    zoom: 5,
    provider: 'openstreetmap',
    interactive: true,
    maxZoom: 20,
    cacheSize: 256,
    diskCache: true,
    diskCacheMaxMB: 200,
    disabled: false,
  },
});

export const tileMapSchema: ComponentSchema = {
  description: 'Interactive slippy tile map',
  props: {
    lat: { type: 'number', description: 'Center latitude (default: 51.5074)' },
    lon: { type: 'number', description: 'Center longitude (default: -0.1278)' },
    zoom: { type: 'number', description: 'Zoom level 0-20 (default: 5)' },
    provider: { type: 'string', description: 'Tile provider key (default: openstreetmap)' },
    providers: { type: 'object', description: 'Custom provider definitions (merged with built-ins)' },
    width: { type: ['number', 'string'], description: 'Width in columns or percentage' },
    height: { type: ['number', 'string'], description: 'Height in rows or percentage' },
    interactive: { type: 'boolean', description: 'Enable mouse interaction (default: true)' },
    maxZoom: { type: 'number', description: 'Maximum zoom level (default: 20)' },
    cacheSize: { type: 'number', description: 'In-memory tile cache size (default: 256)' },
    diskCache: { type: 'boolean', description: 'Enable disk caching (default: true)' },
    diskCacheMaxMB: { type: 'number', description: 'Disk cache budget in MB (default: 200)' },
    dither: { type: ['string', 'boolean'], enum: ['auto', 'none', 'floyd-steinberg', 'sierra-stable', 'ordered'], description: 'Dithering algorithm' },
    svgOverlay: { type: 'string', description: 'Declarative SVG <path> and <text> elements with lat/lon coordinates, rendered after tiles and before onOverlay' },
    onOverlay: { type: ['function', 'string'], description: 'Overlay drawing callback (canvas + geo context)' },
    onMove: { type: ['function', 'string'], description: 'Called when map position changes' },
    onZoom: { type: ['function', 'string'], description: 'Called when zoom level changes' },
    onClick: { type: ['function', 'string'], description: 'Called on map click with lat/lon' },
    onLoadingChange: { type: ['function', 'string'], description: 'Called when loading count changes' },
    onShader: { type: ['function', 'string'], description: 'Shader callback (x, y, time, resolution, source?) => [r,g,b] or [r,g,b,a]. Runs per-pixel after tiles + overlay.' },
    shaderFps: { type: 'number', description: 'Shader frame rate (default: 30). Use 0 for static filter.' },
    shaderRunTime: { type: 'number', description: 'Stop shader after this many ms, final frame becomes static image' },
  },
  styles: {
    tileContrast: { type: 'number', description: 'Tile contrast 0-2, multiplier on Oklab L around midpoint (default: 1)' },
    tileSaturation: { type: 'number', description: 'Tile saturation 0-2, multiplier on Oklab chroma (default: 1)' },
    tileBrightness: { type: 'number', description: 'Tile brightness -1 to 1, additive on Oklab L (default: 0)' },
    tileHue: { type: 'number', description: 'Tile hue rotation -180 to 180 degrees (default: 0)' },
    tileBlur: { type: 'number', description: 'Box blur radius in pixels (0=off, 1=3x3, 2=5x5)' },
    tileKeyColor: { type: 'string', description: 'Reference color for keying (e.g. #abd0e0 for water)' },
    tileKeyThreshold: { type: 'number', description: 'Oklab chroma distance cutoff (default: 0.05)' },
    tileKeyMatch: { type: 'number', description: 'L value for matching pixels (default: 0 = black)' },
    tileKeyMatchColor: { type: 'string', description: 'Color for matching pixels (overrides tile-key-match)' },
    tileKeyOther: { type: 'number', description: 'L value for non-matching pixels (default: 1 = white)' },
    tileKeyOtherColor: { type: 'string', description: 'Color for non-matching pixels (overrides tile-key-other)' },
  },
};

registerComponentSchema('tile-map', tileMapSchema);
