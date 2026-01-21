// Threshold-based dithering: ordered (Bayer), threshold matrix, and blue noise

import { decodePng } from '../../deps.ts';
import { MelkerConfig } from '../../config/mod.ts';
import { BAYER_8X8, type ThresholdMatrix } from './types.ts';
import { quantizeChannel, rgbToGray } from './utils.ts';

// ============================================
// Threshold Matrix Loading
// ============================================

// Cache for loaded threshold matrices
const matrixCache = new Map<string, ThresholdMatrix>();

/**
 * Load a threshold matrix from a square grayscale PNG file (synchronous)
 * The PNG should be grayscale with values 0-255
 * Matrix is cached for reuse
 *
 * @param pngPath Path to the PNG file (absolute or relative to cwd)
 * @returns ThresholdMatrix ready for use with applyThresholdDither
 * @throws Error if file cannot be read or PNG is invalid
 */
export function loadThresholdMatrixFromPngSync(pngPath: string): ThresholdMatrix {
  // Check cache first
  const cached = matrixCache.get(pngPath);
  if (cached) return cached;

  // Load and decode PNG synchronously
  const pngData = Deno.readFileSync(pngPath);
  const decoded = decodePng(pngData);

  // Validate square dimensions
  if (decoded.width !== decoded.height) {
    throw new Error(`Threshold matrix PNG must be square, got ${decoded.width}x${decoded.height}`);
  }

  const size = decoded.width;

  // Extract grayscale values (handle both grayscale and RGB/RGBA)
  const data = new Uint8Array(size * size);
  const channels = decoded.channels || (decoded.data.length / (size * size));

  for (let i = 0; i < size * size; i++) {
    if (channels === 1) {
      // Grayscale
      data[i] = decoded.data[i];
    } else if (channels === 2) {
      // Grayscale + alpha
      data[i] = decoded.data[i * 2];
    } else if (channels === 3) {
      // RGB - use luminance
      const idx = i * 3;
      data[i] = Math.round(0.299 * decoded.data[idx] + 0.587 * decoded.data[idx + 1] + 0.114 * decoded.data[idx + 2]);
    } else {
      // RGBA - use luminance
      const idx = i * 4;
      data[i] = Math.round(0.299 * decoded.data[idx] + 0.587 * decoded.data[idx + 1] + 0.114 * decoded.data[idx + 2]);
    }
  }

  const matrix: ThresholdMatrix = {
    size,
    data,
    mask: size - 1,
  };

  // Cache for reuse
  matrixCache.set(pngPath, matrix);

  return matrix;
}

/**
 * Load a threshold matrix from a square grayscale PNG file (async)
 * The PNG should be grayscale with values 0-255
 * Matrix is cached for reuse
 *
 * @param pngPath Path to the PNG file (absolute or relative to cwd)
 * @returns ThresholdMatrix ready for use with applyThresholdDither
 */
export async function loadThresholdMatrixFromPng(pngPath: string): Promise<ThresholdMatrix> {
  // Check cache first
  const cached = matrixCache.get(pngPath);
  if (cached) return cached;

  // Load and decode PNG
  const pngData = await Deno.readFile(pngPath);
  const decoded = decodePng(pngData);

  // Validate square dimensions
  if (decoded.width !== decoded.height) {
    throw new Error(`Threshold matrix PNG must be square, got ${decoded.width}x${decoded.height}`);
  }

  const size = decoded.width;

  // Extract grayscale values (handle both grayscale and RGB/RGBA)
  const data = new Uint8Array(size * size);
  const channels = decoded.channels || (decoded.data.length / (size * size));

  for (let i = 0; i < size * size; i++) {
    if (channels === 1) {
      // Grayscale
      data[i] = decoded.data[i];
    } else if (channels === 2) {
      // Grayscale + alpha
      data[i] = decoded.data[i * 2];
    } else if (channels === 3) {
      // RGB - use luminance
      const idx = i * 3;
      data[i] = Math.round(0.299 * decoded.data[idx] + 0.587 * decoded.data[idx + 1] + 0.114 * decoded.data[idx + 2]);
    } else {
      // RGBA - use luminance
      const idx = i * 4;
      data[i] = Math.round(0.299 * decoded.data[idx] + 0.587 * decoded.data[idx + 1] + 0.114 * decoded.data[idx + 2]);
    }
  }

  const matrix: ThresholdMatrix = {
    size,
    data,
    mask: size - 1,
  };

  // Cache for reuse
  matrixCache.set(pngPath, matrix);

  return matrix;
}

/**
 * Synchronously get a cached threshold matrix
 * Returns undefined if not yet loaded
 */
export function getCachedThresholdMatrix(pngPath: string): ThresholdMatrix | undefined {
  return matrixCache.get(pngPath);
}

/**
 * Clear the threshold matrix cache
 */
export function clearThresholdMatrixCache(): void {
  matrixCache.clear();
}

// ============================================
// Blue Noise Matrix Loading
// ============================================

// Default blue noise PNG path (relative to module location)
// Can be overridden via config: dither.blueNoisePath or MELKER_BLUE_NOISE_PATH env var
const BUNDLED_BLUE_NOISE_PATH = new URL('../../../media/blue-noise-64.png', import.meta.url).pathname;

/**
 * Get the effective blue noise path from config or use bundled default
 */
function getBlueNoisePath(): string {
  const configPath = MelkerConfig.get().blueNoisePath;
  return configPath || BUNDLED_BLUE_NOISE_PATH;
}

// Cached blue noise matrix (loaded lazily on first use)
let _blueNoiseMatrix: ThresholdMatrix | null = null;
let _blueNoiseLoadedPath: string | null = null;
let _blueNoiseLoadFailed = false;

/**
 * Get the blue noise threshold matrix, loading synchronously if needed.
 * Uses config dither.blueNoisePath or falls back to bundled media/blue-noise-64.png.
 * Returns null if loading fails (caller should fall back to ordered dithering).
 */
function getBlueNoiseMatrixLazy(): ThresholdMatrix | null {
  const path = getBlueNoisePath();

  // If path changed, reset cache
  if (_blueNoiseLoadedPath !== null && _blueNoiseLoadedPath !== path) {
    _blueNoiseMatrix = null;
    _blueNoiseLoadFailed = false;
  }

  // Return cached matrix if available
  if (_blueNoiseMatrix) {
    return _blueNoiseMatrix;
  }

  // Don't retry if already failed for this path
  if (_blueNoiseLoadFailed && _blueNoiseLoadedPath === path) {
    return null;
  }

  // Try to load synchronously
  _blueNoiseLoadedPath = path;
  try {
    _blueNoiseMatrix = loadThresholdMatrixFromPngSync(path);
    return _blueNoiseMatrix;
  } catch (error) {
    _blueNoiseLoadFailed = true;
    // Use logger if available, otherwise console.error (for standalone usage)
    const errorMsg = `Failed to load blue noise matrix from ${path}: ${error instanceof Error ? error.message : error}`;
    console.error(errorMsg);
    return null;
  }
}

// ============================================
// Dithering Algorithms
// ============================================

/**
 * Apply ordered (Bayer) dithering to an RGBA frame buffer
 * This is temporally stable - same input always produces same output
 * Modifies the buffer in place
 *
 * @param frameData RGBA pixel data
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @param bits Bits per channel (1-8), where 1 = 2 levels (B&W), 8 = 256 levels
 */
export function applyOrderedDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number
): void {
  // Clamp bits to valid range
  bits = Math.max(1, Math.min(8, Math.round(bits)));

  // Calculate number of levels: 2^bits
  const levels = 1 << bits;

  // Calculate threshold spread based on quantization step
  // This determines how much the Bayer threshold affects the rounding
  const step = 256 / levels;
  const spread = step / 64; // Normalize Bayer values (0-63) to step size

  for (let y = 0; y < height; y++) {
    const bayerRow = BAYER_8X8[y & 7];

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const threshold = (bayerRow[x & 7] - 32) * spread; // Center around 0

      let r = frameData[idx];
      let g = frameData[idx + 1];
      let b = frameData[idx + 2];

      // Special case: 1 bit = B&W
      if (bits === 1) {
        const gray = rgbToGray(r, g, b);
        const bw = (gray + threshold) >= 128 ? 255 : 0;
        frameData[idx] = bw;
        frameData[idx + 1] = bw;
        frameData[idx + 2] = bw;
      } else {
        // Add threshold before quantizing
        r = Math.max(0, Math.min(255, r + threshold));
        g = Math.max(0, Math.min(255, g + threshold));
        b = Math.max(0, Math.min(255, b + threshold));

        frameData[idx] = quantizeChannel(r, levels);
        frameData[idx + 1] = quantizeChannel(g, levels);
        frameData[idx + 2] = quantizeChannel(b, levels);
      }
      // Alpha stays unchanged
    }
  }
}

/**
 * Apply threshold-based dithering using any square PNG matrix
 * Works with any threshold matrix (blue noise, halftone, stipple, etc.)
 * The matrix is tiled across the image using efficient bitmasking.
 * Modifies the buffer in place
 *
 * @param frameData RGBA pixel data
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @param bits Bits per channel (1-8), where 1 = 2 levels (B&W), 8 = 256 levels
 * @param matrix Threshold matrix loaded from PNG (use loadThresholdMatrixFromPng)
 */
export function applyThresholdDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number,
  matrix: ThresholdMatrix
): void {
  // Clamp bits to valid range
  bits = Math.max(1, Math.min(8, Math.round(bits)));

  // Calculate number of levels: 2^bits
  const levels = 1 << bits;

  // Calculate threshold spread based on quantization step
  // Matrix values are 0-255, center around 128 for threshold
  const step = 256 / levels;
  const spread = step / 256; // Normalize matrix values (0-255) to step size

  const { size, data, mask } = matrix;

  for (let y = 0; y < height; y++) {
    const rowOffset = (y & mask) * size;

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const threshold = (data[rowOffset + (x & mask)] - 128) * spread; // Center around 0

      let r = frameData[idx];
      let g = frameData[idx + 1];
      let b = frameData[idx + 2];

      // Special case: 1 bit = B&W
      if (bits === 1) {
        const gray = rgbToGray(r, g, b);
        const bw = (gray + threshold) >= 128 ? 255 : 0;
        frameData[idx] = bw;
        frameData[idx + 1] = bw;
        frameData[idx + 2] = bw;
      } else {
        // Add threshold before quantizing
        r = Math.max(0, Math.min(255, r + threshold));
        g = Math.max(0, Math.min(255, g + threshold));
        b = Math.max(0, Math.min(255, b + threshold));

        frameData[idx] = quantizeChannel(r, levels);
        frameData[idx + 1] = quantizeChannel(g, levels);
        frameData[idx + 2] = quantizeChannel(b, levels);
      }
      // Alpha stays unchanged
    }
  }
}

/**
 * Apply blue noise dithering to an RGBA frame buffer
 * Uses a 64x64 blue noise threshold matrix (void-and-cluster algorithm)
 * Blue noise has no visible pattern/grid artifacts like Bayer dithering
 * while maintaining temporal stability like ordered dithering.
 *
 * The matrix is loaded lazily on first use from the configured path
 * (dither.blueNoisePath / MELKER_BLUE_NOISE_PATH) or bundled media/blue-noise-64.png.
 * If loading fails, falls back to ordered (Bayer) dithering.
 *
 * @param frameData RGBA pixel data
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @param bits Bits per channel (1-8), where 1 = 2 levels (B&W), 8 = 256 levels
 */
export function applyBlueNoiseDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number
): void {
  const matrix = getBlueNoiseMatrixLazy();
  if (!matrix) {
    // Loading failed - fall back to ordered dithering (error already logged)
    applyOrderedDither(frameData, width, height, bits);
    return;
  }
  applyThresholdDither(frameData, width, height, bits, matrix);
}
