// Character width detection for terminal rendering
// Based on wcwidth algorithm for handling Unicode characters with different display widths

/**
 * Get the display width of a character in terminal cells
 * Returns:
 * - 0 for zero-width characters (combining marks, etc.)
 * - 1 for normal width characters
 * - 2 for wide characters (CJK, emojis, etc.)
 * - -1 for control characters
 */
export function getCharWidth(char: string): number {
  if (char.length === 0) return 0;

  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) return 1;

  // Control characters
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) {
    return -1;
  }

  // Zero-width characters
  if (isZeroWidth(codePoint)) {
    return 0;
  }

  // Wide characters (CJK, emojis, etc.)
  if (isWideCharacter(codePoint)) {
    return 2;
  }

  // Normal characters
  return 1;
}

/**
 * Get the total display width of a string
 */
export function getStringWidth(text: string): number {
  let width = 0;

  // Use Array.from to properly handle Unicode characters
  const characters = Array.from(text);

  for (const char of characters) {
    const charWidth = getCharWidth(char);
    if (charWidth > 0) {
      width += charWidth;
    }
  }

  return width;
}

/**
 * Check if a character is zero-width
 */
function isZeroWidth(codePoint: number): boolean {
  // Combining marks
  if (codePoint >= 0x0300 && codePoint <= 0x036F) return true;
  if (codePoint >= 0x1AB0 && codePoint <= 0x1AFF) return true;
  if (codePoint >= 0x1DC0 && codePoint <= 0x1DFF) return true;
  if (codePoint >= 0x20D0 && codePoint <= 0x20FF) return true;
  if (codePoint >= 0xFE20 && codePoint <= 0xFE2F) return true;

  // Zero width space and similar
  if (codePoint === 0x200B) return true; // Zero width space
  if (codePoint === 0x200C) return true; // Zero width non-joiner
  if (codePoint === 0x200D) return true; // Zero width joiner
  if (codePoint === 0xFEFF) return true; // Zero width no-break space

  return false;
}

/**
 * Check if a character is wide (takes 2 terminal cells)
 */
function isWideCharacter(codePoint: number): boolean {
  // East Asian Full-width and Wide characters
  if (codePoint >= 0x1100 && codePoint <= 0x115F) return true; // Hangul Jamo
  if (codePoint >= 0x2329 && codePoint <= 0x232A) return true; // Left/Right-pointing angle brackets
  if (codePoint >= 0x2E80 && codePoint <= 0x303E) return true; // CJK Radicals Supplement to CJK Symbols
  if (codePoint >= 0x3040 && codePoint <= 0xA4CF) return true; // Hiragana to Yi
  if (codePoint >= 0xAC00 && codePoint <= 0xD7A3) return true; // Hangul Syllables
  if (codePoint >= 0xF900 && codePoint <= 0xFAFF) return true; // CJK Compatibility Ideographs
  if (codePoint >= 0xFE10 && codePoint <= 0xFE19) return true; // Vertical forms
  if (codePoint >= 0xFE30 && codePoint <= 0xFE6F) return true; // CJK Compatibility Forms
  if (codePoint >= 0xFF00 && codePoint <= 0xFF60) return true; // Fullwidth ASCII
  if (codePoint >= 0xFFE0 && codePoint <= 0xFFE6) return true; // Fullwidth symbols

  // Emoji ranges (simplified - covers most common emojis)
  if (codePoint >= 0x1F300 && codePoint <= 0x1F64F) return true; // Miscellaneous Symbols and Pictographs
  if (codePoint >= 0x1F680 && codePoint <= 0x1F6FF) return true; // Transport and Map Symbols
  if (codePoint >= 0x1F700 && codePoint <= 0x1F77F) return true; // Alchemical Symbols
  if (codePoint >= 0x1F780 && codePoint <= 0x1F7FF) return true; // Geometric Shapes Extended
  if (codePoint >= 0x1F800 && codePoint <= 0x1F8FF) return true; // Supplemental Arrows-C
  if (codePoint >= 0x1F900 && codePoint <= 0x1F9FF) return true; // Supplemental Symbols and Pictographs
  if (codePoint >= 0x1FA00 && codePoint <= 0x1FA6F) return true; // Chess Symbols
  if (codePoint >= 0x1FA70 && codePoint <= 0x1FAFF) return true; // Symbols and Pictographs Extended-A

  // Additional emoji ranges
  if (codePoint >= 0x2600 && codePoint <= 0x26FF) return true; // Miscellaneous Symbols
  if (codePoint >= 0x2700 && codePoint <= 0x27BF) return true; // Dingbats

  return false;
}

/**
 * Split a string into an array of characters with their widths
 */
export interface CharInfo {
  char: string;
  width: number;
  visualIndex: number; // Index in visual display
  logicalIndex: number; // Index in string
}

export function analyzeString(text: string): CharInfo[] {
  const chars: CharInfo[] = [];
  let visualIndex = 0;
  let logicalIndex = 0;

  // Use Array.from to properly handle Unicode characters
  const characters = Array.from(text);

  for (const char of characters) {
    const width = getCharWidth(char);
    if (width >= 0) { // Skip control characters
      chars.push({
        char,
        width,
        visualIndex,
        logicalIndex
      });
      visualIndex += width;
    }
    logicalIndex++;
  }

  return chars;
}