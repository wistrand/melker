// Shared dithering utilities

import type { ColorSupport } from './types.ts';

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
