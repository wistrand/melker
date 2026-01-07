// Terminal rendering utilities for canvas component
// Unicode sextant characters and pixel-to-terminal conversion
// Extracted from canvas.ts to reduce file size

import { packRGBA, TRANSPARENT } from './color-utils.ts';

// Unicode sextant characters mapping (2x3 pixel blocks per character)
// Each character represents a 2-wide x 3-tall pixel pattern
// Pattern bits: [top-left, top-right, mid-left, mid-right, bot-left, bot-right]
export const BLOCKS_2X3 = [
  [' ', 0b000000],
  ['🬞', 0b000001],
  ['🬏', 0b000010],
  ['🬭', 0b000011],
  ['🬇', 0b000100],
  ['🬦', 0b000101],
  ['🬖', 0b000110],
  ['🬵', 0b000111],
  ['🬃', 0b001000],
  ['🬢', 0b001001],
  ['🬓', 0b001010],
  ['🬱', 0b001011],
  ['🬋', 0b001100],
  ['🬩', 0b001101],
  ['🬚', 0b001110],
  ['🬹', 0b001111],
  ['🬁', 0b010000],
  ['🬠', 0b010001],
  ['🬑', 0b010010],
  ['🬯', 0b010011],
  ['🬉', 0b010100],
  ['▐', 0b010101],
  ['🬘', 0b010110],
  ['🬷', 0b010111],
  ['🬅', 0b011000],
  ['🬤', 0b011001],
  ['🬔', 0b011010],
  ['🬳', 0b011011],
  ['🬍', 0b011100],
  ['🬫', 0b011101],
  ['🬜', 0b011110],
  ['🬻', 0b011111],
  ['🬀', 0b100000],
  ['🬟', 0b100001],
  ['🬐', 0b100010],
  ['🬮', 0b100011],
  ['🬈', 0b100100],
  ['🬧', 0b100101],
  ['🬗', 0b100110],
  ['🬶', 0b100111],
  ['🬄', 0b101000],
  ['🬣', 0b101001],
  ['▌', 0b101010],
  ['🬲', 0b101011],
  ['🬌', 0b101100],
  ['🬪', 0b101101],
  ['🬛', 0b101110],
  ['🬺', 0b101111],
  ['🬂', 0b110000],
  ['🬡', 0b110001],
  ['🬒', 0b110010],
  ['🬰', 0b110011],
  ['🬊', 0b110100],
  ['🬨', 0b110101],
  ['🬙', 0b110110],
  ['🬸', 0b110111],
  ['🬆', 0b111000],
  ['🬥', 0b111001],
  ['🬕', 0b111010],
  ['🬴', 0b111011],
  ['🬎', 0b111100],
  ['🬬', 0b111101],
  ['🬝', 0b111110],
  ['█', 0b111111]
] as const;

// Create lookup array for fast character access (direct index, faster than Map)
// Index is 6-bit pattern (0-63), value is sextant character
export const PIXEL_TO_CHAR: string[] = new Array(64).fill(' ');
for (const [char, pattern] of BLOCKS_2X3) {
  PIXEL_TO_CHAR[pattern] = char;
}

/**
 * Convert a 2x3 sextant pixel pattern to a terminal character.
 * Sextant bit pattern:
 *   bit 0 = bottom-right[5], bit 1 = bottom-left[4],
 *   bit 2 = middle-right[3], bit 3 = middle-left[2],
 *   bit 4 = top-right[1], bit 5 = top-left[0]
 *
 * @param pixels Array of 6 booleans [top-left, top-right, mid-left, mid-right, bot-left, bot-right]
 * @returns The sextant character representing this pattern
 */
export function pixelsToSextantChar(pixels: boolean[]): string {
  const pattern = (pixels[5] ? 0b000001 : 0) |
                  (pixels[4] ? 0b000010 : 0) |
                  (pixels[3] ? 0b000100 : 0) |
                  (pixels[2] ? 0b001000 : 0) |
                  (pixels[1] ? 0b010000 : 0) |
                  (pixels[0] ? 0b100000 : 0);
  return PIXEL_TO_CHAR[pattern];
}

/**
 * Convert a 6-bit pattern directly to a sextant character.
 * @param pattern 6-bit pattern (0-63)
 * @returns The sextant character
 */
export function patternToSextantChar(pattern: number): string {
  return PIXEL_TO_CHAR[pattern & 0x3F];
}

/**
 * Result of color quantization for a 2x3 sextant block.
 */
export interface QuantizedBlock {
  fgColor: number;  // Foreground color (packed RGBA)
  bgColor: number;  // Background color (packed RGBA)
  pixels: boolean[]; // Which pixels are "on" (foreground)
}

/**
 * Quantize a 2x3 block of colors into foreground and background colors.
 * Uses brightness-based partitioning with averaged colors per group.
 *
 * @param colors Array of 6 packed RGBA colors
 * @param brightness Pre-allocated array of 6 numbers for brightness values
 * @returns QuantizedBlock with fg/bg colors and pixel pattern
 */
export function quantizeBlockColors(
  colors: number[],
  brightness: number[]
): QuantizedBlock {
  const pixels: boolean[] = [false, false, false, false, false, false];

  // First pass: calculate brightness, find min/max, check if all same
  let validCount = 0;
  let totalBrightness = 0;
  let minBright = 1000, maxBright = -1;
  let firstColor = 0;
  let allSame = true;

  for (let i = 0; i < 6; i++) {
    const color = colors[i];
    if (color !== TRANSPARENT) {
      const r = (color >> 24) & 0xFF;
      const g = (color >> 16) & 0xFF;
      const b = (color >> 8) & 0xFF;
      const bright = (r * 77 + g * 150 + b * 29) >> 8;
      brightness[i] = bright;
      totalBrightness += bright;
      if (bright < minBright) minBright = bright;
      if (bright > maxBright) maxBright = bright;
      if (validCount === 0) {
        firstColor = color;
      } else if (color !== firstColor) {
        allSame = false;
      }
      validCount++;
    } else {
      brightness[i] = -1;
    }
  }

  if (validCount === 0) {
    return { fgColor: 0, bgColor: 0, pixels };
  }

  if (allSame) {
    for (let i = 0; i < 6; i++) {
      if (colors[i] !== TRANSPARENT) pixels[i] = true;
    }
    return { fgColor: firstColor, bgColor: firstColor, pixels };
  }

  // Second pass: partition by threshold and accumulate color sums
  let threshold = (minBright + maxBright) >> 1;
  let fgR = 0, fgG = 0, fgB = 0, fgCount = 0;
  let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;

  for (let i = 0; i < 6; i++) {
    const bright = brightness[i];
    if (bright < 0) continue;

    const color = colors[i];
    const r = (color >> 24) & 0xFF;
    const g = (color >> 16) & 0xFF;
    const b = (color >> 8) & 0xFF;

    if (bright >= threshold) {
      pixels[i] = true;
      fgR += r; fgG += g; fgB += b; fgCount++;
    } else {
      bgR += r; bgG += g; bgB += b; bgCount++;
    }
  }

  // If all went to one group, use mean brightness as threshold
  if (fgCount === 0 || bgCount === 0) {
    threshold = (totalBrightness / validCount) | 0;
    fgR = fgG = fgB = fgCount = 0;
    bgR = bgG = bgB = bgCount = 0;

    for (let i = 0; i < 6; i++) {
      const bright = brightness[i];
      if (bright < 0) continue;

      const color = colors[i];
      const r = (color >> 24) & 0xFF;
      const g = (color >> 16) & 0xFF;
      const b = (color >> 8) & 0xFF;

      if (bright >= threshold) {
        pixels[i] = true;
        fgR += r; fgG += g; fgB += b; fgCount++;
      } else {
        pixels[i] = false;
        bgR += r; bgG += g; bgB += b; bgCount++;
      }
    }
  }

  // Compute averaged colors
  let fgColor = 0;
  let bgColor = 0;

  if (fgCount > 0) {
    fgColor = packRGBA(
      (fgR / fgCount) | 0,
      (fgG / fgCount) | 0,
      (fgB / fgCount) | 0,
      255
    );
  }

  if (bgCount > 0) {
    bgColor = packRGBA(
      (bgR / bgCount) | 0,
      (bgG / bgCount) | 0,
      (bgB / bgCount) | 0,
      255
    );
  }

  // Fallback: if one group empty, use the other's color for both
  if (fgColor === 0 && bgColor !== 0) {
    fgColor = bgColor;
  } else if (bgColor === 0 && fgColor !== 0) {
    bgColor = fgColor;
  }

  return { fgColor, bgColor, pixels };
}
