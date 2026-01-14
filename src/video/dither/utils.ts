// Shared dithering utilities and buffers

import type { ColorSupport } from './types.ts';

// ============================================
// Reusable Buffers (avoids per-frame allocation)
// ============================================

// Buffers are resized on demand if frame width changes
export const _ditherBuffers = {
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

export function ensureDitherBuffers(width: number, needsNextRow: boolean, extraPadding: number = 0): void {
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
export function quantizeChannel(value: number, levels: number): number {
  const step = 255 / (levels - 1);
  return Math.round(Math.round(value / step) * step);
}

/**
 * Convert RGB to grayscale using luminance formula
 */
export function rgbToGray(r: number, g: number, b: number): number {
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
export function quantizeColor(r: number, g: number, b: number, bits: number, out: number[]): void {
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
