/**
 * Color Palette Management for Sixel Encoding
 *
 * Sixel graphics use indexed color with a limited palette (typically 256 colors).
 * This module handles color quantization (reducing 24-bit RGB to palette indices)
 * and palette caching for performance.
 *
 * ## Palette Modes
 *
 * Different content types require different palette strategies:
 *
 * ```
 * ┌─────────────┬──────────────────────────────────────────────────────────┐
 * │ Mode        │ Description                                              │
 * ├─────────────┼──────────────────────────────────────────────────────────┤
 * │ 'cached'    │ Static images. Palette and indexed data computed once,   │
 * │             │ cached by key (src path + dimensions). Fastest for       │
 * │             │ repeated renders of the same image.                      │
 * │             │ Used by: <img>, <canvas> with static content             │
 * ├─────────────┼──────────────────────────────────────────────────────────┤
 * │ 'keyframe'  │ Animated content. Palette from first "good" frame is     │
 * │             │ cached. Subsequent frames re-index against this palette. │
 * │             │ Fast (no quantization per frame) but may have color      │
 * │             │ errors if scene changes dramatically. Auto-regenerates   │
 * │             │ palette when:                                            │
 * │             │ - Mean color error exceeds threshold (2%)                │
 * │             │ - Frame has brighter pixels than palette supports        │
 * │             │ - Cached palette has too few colors (<32)                │
 * │             │ Used by: <video>, <canvas onShader/onPaint>, <img onFilter>│
 * ├─────────────┼──────────────────────────────────────────────────────────┤
 * │ 'dynamic'   │ Content changes every frame. Fresh palette computed      │
 * │             │ each render. Slowest but most accurate colors.           │
 * │             │ Not currently used (keyframe mode preferred).            │
 * ├─────────────┼──────────────────────────────────────────────────────────┤
 * │ 'fixed'     │ Standard 256-color palette (216 web-safe + 40 gray).     │
 * │             │ No quantization needed, but poor color accuracy.         │
 * │             │ Used as fallback when keyframe palette is too small.     │
 * └─────────────┴──────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Component Usage (set in canvas.ts _generateSixelOutput)
 *
 * ```typescript
 * const isVideo = this.type === 'video';
 * const isDynamic = !!this.props.onShader || !!this.props.onFilter || !!this.props.onPaint;
 * const paletteMode = (isVideo || isDynamic) ? 'keyframe' : 'cached';
 * const cacheKey = `${this.props.src || this.id}:${bufferWidth}x${bufferHeight}`;
 * ```
 *
 * ## Cache Key Format
 *
 * Cache keys include dimensions to prevent conflicts when the same image
 * is rendered at different sizes (e.g., thumbnail vs full size):
 *
 * ```
 * "/path/to/image.png:640x480"
 * "canvas-id-123:320x240"
 * ```
 *
 * ## Performance Characteristics
 *
 * | Mode     | Quantization | Indexing | Cache Hit |
 * |----------|--------------|----------|-----------|
 * | cached   | Once         | Once     | Full      |
 * | keyframe | Once/scene   | Per frame| Palette   |
 * | dynamic  | Per frame    | Per frame| None      |
 * | fixed    | Never        | Per frame| N/A       |
 *
 * Quantization is expensive (~10-50ms for large images).
 * Indexing is cheaper (~1-5ms) but still significant at 60fps.
 */

import { getLogger } from '../logging.ts';

const logger = getLogger('SixelPalette');

/**
 * Palette quantization result
 */
export interface PaletteResult {
  /** Color palette (RGBA values) */
  colors: number[];
  /** Pixel data as palette indices */
  indexed: Uint8Array;
  /** Quantization time in ms */
  quantizationTimeMs: number;
  /** Index of transparent color in palette (-1 if none) */
  transparentIndex: number;
  /** Mean color error (0-1 normalized, 0=perfect match) */
  meanError?: number;
  /** Pre-computed color lookup table for O(1) indexing (32KB, 5 bits per RGB channel) */
  colorLUT?: Uint8Array;
}

// Color LUT size: 32x32x32 = 32768 entries (5 bits per RGB channel)
const COLOR_LUT_SIZE = 32768;
const COLOR_LUT_BITS = 5;
const COLOR_LUT_SHIFT = 8 - COLOR_LUT_BITS;  // Shift 8-bit to 5-bit

// Adaptive keyframe threshold - regenerate palette when mean error exceeds this
// Value 0.02 means ~2% average color deviation triggers new keyframe
const KEYFRAME_ERROR_THRESHOLD = 0.02;

// Minimum colors for a "valid" keyframe palette
// Palettes with fewer colors (e.g., from blank frames) won't be cached
const MIN_KEYFRAME_COLORS = 32;

// Minimum brightness gap to trigger palette regeneration
// If frame has pixels brighter than palette max by this much, regenerate
const BRIGHTNESS_GAP_THRESHOLD = 50;

/**
 * Palette mode for different content types
 */
export type PaletteMode = 'dynamic' | 'fixed' | 'cached' | 'keyframe';

/**
 * Color box for median-cut algorithm
 */
interface ColorBox {
  colors: number[];
  rMin: number;
  rMax: number;
  gMin: number;
  gMax: number;
  bMin: number;
  bMax: number;
}

// Standard 216-color web-safe palette (6x6x6 RGB cube)
let standardPalette216: number[] | null = null;

// Standard 256-color palette (216 + 40 grayscale)
let standardPalette256: number[] | null = null;

/**
 * Generate standard 216-color web-safe palette
 */
function getStandardPalette216(): number[] {
  if (standardPalette216) return standardPalette216;

  standardPalette216 = [];
  const levels = [0, 51, 102, 153, 204, 255];

  for (const r of levels) {
    for (const g of levels) {
      for (const b of levels) {
        // RGBA format: 0xRRGGBBAA
        standardPalette216.push((r << 24) | (g << 16) | (b << 8) | 0xff);
      }
    }
  }

  return standardPalette216;
}

/**
 * Generate standard 256-color palette (216 colors + 40 grayscale)
 */
function getStandardPalette256(): number[] {
  if (standardPalette256) return standardPalette256;

  const palette = [...getStandardPalette216()];

  // Add 40 grayscale values (not including black/white from 216)
  for (let i = 0; i < 40; i++) {
    const gray = Math.round((i / 39) * 255);
    palette.push((gray << 24) | (gray << 16) | (gray << 8) | 0xff);
  }

  standardPalette256 = palette;
  return standardPalette256;
}

/**
 * Find nearest color in palette using squared Euclidean distance
 * @param skipIndex - Optional index to skip (for transparent color)
 */
function findNearestColor(rgba: number, palette: number[], skipIndex: number = -1): number {
  const r = (rgba >>> 24) & 0xff;
  const g = (rgba >>> 16) & 0xff;
  const b = (rgba >>> 8) & 0xff;

  let minDist = Infinity;
  let nearest = -1; // Start with invalid index to detect if we never find a match

  for (let i = 0; i < palette.length; i++) {
    // Skip the transparent index when matching opaque pixels
    if (i === skipIndex) continue;

    const pr = (palette[i] >>> 24) & 0xff;
    const pg = (palette[i] >>> 16) & 0xff;
    const pb = (palette[i] >>> 8) & 0xff;

    // Weighted distance (human eye is more sensitive to green)
    const dr = r - pr;
    const dg = g - pg;
    const db = b - pb;
    const dist = dr * dr * 2 + dg * dg * 4 + db * db * 3;

    if (dist < minDist) {
      minDist = dist;
      nearest = i;
    }

    // Early exit on exact match
    if (dist === 0) break;
  }

  // Fallback: if no match found (shouldn't happen), use first non-skipped index
  if (nearest === -1) {
    nearest = skipIndex === 0 ? 1 : 0;
    logger.error('findNearestColor: no match found!', undefined, {
      pixel: `rgb(${r},${g},${b})`,
      paletteLen: palette.length,
      skipIndex,
      fallback: nearest,
    });
  }

  return nearest;
}

/**
 * Build a color lookup table for O(1) palette indexing.
 *
 * The LUT maps quantized RGB (5 bits per channel) to nearest palette index.
 * This trades 32KB memory for O(1) lookups instead of O(palette.length).
 *
 * @param palette - Color palette (RGBA values)
 * @param skipIndex - Index to skip (transparent color)
 * @returns Uint8Array of 32768 entries mapping quantized RGB to palette index
 */
function buildColorLUT(palette: number[], skipIndex: number): Uint8Array {
  const lut = new Uint8Array(COLOR_LUT_SIZE);

  // For each quantized RGB value, find nearest palette color
  for (let r5 = 0; r5 < 32; r5++) {
    const r = (r5 << 3) | (r5 >> 2);  // Expand 5-bit to 8-bit
    const rOffset = r5 << 10;

    for (let g5 = 0; g5 < 32; g5++) {
      const g = (g5 << 3) | (g5 >> 2);
      const gOffset = g5 << 5;

      for (let b5 = 0; b5 < 32; b5++) {
        const b = (b5 << 3) | (b5 >> 2);

        // Find nearest color using weighted distance
        let minDist = Infinity;
        let nearest = skipIndex === 0 ? 1 : 0;

        for (let i = 0; i < palette.length; i++) {
          if (i === skipIndex) continue;

          const pr = (palette[i] >>> 24) & 0xff;
          const pg = (palette[i] >>> 16) & 0xff;
          const pb = (palette[i] >>> 8) & 0xff;

          // Weighted distance (same as findNearestColor)
          const dr = r - pr;
          const dg = g - pg;
          const db = b - pb;
          const dist = dr * dr * 2 + dg * dg * 4 + db * db * 3;

          if (dist < minDist) {
            minDist = dist;
            nearest = i;
            if (dist === 0) break;
          }
        }

        lut[rOffset | gOffset | b5] = nearest;
      }
    }
  }

  return lut;
}

/**
 * Look up palette index using pre-built LUT (O(1))
 */
function lookupColorLUT(lut: Uint8Array, rgba: number): number {
  const r5 = (rgba >>> (24 + COLOR_LUT_SHIFT)) & 0x1f;
  const g5 = (rgba >>> (16 + COLOR_LUT_SHIFT)) & 0x1f;
  const b5 = (rgba >>> (8 + COLOR_LUT_SHIFT)) & 0x1f;
  return lut[(r5 << 10) | (g5 << 5) | b5];
}

/**
 * Create color box from array of RGBA colors
 */
function createColorBox(colors: number[]): ColorBox {
  let rMin = 255, rMax = 0;
  let gMin = 255, gMax = 0;
  let bMin = 255, bMax = 0;

  for (const color of colors) {
    const r = (color >>> 24) & 0xff;
    const g = (color >>> 16) & 0xff;
    const b = (color >>> 8) & 0xff;

    rMin = Math.min(rMin, r);
    rMax = Math.max(rMax, r);
    gMin = Math.min(gMin, g);
    gMax = Math.max(gMax, g);
    bMin = Math.min(bMin, b);
    bMax = Math.max(bMax, b);
  }

  return { colors, rMin, rMax, gMin, gMax, bMin, bMax };
}

/**
 * Get the longest dimension of a color box
 */
function getLongestDimension(box: ColorBox): 'r' | 'g' | 'b' {
  const rRange = box.rMax - box.rMin;
  const gRange = box.gMax - box.gMin;
  const bRange = box.bMax - box.bMin;

  if (rRange >= gRange && rRange >= bRange) return 'r';
  if (gRange >= rRange && gRange >= bRange) return 'g';
  return 'b';
}

/**
 * Split a color box along its longest dimension at the median
 */
function splitColorBox(box: ColorBox): [ColorBox, ColorBox] {
  const dimension = getLongestDimension(box);

  // Sort by the chosen dimension
  const sorted = [...box.colors].sort((a, b) => {
    let av: number, bv: number;
    if (dimension === 'r') {
      av = (a >>> 24) & 0xff;
      bv = (b >>> 24) & 0xff;
    } else if (dimension === 'g') {
      av = (a >>> 16) & 0xff;
      bv = (b >>> 16) & 0xff;
    } else {
      av = (a >>> 8) & 0xff;
      bv = (b >>> 8) & 0xff;
    }
    return av - bv;
  });

  // Split at median
  const mid = Math.floor(sorted.length / 2);
  const low = sorted.slice(0, mid);
  const high = sorted.slice(mid);

  return [createColorBox(low), createColorBox(high)];
}

/**
 * Calculate average color of a box
 */
function averageColor(box: ColorBox): number {
  const n = box.colors.length;
  if (n === 0) {
    logger.error('averageColor called with empty box!');
    return 0x808080ff; // Return gray as fallback
  }

  let rSum = 0, gSum = 0, bSum = 0;

  for (const color of box.colors) {
    rSum += (color >>> 24) & 0xff;
    gSum += (color >>> 16) & 0xff;
    bSum += (color >>> 8) & 0xff;
  }

  const r = Math.round(rSum / n);
  const g = Math.round(gSum / n);
  const b = Math.round(bSum / n);

  return (r << 24) | (g << 16) | (b << 8) | 0xff;
}

/**
 * Median-cut color quantization
 * Reduces colors to maxColors while preserving color distribution
 */
export function quantizeMedianCut(
  pixels: Uint32Array,
  maxColors: number = 256
): PaletteResult {
  const startTime = performance.now();

  // Check if there are any transparent pixels
  let hasTransparent = false;
  for (const pixel of pixels) {
    const alpha = pixel & 0xff;
    if (alpha < 128) {
      hasTransparent = true;
      break;
    }
  }

  // Reserve slot 0 for transparent if needed
  const transparentIndex = hasTransparent ? 0 : -1;
  const effectiveMaxColors = hasTransparent ? maxColors - 1 : maxColors;

  // Collect unique colors (skip transparent)
  const colorCounts = new Map<number, number>();
  for (const pixel of pixels) {
    const alpha = pixel & 0xff;
    if (alpha < 128) continue; // Skip transparent

    const count = colorCounts.get(pixel) || 0;
    colorCounts.set(pixel, count + 1);
  }

  const uniqueColors = Array.from(colorCounts.keys());

  let palette: number[];

  // If fewer unique colors than max, use them directly
  if (uniqueColors.length <= effectiveMaxColors) {
    palette = hasTransparent ? [0x00000000, ...uniqueColors] : uniqueColors;
    // Build LUT for O(1) lookups (useful if palette is reused for keyframe mode)
    const colorLUT = buildColorLUT(palette, transparentIndex);
    const { indexed } = indexPixels(pixels, palette, transparentIndex, false, colorLUT);
    const quantizationTimeMs = performance.now() - startTime;

    return {
      colors: palette,
      indexed,
      quantizationTimeMs,
      transparentIndex,
      meanError: 0, // Perfect match when using all unique colors
      colorLUT,
    };
  }

  // Median-cut algorithm
  const boxes: ColorBox[] = [createColorBox(uniqueColors)];

  // Split boxes until we have enough colors
  while (boxes.length < effectiveMaxColors) {
    // Find box with most colors to split
    let maxIndex = 0;
    let maxCount = boxes[0].colors.length;

    for (let i = 1; i < boxes.length; i++) {
      if (boxes[i].colors.length > maxCount) {
        maxCount = boxes[i].colors.length;
        maxIndex = i;
      }
    }

    // Can't split further if largest box has only 1 color
    if (maxCount <= 1) break;

    // Split the largest box
    const [box1, box2] = splitColorBox(boxes[maxIndex]);
    boxes.splice(maxIndex, 1, box1, box2);
  }

  // Generate palette from box averages
  // Add transparent color at index 0 if needed
  palette = hasTransparent
    ? [0x00000000, ...boxes.map(averageColor)]
    : boxes.map(averageColor);

  // Note: We no longer modify the median-cut palette here.
  // For video content, use 'fixed' palette mode instead which provides
  // guaranteed full color coverage without the issues of median-cut averaging.

  // Build LUT for O(1) lookups (33ms for 256 colors, but enables O(1) re-indexing)
  const colorLUT = buildColorLUT(palette, transparentIndex);

  // Index pixels to palette using LUT
  const { indexed } = indexPixels(pixels, palette, transparentIndex, false, colorLUT);

  return {
    colors: palette,
    indexed,
    quantizationTimeMs: performance.now() - startTime,
    transparentIndex,
    meanError: 0, // Fresh palette is optimized for this image
    colorLUT,
  };
}

/**
 * Result of indexing pixels to a palette
 */
interface IndexResult {
  indexed: Uint8Array;
  meanError: number;
}

/**
 * Get max brightness in a palette (excluding transparent index)
 */
function getPaletteMaxBrightness(palette: number[], transparentIndex: number): number {
  let maxBright = 0;
  for (let i = 0; i < palette.length; i++) {
    if (i === transparentIndex) continue;
    const c = palette[i];
    const r = (c >>> 24) & 0xff;
    const g = (c >>> 16) & 0xff;
    const b = (c >>> 8) & 0xff;
    const bright = (r + g + b) / 3;
    if (bright > maxBright) maxBright = bright;
  }
  return maxBright;
}

/**
 * Get max brightness in pixel data (sampled for performance)
 */
function getPixelsMaxBrightness(pixels: Uint32Array): number {
  let maxBright = 0;
  // Sample every 8th pixel for speed
  for (let i = 0; i < pixels.length; i += 8) {
    const pixel = pixels[i];
    const alpha = pixel & 0xff;
    if (alpha < 128) continue;
    const r = (pixel >>> 24) & 0xff;
    const g = (pixel >>> 16) & 0xff;
    const b = (pixel >>> 8) & 0xff;
    const bright = (r + g + b) / 3;
    if (bright > maxBright) maxBright = bright;
  }
  return maxBright;
}

/**
 * Calculate squared color distance (for error measurement)
 */
function colorDistanceSquared(c1: number, c2: number): number {
  const r1 = (c1 >>> 24) & 0xff;
  const g1 = (c1 >>> 16) & 0xff;
  const b1 = (c1 >>> 8) & 0xff;
  const r2 = (c2 >>> 24) & 0xff;
  const g2 = (c2 >>> 16) & 0xff;
  const b2 = (c2 >>> 8) & 0xff;

  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;

  return dr * dr + dg * dg + db * db;
}

// Sample rate for error calculation (check every Nth pixel)
// Higher = faster but less accurate error estimate
const ERROR_SAMPLE_RATE = 16;

/**
 * Map pixels to palette indices and calculate mean error
 * @param transparentIndex - Index to use for transparent pixels (-1 to map to nearest color)
 * @param calcError - Whether to calculate mean error (uses sampling for speed)
 * @param colorLUT - Pre-built color lookup table for O(1) indexing (optional)
 */
function indexPixels(
  pixels: Uint32Array,
  palette: number[],
  transparentIndex: number = -1,
  calcError: boolean = false,
  colorLUT?: Uint8Array
): IndexResult {
  const indexed = new Uint8Array(pixels.length);

  // For error calculation, use separate sampling pass (faster than checking every pixel)
  let totalError = 0;
  let errorSamples = 0;

  // Use LUT for O(1) lookups if available, otherwise fall back to Map cache
  if (colorLUT) {
    // Fast path: O(1) LUT lookup per pixel
    for (let i = 0; i < pixels.length; i++) {
      const pixel = pixels[i];

      // Handle transparent pixels specially
      const alpha = pixel & 0xff;
      if (alpha < 128 && transparentIndex >= 0) {
        indexed[i] = transparentIndex;
        continue;
      }

      // O(1) lookup using pre-built table
      const index = lookupColorLUT(colorLUT, pixel);
      indexed[i] = index;

      // Sample error calculation (every Nth pixel)
      if (calcError && (i % ERROR_SAMPLE_RATE) === 0) {
        totalError += colorDistanceSquared(pixel, palette[index]);
        errorSamples++;
      }
    }
  } else {
    // Slow path: Build lookup cache for common colors (used during initial quantization)
    const cache = new Map<number, number>();

    for (let i = 0; i < pixels.length; i++) {
      const pixel = pixels[i];

      // Handle transparent pixels specially
      const alpha = pixel & 0xff;
      if (alpha < 128 && transparentIndex >= 0) {
        indexed[i] = transparentIndex;
        continue;
      }

      // Check cache first
      let index = cache.get(pixel);
      if (index === undefined) {
        // Skip transparent index when matching opaque pixels
        index = findNearestColor(pixel, palette, transparentIndex);
        cache.set(pixel, index);
      }

      indexed[i] = index;

      // Sample error calculation (every Nth pixel)
      if (calcError && (i % ERROR_SAMPLE_RATE) === 0) {
        totalError += colorDistanceSquared(pixel, palette[index]);
        errorSamples++;
      }
    }
  }

  // Normalize error to 0-1 range (max possible error is 255^2 * 3 = 195075)
  const maxError = 195075;
  const meanError = errorSamples > 0 ? (totalError / errorSamples) / maxError : 0;

  return { indexed, meanError };
}

// Cached LUTs for fixed palettes (built once, reused forever)
let fixedLUT256: Uint8Array | null = null;
let fixedLUT216: Uint8Array | null = null;

/**
 * Quantize using standard 256-color palette (fast, no computation)
 */
export function quantizeFixed256(pixels: Uint32Array): PaletteResult {
  const startTime = performance.now();

  const palette = getStandardPalette256();

  // Build LUT once for fixed palette (cached globally)
  if (!fixedLUT256) {
    fixedLUT256 = buildColorLUT(palette, -1);
  }

  // Fixed palettes don't have a dedicated transparent slot
  const { indexed } = indexPixels(pixels, palette, -1, false, fixedLUT256);

  const quantizationTimeMs = performance.now() - startTime;

  return {
    colors: palette,
    indexed,
    quantizationTimeMs,
    transparentIndex: -1,
    colorLUT: fixedLUT256,
  };
}

/**
 * Quantize using standard 216-color web-safe palette
 */
export function quantizeFixed216(pixels: Uint32Array): PaletteResult {
  const startTime = performance.now();

  const palette = getStandardPalette216();

  // Build LUT once for fixed palette (cached globally)
  if (!fixedLUT216) {
    fixedLUT216 = buildColorLUT(palette, -1);
  }

  // Fixed palettes don't have a dedicated transparent slot
  const { indexed } = indexPixels(pixels, palette, -1, false, fixedLUT216);

  const quantizationTimeMs = performance.now() - startTime;

  return {
    colors: palette,
    indexed,
    quantizationTimeMs,
    transparentIndex: -1,
    colorLUT: fixedLUT216,
  };
}

/**
 * Palette cache for static content
 */
export class SixelPaletteCache {
  private cache = new Map<string, PaletteResult>();
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  /**
   * Get cached palette result
   */
  get(key: string): PaletteResult | undefined {
    return this.cache.get(key);
  }

  /**
   * Store palette result
   */
  set(key: string, result: PaletteResult): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, result);
  }

  /**
   * Invalidate cached palette
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cached palettes
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size
   */
  get size(): number {
    return this.cache.size;
  }
}

// Global palette cache instance
let globalPaletteCache: SixelPaletteCache | null = null;

/**
 * Get or create global palette cache
 */
export function getGlobalPaletteCache(): SixelPaletteCache {
  if (!globalPaletteCache) {
    globalPaletteCache = new SixelPaletteCache();
  }
  return globalPaletteCache;
}

/**
 * Quantize pixels based on palette mode
 */
export function quantizePalette(
  pixels: Uint32Array,
  mode: PaletteMode,
  maxColors: number = 256,
  cacheKey?: string
): PaletteResult {
  const cache = getGlobalPaletteCache();

  // Check cache for cached/keyframe modes
  if ((mode === 'cached' || mode === 'keyframe') && cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached) {
      // For 'cached' mode, return entire cached result (static content)
      if (mode === 'cached') {
        return cached;
      }

      // For 'keyframe' mode, check if cached palette is too small (from blank frame)
      if (cached.colors.length < MIN_KEYFRAME_COLORS) {
        logger.info('Keyframe palette regenerating (too few colors)', {
          cacheKey,
          cachedColors: cached.colors.length,
          minRequired: MIN_KEYFRAME_COLORS,
        });
        cache.invalidate(cacheKey);
        // Fall through to requantize
      } else {
        // Check if palette covers the brightness range of current frame
        const paletteMaxBright = getPaletteMaxBrightness(cached.colors, cached.transparentIndex);
        const frameMaxBright = getPixelsMaxBrightness(pixels);

        if (frameMaxBright - paletteMaxBright > BRIGHTNESS_GAP_THRESHOLD) {
          logger.info('Keyframe palette regenerating (brightness gap)', {
            cacheKey,
            paletteMaxBright: Math.round(paletteMaxBright),
            frameMaxBright: Math.round(frameMaxBright),
            gap: Math.round(frameMaxBright - paletteMaxBright),
          });
          cache.invalidate(cacheKey);
          // Fall through to requantize
        } else {
          // Re-index with cached palette using LUT for O(1) lookups
          const startTime = performance.now();
          const { indexed, meanError } = indexPixels(
            pixels,
            cached.colors,
            cached.transparentIndex,
            true,
            cached.colorLUT  // Use cached LUT for fast re-indexing
          );

          // If error is acceptable, use cached palette
          if (meanError < KEYFRAME_ERROR_THRESHOLD) {
            return {
              colors: cached.colors,
              indexed,
              quantizationTimeMs: performance.now() - startTime,
              transparentIndex: cached.transparentIndex,
              meanError,
              colorLUT: cached.colorLUT,
            };
          }

          // Error too high - invalidate cache and fall through to requantize
          logger.info('Keyframe palette regenerating (color drift)', {
            cacheKey,
            meanError: meanError.toFixed(4),
            threshold: KEYFRAME_ERROR_THRESHOLD,
          });
          cache.invalidate(cacheKey);
        }
      }
    }
  }

  // Quantize based on mode
  let result: PaletteResult;

  switch (mode) {
    case 'fixed':
      result = maxColors > 216 ? quantizeFixed256(pixels) : quantizeFixed216(pixels);
      break;

    case 'dynamic':
    case 'cached':
    case 'keyframe':
    default:
      result = quantizeMedianCut(pixels, maxColors);
      break;
  }

  // Cache result if applicable
  if ((mode === 'cached' || mode === 'keyframe') && cacheKey) {
    // For keyframe mode, only cache palettes with enough colors
    // This avoids caching bad palettes from blank/loading frames
    if (mode === 'keyframe' && result.colors.length < MIN_KEYFRAME_COLORS) {
      logger.debug('Keyframe palette too small, using fixed fallback', { cacheKey, colors: result.colors.length });
      // Use fixed 256-color palette as fallback - ensures full color coverage
      // even for dark fade-in frames
      result = quantizeFixed256(pixels);
    } else {
      cache.set(cacheKey, result);
      if (mode === 'keyframe') {
        // Analyze palette brightness range
        let minBright = 255, maxBright = 0;
        for (let i = 0; i < result.colors.length; i++) {
          if (i === result.transparentIndex) continue;
          const c = result.colors[i];
          const r = (c >>> 24) & 0xff;
          const g = (c >>> 16) & 0xff;
          const b = (c >>> 8) & 0xff;
          const bright = Math.round((r + g + b) / 3);
          if (bright < minBright) minBright = bright;
          if (bright > maxBright) maxBright = bright;
        }
        // Log first few and brightest colors
        let brightestIdx = 0, brightestVal = 0;
        for (let i = 0; i < result.colors.length; i++) {
          if (i === result.transparentIndex) continue;
          const c = result.colors[i];
          const cr = (c >>> 24) & 0xff;
          const cg = (c >>> 16) & 0xff;
          const cb = (c >>> 8) & 0xff;
          const cb2 = (cr + cg + cb) / 3;
          if (cb2 > brightestVal) {
            brightestVal = cb2;
            brightestIdx = i;
          }
        }
        const bc = result.colors[brightestIdx];
        logger.info('New keyframe palette generated', {
          cacheKey,
          colors: result.colors.length,
          brightnessRange: `${minBright}-${maxBright}`,
          transparentIdx: result.transparentIndex,
          brightestColor: `idx${brightestIdx}=rgb(${(bc>>>24)&0xff},${(bc>>>16)&0xff},${(bc>>>8)&0xff})`,
        });
      }
    }
  }

  return result;
}

/**
 * Create a grayscale palette for gray/BW themes
 */
export function createGrayscalePalette(levels: number = 256): number[] {
  const palette: number[] = [];

  for (let i = 0; i < levels; i++) {
    const gray = Math.round((i / (levels - 1)) * 255);
    palette.push((gray << 24) | (gray << 16) | (gray << 8) | 0xff);
  }

  return palette;
}

/**
 * Convert color pixels to grayscale
 */
export function convertToGrayscale(pixels: Uint32Array): Uint32Array {
  const result = new Uint32Array(pixels.length);

  for (let i = 0; i < pixels.length; i++) {
    const pixel = pixels[i];
    const r = (pixel >>> 24) & 0xff;
    const g = (pixel >>> 16) & 0xff;
    const b = (pixel >>> 8) & 0xff;
    const a = pixel & 0xff;

    // Luminosity method (preserves perceived brightness)
    const gray = Math.round(r * 0.299 + g * 0.587 + b * 0.114);

    result[i] = (gray << 24) | (gray << 16) | (gray << 8) | a;
  }

  return result;
}
