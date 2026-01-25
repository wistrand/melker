// Sixel encoder - converts pixel data to sixel format
// Pure TypeScript implementation without external dependencies

import { getLogger } from '../logging.ts';

const logger = getLogger('SixelEncoder');

/**
 * Sixel encoding options
 */
export interface SixelEncodeOptions {
  /** Color palette (RGBA values, max 256) */
  palette: number[];
  /** Indexed pixel data (indices into palette) */
  indexed: Uint8Array;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** Transparent color index (-1 for no transparency) */
  transparentIndex?: number;
  /** Enable RLE compression (default: true) */
  useRLE?: boolean;
}

/**
 * Sixel output result
 */
export interface SixelOutput {
  /** Complete sixel sequence (DCS q ... ST) */
  data: string;
  /** Encoded size in bytes */
  size: number;
  /** Number of colors used */
  colors: number;
  /** Encoding time in ms */
  encodingTimeMs: number;
}

// Sixel character base (character '?' = 0x3F = 63, represents 6-bit value 0)
const SIXEL_BASE = 63;

// Maximum colors in sixel palette
// Note: Use 255 instead of 256 - some terminals (Konsole) have issues with index 255
const MAX_COLORS = 255;

// Pre-computed sixel character lookup table (0-63 -> '?' to '~')
const SIXEL_CHARS: string[] = new Array(64);
for (let i = 0; i < 64; i++) {
  SIXEL_CHARS[i] = String.fromCharCode(SIXEL_BASE + i);
}

/**
 * Convert RGBA color to sixel color definition string
 * Format: #reg;2;r%;g%;b%
 */
function colorToSixelDef(colorIndex: number, rgba: number): string {
  // Extract RGB components (RGBA is 0xRRGGBBAA)
  // Cap at 254 - some terminals (Konsole) have issues with 255 (pure white)
  const r = Math.min((rgba >>> 24) & 0xff, 254);
  const g = Math.min((rgba >>> 16) & 0xff, 254);
  const b = Math.min((rgba >>> 8) & 0xff, 254);

  // Convert to percentage (0-100)
  const rPct = Math.round((r / 255) * 100);
  const gPct = Math.round((g / 255) * 100);
  const bPct = Math.round((b / 255) * 100);

  // Format: #register;2;r%;g%;b%
  // 2 = RGB color mode
  return `#${colorIndex};2;${rPct};${gPct};${bPct}`;
}

/**
 * Encode a sixel row (6 pixels high)
 * Optimized single-pass approach with inline RLE
 *
 * Uses typed array bitmap instead of Set for O(1) color tracking with lower overhead.
 * - colorUsedBitmap: Uint8Array for O(1) membership check
 * - usedColorsList: Uint16Array for O(n) iteration (n = colors used in row)
 * - usedColorsCount: tracks number of colors used (passed by reference via array)
 */
function encodeSixelRow(
  indexed: Uint8Array,
  width: number,
  rowStart: number,
  height: number,
  _numColors: number,
  transparentIndex: number,
  useRLE: boolean,
  // Reusable buffers to avoid allocation
  sixelBits: Uint8Array[],  // [color][x] -> 6-bit pattern
  colorUsedBitmap: Uint8Array,  // [color] -> 0 or 1
  usedColorsList: Uint16Array,  // list of used color indices
  usedColorsCount: Uint16Array  // [0] = count (passed by reference)
): string {
  const rowHeight = Math.min(6, height - rowStart);

  // Clear arrays for colors that were used in previous row
  const prevCount = usedColorsCount[0];
  for (let i = 0; i < prevCount; i++) {
    const color = usedColorsList[i];
    sixelBits[color].fill(0, 0, width);
    colorUsedBitmap[color] = 0;
  }
  usedColorsCount[0] = 0;

  // Single pass over all pixels - build sixel bits for all colors at once
  for (let dy = 0; dy < rowHeight; dy++) {
    const y = rowStart + dy;
    const rowOffset = y * width;
    const bitMask = 1 << dy;

    for (let x = 0; x < width; x++) {
      const color = indexed[rowOffset + x];
      if (color !== transparentIndex) {
        // Safety check: ensure color index is within bounds of sixelBits array
        if (color >= sixelBits.length) {
          logger.error('Color index out of bounds!', undefined, {
            color,
            maxIndex: sixelBits.length - 1,
            x,
            y,
            transparentIndex,
          });
          continue; // Skip this pixel to avoid crash
        }
        sixelBits[color][x] |= bitMask;
        // Track color usage with bitmap (O(1) dedup) + list (for iteration)
        if (colorUsedBitmap[color] === 0) {
          colorUsedBitmap[color] = 1;
          usedColorsList[usedColorsCount[0]++] = color;
        }
      }
    }
  }

  // No colors used in this row
  const colorCount = usedColorsCount[0];
  if (colorCount === 0) {
    // Log if this seems unexpected (row had indexed data but all matched transparentIndex)
    let hasNonTransparent = false;
    for (let dy = 0; dy < rowHeight && !hasNonTransparent; dy++) {
      const y = rowStart + dy;
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        if (indexed[rowOffset + x] !== transparentIndex) {
          hasNonTransparent = true;
          break;
        }
      }
    }
    if (hasNonTransparent) {
      logger.warn('Row has non-transparent pixels but usedColors is empty!', {
        rowStart,
        rowHeight,
        transparentIndex,
        sixelBitsLength: sixelBits.length,
      });
    }
    return '-';
  }

  // Build output for each used color
  const outputParts: string[] = [];

  for (let ci = 0; ci < colorCount; ci++) {
    const color = usedColorsList[ci];
    const bits = sixelBits[color];

    if (useRLE) {
      // Inline RLE encoding
      const colorParts: string[] = [`#${color}`];
      let i = 0;

      while (i < width) {
        const sixelBit = bits[i];
        let count = 1;

        // Count consecutive identical values
        while (i + count < width && bits[i + count] === sixelBit) {
          count++;
        }

        const char = SIXEL_CHARS[sixelBit];

        // Use RLE if saves bytes (count >= 4)
        if (count >= 4) {
          colorParts.push(`!${count}${char}`);
        } else {
          // For small counts, repeat the character
          for (let j = 0; j < count; j++) {
            colorParts.push(char);
          }
        }

        i += count;
      }

      outputParts.push(colorParts.join(''));
    } else {
      // No RLE - direct conversion
      const chars: string[] = [`#${color}`];
      for (let x = 0; x < width; x++) {
        chars.push(SIXEL_CHARS[bits[x]]);
      }
      outputParts.push(chars.join(''));
    }
  }

  // Join colors with $ (carriage return), end with - (line feed)
  return outputParts.join('$') + '-';
}

/**
 * Encode pixel data to sixel format
 *
 * @param options - Encoding options with palette and indexed pixel data
 * @returns Sixel output with complete sequence
 */
export function encodeToSixel(options: SixelEncodeOptions): SixelOutput {
  const startTime = performance.now();

  const {
    palette,
    indexed,
    width,
    height,
    transparentIndex = -1,
    useRLE = true,
  } = options;

  const numColors = Math.min(palette.length, MAX_COLORS);

  // Sanity check: verify indexed values don't exceed palette size
  let maxIndexedValue = 0;
  for (let i = 0; i < indexed.length; i += 100) { // Sample every 100th pixel
    if (indexed[i] > maxIndexedValue) {
      maxIndexedValue = indexed[i];
    }
  }
  if (maxIndexedValue >= numColors) {
    logger.error('Indexed values exceed palette size!', undefined, {
      maxIndexedValue,
      numColors,
      paletteLength: palette.length,
      transparentIndex,
    });
  }

  // Build color definitions using array join
  const colorDefParts: string[] = [];
  for (let i = 0; i < numColors; i++) {
    if (i === transparentIndex) continue;
    colorDefParts.push(colorToSixelDef(i, palette[i]));
  }
  const colorDefs = colorDefParts.join('');

  // Pre-allocate reusable buffers for row encoding
  // sixelBits[color][x] holds the 6-bit pattern for each column
  const sixelBits: Uint8Array[] = new Array(numColors);
  for (let c = 0; c < numColors; c++) {
    sixelBits[c] = new Uint8Array(width);
  }
  // Typed array bitmap for O(1) color tracking (replaces Set for lower overhead)
  const colorUsedBitmap = new Uint8Array(numColors);
  const usedColorsList = new Uint16Array(numColors);
  const usedColorsCount = new Uint16Array(1);  // [0] = count (passed by reference)

  // Build sixel data (process in 6-pixel high strips)
  const sixelParts: string[] = [];
  for (let row = 0; row < height; row += 6) {
    sixelParts.push(encodeSixelRow(
      indexed,
      width,
      row,
      height,
      numColors,
      transparentIndex,
      useRLE,
      sixelBits,
      colorUsedBitmap,
      usedColorsList,
      usedColorsCount
    ));
  }
  let sixelData = sixelParts.join('');

  // Remove trailing - if present
  if (sixelData.endsWith('-')) {
    sixelData = sixelData.slice(0, -1);
  }

  // Build complete sixel sequence
  // DCS q [params] [color defs] [sixel data] ST
  // DCS = ESC P, ST = ESC \
  // q = sixel mode
  // Params: P1;P2;P3
  //   P1 = pixel aspect ratio (0 = default)
  //   P2 = background select (0 = bg color, 1 = current bg, 2 = transparent)
  //   P3 = horizontal grid size (0 = default)
  // Use P2=2 (transparent) so pixels outside the image bounds don't fill with bg color
  // This is important because sixel rows are 6 pixels tall, so last row may extend past image
  const dcs = '\x1bP0;2;0q'; // P1=0 (default aspect), P2=2 (transparent), P3=0 (default grid)
  const st = '\x1b\\';

  // Raster attributes: "Pan;Pad;Ph;Pv
  // Pan=1, Pad=1 (1:1 aspect ratio), Ph=width, Pv=height in pixels
  // This tells the terminal the intended dimensions of the sixel image
  const rasterAttr = `"1;1;${width};${height}`;

  const data = `${dcs}${rasterAttr}${colorDefs}${sixelData}${st}`;

  return {
    data,
    size: data.length,
    colors: numColors,
    encodingTimeMs: performance.now() - startTime,
  };
}

/**
 * Create a positioned sixel output with cursor handling
 *
 * @param sixelData - Sixel sequence from encodeToSixel
 * @param x - Column position (0-based)
 * @param y - Row position (0-based)
 * @returns Complete sequence with cursor positioning
 */
export function positionedSixel(sixelData: string, x: number, y: number): string {
  // Save cursor, position, output sixel, restore cursor
  const save = '\x1b7';
  const position = `\x1b[${y + 1};${x + 1}H`;
  const restore = '\x1b8';

  return `${save}${position}${sixelData}${restore}`;
}

/**
 * Wrap sixel output in synchronized output mode
 * This reduces flicker during animation
 */
export function synchronizedSixel(sixelData: string): string {
  const beginSync = '\x1b[?2026h';
  const endSync = '\x1b[?2026l';

  return `${beginSync}${sixelData}${endSync}`;
}

/**
 * Create safe sixel output with error recovery
 * Ensures sixel mode is properly terminated even on error
 */
export function safeSixelOutput(
  sixelData: string,
  x: number,
  y: number
): string {
  // Sixel terminator (ST = ESC \)
  const st = '\x1b\\';
  const save = '\x1b7';
  const restore = '\x1b8';
  const position = `\x1b[${y + 1};${x + 1}H`;

  // Include extra ST at end as safety (harmless if sixel already terminated)
  return `${save}${position}${sixelData}${st}${restore}`;
}

/**
 * Estimate encoded size without full encoding
 * Useful for bandwidth/memory planning
 */
export function estimateSixelSize(
  width: number,
  height: number,
  numColors: number
): number {
  // Color definitions: ~20 bytes per color
  const colorSize = numColors * 20;

  // Sixel data: approximately width bytes per 6-pixel row per color
  // With RLE, typically 30-70% of raw size
  const rows = Math.ceil(height / 6);
  const dataSize = width * rows * numColors * 0.5; // Estimate 50% RLE compression

  // DCS/ST overhead
  const overhead = 10;

  return Math.round(colorSize + dataSize + overhead);
}
