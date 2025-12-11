// Dithering algorithms for video rendering
// Supports Floyd-Steinberg, Sierra, and ordered (Bayer) dithering

// ============================================
// Types
// ============================================

export type ColorSupport = 'none' | '16' | '256' | 'truecolor';

// Dither algorithm type
export type DitherMode = 'floyd-steinberg' | 'floyd-steinberg-stable' | 'sierra' | 'sierra-stable' | 'ordered' | 'none';

// ============================================
// Constants
// ============================================

// 8x8 Bayer matrix for ordered dithering (normalized to 0-63)
const BAYER_8X8 = [
  [ 0, 32,  8, 40,  2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44,  4, 36, 14, 46,  6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [ 3, 35, 11, 43,  1, 33,  9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47,  7, 39, 13, 45,  5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21]
];

// ============================================
// Reusable Buffers (avoids per-frame allocation)
// ============================================

// Buffers are resized on demand if frame width changes
const _ditherBuffers = {
  width: 0,
  // Floyd-Steinberg uses 2 rows
  errorR: new Float32Array(0),
  errorG: new Float32Array(0),
  errorB: new Float32Array(0),
  // Stable/Sierra variants use separate next-row buffers
  nextErrorR: new Float32Array(0),
  nextErrorG: new Float32Array(0),
  nextErrorB: new Float32Array(0),
};

function ensureDitherBuffers(width: number, needsNextRow: boolean, extraPadding: number = 0): void {
  const requiredSize = (width + extraPadding) * 2;  // *2 for Floyd-Steinberg two-row approach
  const requiredNextSize = width + extraPadding;

  if (_ditherBuffers.width < width || _ditherBuffers.errorR.length < requiredSize) {
    _ditherBuffers.width = width;
    _ditherBuffers.errorR = new Float32Array(requiredSize);
    _ditherBuffers.errorG = new Float32Array(requiredSize);
    _ditherBuffers.errorB = new Float32Array(requiredSize);
  }

  if (needsNextRow && _ditherBuffers.nextErrorR.length < requiredNextSize) {
    _ditherBuffers.nextErrorR = new Float32Array(requiredNextSize);
    _ditherBuffers.nextErrorG = new Float32Array(requiredNextSize);
    _ditherBuffers.nextErrorB = new Float32Array(requiredNextSize);
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Quantize a color channel to a specific number of levels
 */
function quantizeChannel(value: number, levels: number): number {
  const step = 255 / (levels - 1);
  return Math.round(Math.round(value / step) * step);
}

/**
 * Convert RGB to grayscale using luminance formula
 */
function rgbToGray(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/**
 * Convert ColorSupport to bits per channel
 */
export function colorSupportToBits(colorSupport: ColorSupport): number {
  switch (colorSupport) {
    case 'none': return 1;      // 2 levels (B&W)
    case '16': return 1;        // 2 levels per channel
    case '256': return 3;       // 8 levels per channel (approx 6x6x6 cube)
    case 'truecolor': return 5; // 32 levels per channel
    default: return 8;          // Full 256 levels
  }
}

/**
 * Quantize a color based on bits per channel (1-8)
 * Writes quantized RGB values to output array (avoids allocation)
 * @param r Red channel (0-255)
 * @param g Green channel (0-255)
 * @param b Blue channel (0-255)
 * @param bits Bits per channel (1-8), where 1 = 2 levels, 8 = 256 levels
 * @param out Output array [r, g, b] to write results into
 */
function quantizeColor(r: number, g: number, b: number, bits: number, out: number[]): void {
  // Clamp bits to valid range
  bits = Math.max(1, Math.min(8, Math.round(bits)));

  // Calculate number of levels: 2^bits
  const levels = 1 << bits;

  // Special case: 1 bit = B&W, convert to grayscale first
  if (bits === 1) {
    const gray = rgbToGray(r, g, b);
    const bw = gray >= 128 ? 255 : 0;
    out[0] = bw;
    out[1] = bw;
    out[2] = bw;
    return;
  }

  out[0] = quantizeChannel(r, levels);
  out[1] = quantizeChannel(g, levels);
  out[2] = quantizeChannel(b, levels);
}

// ============================================
// Dithering Algorithms
// ============================================

/**
 * Apply Floyd-Steinberg dithering to an RGBA frame buffer
 * Modifies the buffer in place
 *
 * The algorithm distributes quantization error to neighboring pixels:
 *   [*] 7/16 ->
 * 3/16 5/16 1/16
 *
 * @param frameData RGBA pixel data
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @param bits Bits per channel (1-8), where 1 = 2 levels (B&W), 8 = 256 levels
 */
export function applyFloydSteinbergDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number
): void {
  // Ensure reusable buffers are large enough
  ensureDitherBuffers(width, false);
  const errorR = _ditherBuffers.errorR;
  const errorG = _ditherBuffers.errorG;
  const errorB = _ditherBuffers.errorB;

  // Clear buffers (they may contain data from previous frame)
  errorR.fill(0, 0, width * 2);
  errorG.fill(0, 0, width * 2);
  errorB.fill(0, 0, width * 2);

  // Reusable output array for quantizeColor (avoids per-pixel allocation)
  const qOut = [0, 0, 0];

  for (let y = 0; y < height; y++) {
    // Swap error rows (current becomes previous, next becomes current)
    const currRow = (y % 2) * width;
    const nextRow = ((y + 1) % 2) * width;

    // Clear next row
    for (let x = 0; x < width; x++) {
      errorR[nextRow + x] = 0;
      errorG[nextRow + x] = 0;
      errorB[nextRow + x] = 0;
    }

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // Get original color + accumulated error
      let r = frameData[idx] + errorR[currRow + x];
      let g = frameData[idx + 1] + errorG[currRow + x];
      let b = frameData[idx + 2] + errorB[currRow + x];

      // Clamp to valid range
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));

      // Quantize (writes to qOut)
      quantizeColor(r, g, b, bits, qOut);
      const qr = qOut[0], qg = qOut[1], qb = qOut[2];

      // Calculate error
      const errR = r - qr;
      const errG = g - qg;
      const errB = b - qb;

      // Write quantized color back
      frameData[idx] = qr;
      frameData[idx + 1] = qg;
      frameData[idx + 2] = qb;
      // Alpha stays unchanged

      // Distribute error to neighbors using Floyd-Steinberg coefficients
      // Right pixel: 7/16
      if (x + 1 < width) {
        errorR[currRow + x + 1] += errR * 7 / 16;
        errorG[currRow + x + 1] += errG * 7 / 16;
        errorB[currRow + x + 1] += errB * 7 / 16;
      }

      // Bottom-left pixel: 3/16
      if (y + 1 < height && x > 0) {
        errorR[nextRow + x - 1] += errR * 3 / 16;
        errorG[nextRow + x - 1] += errG * 3 / 16;
        errorB[nextRow + x - 1] += errB * 3 / 16;
      }

      // Bottom pixel: 5/16
      if (y + 1 < height) {
        errorR[nextRow + x] += errR * 5 / 16;
        errorG[nextRow + x] += errG * 5 / 16;
        errorB[nextRow + x] += errB * 5 / 16;
      }

      // Bottom-right pixel: 1/16
      if (y + 1 < height && x + 1 < width) {
        errorR[nextRow + x + 1] += errR * 1 / 16;
        errorG[nextRow + x + 1] += errG * 1 / 16;
        errorB[nextRow + x + 1] += errB * 1 / 16;
      }
    }
  }
}

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
 * Apply stable Floyd-Steinberg dithering to an RGBA frame buffer
 * Uses serpentine scanning and processes row-by-row without carrying
 * error between rows, making it more temporally stable for video.
 * Modifies the buffer in place
 *
 * @param frameData RGBA pixel data
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @param bits Bits per channel (1-8), where 1 = 2 levels (B&W), 8 = 256 levels
 */
export function applyFloydSteinbergStableDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number
): void {
  // Clamp bits to valid range
  bits = Math.max(1, Math.min(8, Math.round(bits)));

  // Calculate number of levels: 2^bits
  const levels = 1 << bits;

  // Ensure reusable buffers are large enough
  ensureDitherBuffers(width, true);

  // Use first 'width' elements of main buffers for current row
  const errorR = _ditherBuffers.errorR;
  const errorG = _ditherBuffers.errorG;
  const errorB = _ditherBuffers.errorB;
  const nextErrorR = _ditherBuffers.nextErrorR;
  const nextErrorG = _ditherBuffers.nextErrorG;
  const nextErrorB = _ditherBuffers.nextErrorB;

  // Clear all buffers at start
  errorR.fill(0, 0, width);
  errorG.fill(0, 0, width);
  errorB.fill(0, 0, width);
  nextErrorR.fill(0, 0, width);
  nextErrorG.fill(0, 0, width);
  nextErrorB.fill(0, 0, width);

  const DECAY = 0.5; // Reduce vertical error propagation for stability

  for (let y = 0; y < height; y++) {
    // Copy next row errors to current (with decay already applied)
    for (let i = 0; i < width; i++) {
      errorR[i] = nextErrorR[i];
      errorG[i] = nextErrorG[i];
      errorB[i] = nextErrorB[i];
    }

    // Clear next row
    nextErrorR.fill(0, 0, width);
    nextErrorG.fill(0, 0, width);
    nextErrorB.fill(0, 0, width);

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      // Get original color + accumulated error
      let r = frameData[idx] + errorR[x];
      let g = frameData[idx + 1] + errorG[x];
      let b = frameData[idx + 2] + errorB[x];

      // Clamp to valid range
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));

      // Quantize
      let qr: number, qg: number, qb: number;
      if (bits === 1) {
        const gray = rgbToGray(r, g, b);
        const bw = gray >= 128 ? 255 : 0;
        qr = qg = qb = bw;
      } else {
        qr = quantizeChannel(r, levels);
        qg = quantizeChannel(g, levels);
        qb = quantizeChannel(b, levels);
      }

      // Calculate error
      const errR = r - qr;
      const errG = g - qg;
      const errB = b - qb;

      // Write quantized color back
      frameData[idx] = qr;
      frameData[idx + 1] = qg;
      frameData[idx + 2] = qb;

      // Distribute error - primarily horizontal for stability
      // Right pixel: 7/16 (full strength)
      if (x + 1 < width) {
        errorR[x + 1] += errR * 7 / 16;
        errorG[x + 1] += errG * 7 / 16;
        errorB[x + 1] += errB * 7 / 16;
      }

      // Bottom pixels with decay for temporal stability
      // Bottom-left: 3/16 * DECAY
      if (x > 0) {
        nextErrorR[x - 1] += errR * 3 / 16 * DECAY;
        nextErrorG[x - 1] += errG * 3 / 16 * DECAY;
        nextErrorB[x - 1] += errB * 3 / 16 * DECAY;
      }

      // Bottom: 5/16 * DECAY
      nextErrorR[x] += errR * 5 / 16 * DECAY;
      nextErrorG[x] += errG * 5 / 16 * DECAY;
      nextErrorB[x] += errB * 5 / 16 * DECAY;

      // Bottom-right: 1/16 * DECAY
      if (x + 1 < width) {
        nextErrorR[x + 1] += errR * 1 / 16 * DECAY;
        nextErrorG[x + 1] += errG * 1 / 16 * DECAY;
        nextErrorB[x + 1] += errB * 1 / 16 * DECAY;
      }
    }
  }
}

/**
 * Apply Sierra 2-row dithering to an RGBA frame buffer
 * Sierra 2-row is a good balance between quality and speed.
 * Error distribution pattern (divisor = 16):
 *       [*]  4   3
 *    1   2   3   2   1
 *
 * @param frameData RGBA pixel data
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @param bits Bits per channel (1-8), where 1 = 2 levels (B&W), 8 = 256 levels
 */
export function applySierraDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number
): void {
  // Clamp bits to valid range
  bits = Math.max(1, Math.min(8, Math.round(bits)));

  // Calculate number of levels: 2^bits
  const levels = 1 << bits;

  // Ensure reusable buffers are large enough (Sierra needs +4 padding)
  ensureDitherBuffers(width, true, 4);
  const bufSize = width + 4;

  const errorR = _ditherBuffers.errorR;
  const errorG = _ditherBuffers.errorG;
  const errorB = _ditherBuffers.errorB;
  const nextErrorR = _ditherBuffers.nextErrorR;
  const nextErrorG = _ditherBuffers.nextErrorG;
  const nextErrorB = _ditherBuffers.nextErrorB;

  // Clear buffers at start
  errorR.fill(0, 0, bufSize);
  errorG.fill(0, 0, bufSize);
  errorB.fill(0, 0, bufSize);
  nextErrorR.fill(0, 0, bufSize);
  nextErrorG.fill(0, 0, bufSize);
  nextErrorB.fill(0, 0, bufSize);

  const OFFSET = 2; // Padding offset for negative index access

  for (let y = 0; y < height; y++) {
    // Swap error buffers
    for (let i = 0; i < bufSize; i++) {
      errorR[i] = nextErrorR[i];
      errorG[i] = nextErrorG[i];
      errorB[i] = nextErrorB[i];
    }
    nextErrorR.fill(0, 0, bufSize);
    nextErrorG.fill(0, 0, bufSize);
    nextErrorB.fill(0, 0, bufSize);

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const ex = x + OFFSET;

      // Get original color + accumulated error
      let r = frameData[idx] + errorR[ex];
      let g = frameData[idx + 1] + errorG[ex];
      let b = frameData[idx + 2] + errorB[ex];

      // Clamp to valid range
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));

      // Quantize
      let qr: number, qg: number, qb: number;
      if (bits === 1) {
        const gray = rgbToGray(r, g, b);
        const bw = gray >= 128 ? 255 : 0;
        qr = qg = qb = bw;
      } else {
        qr = quantizeChannel(r, levels);
        qg = quantizeChannel(g, levels);
        qb = quantizeChannel(b, levels);
      }

      // Calculate error
      const errR = r - qr;
      const errG = g - qg;
      const errB = b - qb;

      // Write quantized color back
      frameData[idx] = qr;
      frameData[idx + 1] = qg;
      frameData[idx + 2] = qb;

      // Distribute error using Sierra 2-row pattern (divisor = 16)
      //       [*]  4   3
      //    1   2   3   2   1

      // Current row: right pixels
      // +1: 4/16
      errorR[ex + 1] += errR * 4 / 16;
      errorG[ex + 1] += errG * 4 / 16;
      errorB[ex + 1] += errB * 4 / 16;
      // +2: 3/16
      errorR[ex + 2] += errR * 3 / 16;
      errorG[ex + 2] += errG * 3 / 16;
      errorB[ex + 2] += errB * 3 / 16;

      // Next row
      // -2: 1/16
      nextErrorR[ex - 2] += errR * 1 / 16;
      nextErrorG[ex - 2] += errG * 1 / 16;
      nextErrorB[ex - 2] += errB * 1 / 16;
      // -1: 2/16
      nextErrorR[ex - 1] += errR * 2 / 16;
      nextErrorG[ex - 1] += errG * 2 / 16;
      nextErrorB[ex - 1] += errB * 2 / 16;
      // 0: 3/16
      nextErrorR[ex] += errR * 3 / 16;
      nextErrorG[ex] += errG * 3 / 16;
      nextErrorB[ex] += errB * 3 / 16;
      // +1: 2/16
      nextErrorR[ex + 1] += errR * 2 / 16;
      nextErrorG[ex + 1] += errG * 2 / 16;
      nextErrorB[ex + 1] += errB * 2 / 16;
      // +2: 1/16
      nextErrorR[ex + 2] += errR * 1 / 16;
      nextErrorG[ex + 2] += errG * 1 / 16;
      nextErrorB[ex + 2] += errB * 1 / 16;
    }
  }
}

/**
 * Apply stable Sierra 2-row dithering to an RGBA frame buffer
 * Like Sierra but with reduced vertical error propagation for temporal stability.
 * Error distribution pattern (divisor = 16, vertical with decay):
 *       [*]  4   3
 *    1   2   3   2   1  (all * DECAY)
 *
 * @param frameData RGBA pixel data
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @param bits Bits per channel (1-8), where 1 = 2 levels (B&W), 8 = 256 levels
 */
export function applySierraStableDither(
  frameData: Uint8Array,
  width: number,
  height: number,
  bits: number
): void {
  // Clamp bits to valid range
  bits = Math.max(1, Math.min(8, Math.round(bits)));

  // Calculate number of levels: 2^bits
  const levels = 1 << bits;

  // Ensure reusable buffers are large enough (Sierra needs +4 padding)
  ensureDitherBuffers(width, true, 4);
  const bufSize = width + 4;

  const errorR = _ditherBuffers.errorR;
  const errorG = _ditherBuffers.errorG;
  const errorB = _ditherBuffers.errorB;
  const nextErrorR = _ditherBuffers.nextErrorR;
  const nextErrorG = _ditherBuffers.nextErrorG;
  const nextErrorB = _ditherBuffers.nextErrorB;

  // Clear buffers at start
  errorR.fill(0, 0, bufSize);
  errorG.fill(0, 0, bufSize);
  errorB.fill(0, 0, bufSize);
  nextErrorR.fill(0, 0, bufSize);
  nextErrorG.fill(0, 0, bufSize);
  nextErrorB.fill(0, 0, bufSize);

  const OFFSET = 2; // Padding offset for negative index access
  const DECAY = 0.5; // Reduce vertical error propagation for stability

  for (let y = 0; y < height; y++) {
    // Swap error buffers
    for (let i = 0; i < bufSize; i++) {
      errorR[i] = nextErrorR[i];
      errorG[i] = nextErrorG[i];
      errorB[i] = nextErrorB[i];
    }
    nextErrorR.fill(0, 0, bufSize);
    nextErrorG.fill(0, 0, bufSize);
    nextErrorB.fill(0, 0, bufSize);

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const ex = x + OFFSET;

      // Get original color + accumulated error
      let r = frameData[idx] + errorR[ex];
      let g = frameData[idx + 1] + errorG[ex];
      let b = frameData[idx + 2] + errorB[ex];

      // Clamp to valid range
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));

      // Quantize
      let qr: number, qg: number, qb: number;
      if (bits === 1) {
        const gray = rgbToGray(r, g, b);
        const bw = gray >= 128 ? 255 : 0;
        qr = qg = qb = bw;
      } else {
        qr = quantizeChannel(r, levels);
        qg = quantizeChannel(g, levels);
        qb = quantizeChannel(b, levels);
      }

      // Calculate error
      const errR = r - qr;
      const errG = g - qg;
      const errB = b - qb;

      // Write quantized color back
      frameData[idx] = qr;
      frameData[idx + 1] = qg;
      frameData[idx + 2] = qb;

      // Distribute error using Sierra 2-row pattern (divisor = 16)
      // Horizontal at full strength, vertical with decay
      //       [*]  4   3
      //    1   2   3   2   1  (all * DECAY)

      // Current row: right pixels (full strength)
      // +1: 4/16
      errorR[ex + 1] += errR * 4 / 16;
      errorG[ex + 1] += errG * 4 / 16;
      errorB[ex + 1] += errB * 4 / 16;
      // +2: 3/16
      errorR[ex + 2] += errR * 3 / 16;
      errorG[ex + 2] += errG * 3 / 16;
      errorB[ex + 2] += errB * 3 / 16;

      // Next row (with decay for stability)
      // -2: 1/16 * DECAY
      nextErrorR[ex - 2] += errR * 1 / 16 * DECAY;
      nextErrorG[ex - 2] += errG * 1 / 16 * DECAY;
      nextErrorB[ex - 2] += errB * 1 / 16 * DECAY;
      // -1: 2/16 * DECAY
      nextErrorR[ex - 1] += errR * 2 / 16 * DECAY;
      nextErrorG[ex - 1] += errG * 2 / 16 * DECAY;
      nextErrorB[ex - 1] += errB * 2 / 16 * DECAY;
      // 0: 3/16 * DECAY
      nextErrorR[ex] += errR * 3 / 16 * DECAY;
      nextErrorG[ex] += errG * 3 / 16 * DECAY;
      nextErrorB[ex] += errB * 3 / 16 * DECAY;
      // +1: 2/16 * DECAY
      nextErrorR[ex + 1] += errR * 2 / 16 * DECAY;
      nextErrorG[ex + 1] += errG * 2 / 16 * DECAY;
      nextErrorB[ex + 1] += errB * 2 / 16 * DECAY;
      // +2: 1/16 * DECAY
      nextErrorR[ex + 2] += errR * 1 / 16 * DECAY;
      nextErrorG[ex + 2] += errG * 1 / 16 * DECAY;
      nextErrorB[ex + 2] += errB * 1 / 16 * DECAY;
    }
  }
}
