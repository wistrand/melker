// Threshold-based dithering: ordered (Bayer), threshold matrix, and blue noise

import { decodePng } from '../../deps.ts';
import { MelkerConfig } from '../../config/mod.ts';
import { BAYER_8X8, type ThresholdMatrix } from './types.ts';
import { quantizeChannel, rgbToGray } from './utils.ts';
import { BLUE_NOISE_64, BLUE_NOISE_SIZE } from './blue-noise-64.ts';

// ============================================
// Threshold Matrix Loading
// ============================================

// Cache for loaded threshold matrices
const matrixCache = new Map<string, ThresholdMatrix>();

/**
 * Decode PNG bytes into a ThresholdMatrix and cache it.
 */
function decodePngToMatrix(pngData: Uint8Array, sourcePath: string): ThresholdMatrix {
  const decoded = decodePng(pngData);
  if (decoded.width !== decoded.height) {
    throw new Error(`Threshold matrix PNG must be square, got ${decoded.width}x${decoded.height}`);
  }
  const size = decoded.width;
  const data = new Uint8Array(size * size);
  const channels = decoded.channels || (decoded.data.length / (size * size));
  for (let i = 0; i < size * size; i++) {
    if (channels === 1) data[i] = decoded.data[i];
    else if (channels === 2) data[i] = decoded.data[i * 2];
    else {
      const idx = i * (channels >= 4 ? 4 : 3);
      data[i] = Math.round(0.299 * decoded.data[idx] + 0.587 * decoded.data[idx + 1] + 0.114 * decoded.data[idx + 2]);
    }
  }
  const matrix: ThresholdMatrix = { size, data, mask: size - 1 };
  matrixCache.set(sourcePath, matrix);
  return matrix;
}

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
  return decodePngToMatrix(pngData, pngPath);
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
  return decodePngToMatrix(pngData, pngPath);
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

// Embedded blue noise matrix (no runtime I/O needed for the default)
const BUILTIN_BLUE_NOISE: ThresholdMatrix = {
  size: BLUE_NOISE_SIZE,
  data: BLUE_NOISE_64,
  mask: BLUE_NOISE_SIZE - 1,
};

// Cached blue noise matrix — starts with the embedded default
let _blueNoiseMatrix: ThresholdMatrix | null = null;

/**
 * Get the blue noise threshold matrix.
 * Uses the embedded 64x64 matrix by default (no I/O).
 * If config overrides the path (dither.blueNoisePath / MELKER_BLUE_NOISE_PATH),
 * loads that file synchronously instead.
 * Returns null if custom loading fails (caller should fall back to ordered dithering).
 */
function getBlueNoiseMatrixLazy(): ThresholdMatrix | null {
  const configPath = MelkerConfig.get().blueNoisePath;

  // No custom path — use embedded matrix (zero I/O)
  if (!configPath) {
    return BUILTIN_BLUE_NOISE;
  }

  // Custom path — check cache
  const cached = matrixCache.get(configPath);
  if (cached) return cached;
  if (_blueNoiseMatrix) return _blueNoiseMatrix;

  // Try to load custom matrix synchronously
  try {
    _blueNoiseMatrix = loadThresholdMatrixFromPngSync(configPath);
    return _blueNoiseMatrix;
  } catch (error) {
    const errorMsg = `Failed to load blue noise matrix from ${configPath}: ${error instanceof Error ? error.message : error}`;
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
