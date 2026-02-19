// Bitmap font definitions for pixel renderer
// Each glyph is an array of row bitmasks (MSB = leftmost pixel)
// To replace a font, swap the glyphs record with your own bitmask arrays.
//
// PSF2 fonts can be loaded with parsePSF2(). Convert BDF→PSF2 with tools/bdf-to-psf2.ts.

import { getAsset } from '../../assets.ts';

export interface BitmapFont {
  readonly width: number;     // Pixels per glyph (horizontal)
  readonly height: number;    // Pixels per glyph (vertical)
  readonly glyphs: Record<string, number[]>;
}

const PSF2_MAGIC = 0x864ab572;
const PSF2_HAS_UNICODE_TABLE = 0x01;
const PSF2_SEPARATOR = 0xff;

/**
 * Parse a PSF2 (PC Screen Font v2) binary into a BitmapFont.
 *
 * Usage:
 *   const data = await Deno.readFile('media/fonts/5x7.psf2');
 *   const font = parsePSF2(data);
 */
export function parsePSF2(data: Uint8Array): BitmapFont {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const magic = view.getUint32(0, true);
  if (magic !== PSF2_MAGIC) {
    throw new Error('Not a PSF2 font (bad magic)');
  }

  const headerSize = view.getUint32(8, true);
  const flags = view.getUint32(12, true);
  const numGlyphs = view.getUint32(16, true);
  const bytesPerGlyph = view.getUint32(20, true);
  const height = view.getUint32(24, true);
  const width = view.getUint32(28, true);

  const bytesPerRow = Math.ceil(width / 8);
  const shift = bytesPerRow * 8 - width;

  // Read glyph bitmaps
  const glyphBitmaps: number[][] = [];
  let offset = headerSize;
  for (let g = 0; g < numGlyphs; g++) {
    const rows: number[] = [];
    for (let r = 0; r < height; r++) {
      let val = 0;
      for (let b = 0; b < bytesPerRow; b++) {
        val = (val << 8) | data[offset++];
      }
      rows.push(val >> shift);
    }
    glyphBitmaps.push(rows);
  }

  // Build glyph map from unicode table (or fallback to sequential)
  const glyphs: Record<string, number[]> = {};

  if (flags & PSF2_HAS_UNICODE_TABLE) {
    const decoder = new TextDecoder();
    for (let g = 0; g < numGlyphs; g++) {
      // Each entry: sequence of UTF-8 codepoints terminated by 0xFF
      // 0xFE starts combining sequences (skip those)
      while (offset < data.length) {
        const byte = data[offset];
        if (byte === PSF2_SEPARATOR) {
          offset++;
          break;
        }
        if (byte === 0xfe) {
          // Skip combining sequence until separator
          offset++;
          while (offset < data.length && data[offset] !== PSF2_SEPARATOR) offset++;
          if (offset < data.length) offset++; // skip separator
          break;
        }
        // Read one UTF-8 character
        let charLen = 1;
        if (byte >= 0xc0 && byte < 0xe0) charLen = 2;
        else if (byte >= 0xe0 && byte < 0xf0) charLen = 3;
        else if (byte >= 0xf0) charLen = 4;
        const char = decoder.decode(data.subarray(offset, offset + charLen));
        offset += charLen;
        glyphs[char] = glyphBitmaps[g];
      }
    }
  } else {
    // No unicode table — map sequentially from codepoint 0
    for (let g = 0; g < numGlyphs; g++) {
      if (g >= 32) {
        glyphs[String.fromCodePoint(g)] = glyphBitmaps[g];
      }
    }
  }

  return { width, height, glyphs };
}

// 3x5 font — compact, uppercase only (lowercase falls back to uppercase)
// Each row is 3 bits wide: bit 2 = left, bit 0 = right
export const FONT_3x5: BitmapFont = {
  width: 3,
  height: 5,
  glyphs: {
    ' ': [0, 0, 0, 0, 0],
    '!': [2, 2, 2, 0, 2],
    '"': [5, 5, 0, 0, 0],
    '#': [5, 7, 5, 7, 5],
    '$': [3, 6, 2, 3, 6],
    '%': [5, 1, 2, 4, 5],
    '&': [2, 5, 6, 5, 3],
    "'": [2, 2, 0, 0, 0],
    '(': [1, 2, 2, 2, 1],
    ')': [4, 2, 2, 2, 4],
    '*': [0, 5, 2, 5, 0],
    '+': [0, 2, 7, 2, 0],
    ',': [0, 0, 0, 2, 4],
    '-': [0, 0, 7, 0, 0],
    '.': [0, 0, 0, 0, 2],
    '/': [1, 1, 2, 4, 4],
    '0': [7, 5, 5, 5, 7],
    '1': [2, 6, 2, 2, 7],
    '2': [7, 1, 7, 4, 7],
    '3': [7, 1, 7, 1, 7],
    '4': [5, 5, 7, 1, 1],
    '5': [7, 4, 7, 1, 7],
    '6': [7, 4, 7, 5, 7],
    '7': [7, 1, 1, 1, 1],
    '8': [7, 5, 7, 5, 7],
    '9': [7, 5, 7, 1, 7],
    ':': [0, 2, 0, 2, 0],
    ';': [0, 2, 0, 2, 4],
    '<': [1, 2, 4, 2, 1],
    '=': [0, 7, 0, 7, 0],
    '>': [4, 2, 1, 2, 4],
    '?': [7, 1, 2, 0, 2],
    '@': [7, 5, 7, 4, 7],
    'A': [2, 5, 7, 5, 5],
    'B': [6, 5, 6, 5, 6],
    'C': [3, 4, 4, 4, 3],
    'D': [6, 5, 5, 5, 6],
    'E': [7, 4, 7, 4, 7],
    'F': [7, 4, 6, 4, 4],
    'G': [7, 4, 5, 5, 7],
    'H': [5, 5, 7, 5, 5],
    'I': [7, 2, 2, 2, 7],
    'J': [7, 1, 1, 5, 2],
    'K': [5, 5, 6, 5, 5],
    'L': [4, 4, 4, 4, 7],
    'M': [5, 7, 5, 5, 5],
    'N': [5, 7, 7, 5, 5],
    'O': [2, 5, 5, 5, 2],
    'P': [7, 5, 7, 4, 4],
    'Q': [2, 5, 5, 7, 3],
    'R': [6, 5, 6, 5, 5],
    'S': [3, 4, 2, 1, 6],
    'T': [7, 2, 2, 2, 2],
    'U': [5, 5, 5, 5, 7],
    'V': [5, 5, 5, 5, 2],
    'W': [5, 5, 7, 7, 5],
    'X': [5, 5, 2, 5, 5],
    'Y': [5, 5, 2, 2, 2],
    'Z': [7, 1, 2, 4, 7],
    '[': [6, 4, 4, 4, 6],
    '\\': [4, 4, 2, 1, 1],
    ']': [3, 1, 1, 1, 3],
    '^': [2, 5, 0, 0, 0],
    '_': [0, 0, 0, 0, 7],
    '`': [4, 2, 0, 0, 0],
    '{': [1, 2, 4, 2, 1],
    '|': [2, 2, 2, 2, 2],
    '}': [4, 2, 1, 2, 4],
    '~': [0, 5, 2, 0, 0],
    // ISO 8859-1 accented characters (best effort at 3x5)
    // Accent row + 4-row compressed base letter
    'À': [4, 2, 5, 7, 5],
    'Á': [1, 2, 5, 7, 5],
    'Â': [5, 2, 5, 7, 5],
    'Ã': [5, 2, 5, 7, 5],
    'Ä': [5, 2, 5, 7, 5],
    'Å': [2, 0, 5, 7, 5],
    'Æ': [3, 5, 7, 4, 7],
    'Ç': [3, 4, 4, 3, 2],
    'È': [4, 7, 6, 4, 7],
    'É': [1, 7, 6, 4, 7],
    'Ê': [2, 7, 6, 4, 7],
    'Ë': [5, 7, 6, 4, 7],
    'Ì': [4, 7, 2, 2, 7],
    'Í': [1, 7, 2, 2, 7],
    'Î': [2, 7, 2, 2, 7],
    'Ï': [5, 7, 2, 2, 7],
    'Ð': [6, 5, 7, 5, 6],
    'Ñ': [5, 5, 7, 7, 5],
    'Ò': [4, 2, 5, 5, 2],
    'Ó': [1, 2, 5, 5, 2],
    'Ô': [5, 2, 5, 5, 2],
    'Õ': [5, 2, 5, 5, 2],
    'Ö': [5, 2, 5, 5, 2],
    'Ø': [2, 5, 7, 5, 2],
    'Ù': [4, 5, 5, 5, 7],
    'Ú': [1, 5, 5, 5, 7],
    'Û': [2, 5, 5, 5, 7],
    'Ü': [5, 0, 5, 5, 7],
    'Ý': [1, 5, 5, 2, 2],
    'Þ': [4, 6, 5, 6, 4],
    'ß': [2, 5, 6, 5, 6],
    'ÿ': [5, 5, 5, 2, 2],
  },
};

// Lazy-loaded 5x7 font from embedded PSF2 data (converted from X11 BDF via tools/bdf-to-psf2.ts)
// COPYRIGHT "Public domain font.  Share and enjoy."
let _font5x7: BitmapFont | null = null;

export function getFont5x7(): BitmapFont {
  if (!_font5x7) {
    _font5x7 = parsePSF2(getAsset('font-5x7'));
  }
  return _font5x7;
}
