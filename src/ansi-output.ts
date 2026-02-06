// ANSI output generation for terminal rendering
// Handles cursor movement optimization, color codes, and cell styling

import type { PackedRGBA } from './types.ts';

// ANSI escape codes for terminal control
export const ANSI = {
  // Screen control
  clearScreen: '\x1b[2J',
  cursorHome: '\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  alternateScreen: '\x1b[?1049h',
  normalScreen: '\x1b[?1049l',
  // Synchronized output sequences for reducing flicker
  beginSync: '\x1b[?2026h',     // Begin synchronized update (DEC Private Mode 2026)
  endSync: '\x1b[?2026l',       // End synchronized update
  // Cursor save/restore
  saveCursor: '\x1b[s',         // Save cursor position
  restoreCursor: '\x1b[u',      // Restore cursor position
  // Text attributes
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  reverse: '\x1b[7m',
  // Mouse reporting modes
  mouseBasicOn: '\x1b[?1000h',
  mouseBasicOff: '\x1b[?1000l',
  mouseButtonOn: '\x1b[?1002h',
  mouseButtonOff: '\x1b[?1002l',
  mouseAnyOn: '\x1b[?1003h',
  mouseAnyOff: '\x1b[?1003l',
  mouseSgrOn: '\x1b[?1006h',
  mouseSgrOff: '\x1b[?1006l',
  mouseUrxvtOn: '\x1b[?1015h',
  mouseUrxvtOff: '\x1b[?1015l',
  // Application mode
  appCursorOn: '\x1b[?1h',
  appCursorOff: '\x1b[?1l',
  appKeypadOn: '\x1b=',
  appKeypadOff: '\x1b>',
};

export type ColorSupport = 'none' | '16' | '256' | 'truecolor';

/**
 * Convert RGB to 256-color palette index (6x6x6 color cube)
 */
export function rgbTo256Color(r: number, g: number, b: number): number {
  const rIdx = Math.round(r / 51);
  const gIdx = Math.round(g / 51);
  const bIdx = Math.round(b / 51);
  return 16 + (36 * rIdx) + (6 * gIdx) + bIdx;
}

/**
 * Convert RGB to nearest 16-color ANSI code (30-37, 90-97)
 * Uses perceptual luminance for grayscale detection and hue mapping
 */
export function rgbTo16Color(r: number, g: number, b: number): number {
  // Calculate luminance (perceived brightness)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Check if color is mostly grayscale (low saturation)
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;

  if (saturation < 0.2) {
    // Grayscale: map to black, gray, white, or bright white based on luminance
    if (luminance < 0.25) return 30;     // black
    if (luminance < 0.50) return 90;     // gray (bright black)
    if (luminance < 0.75) return 37;     // white
    return 97;                            // bright white
  }

  // Determine the dominant color channel
  const isBright = luminance > 0.5;
  const base = isBright ? 90 : 30;

  // Find the primary hue
  if (r >= g && r >= b) {
    // Red dominant
    if (g > b * 1.5) return base + 3;  // yellow
    if (b > g * 1.5) return base + 5;  // magenta
    return base + 1;                     // red
  } else if (g >= r && g >= b) {
    // Green dominant
    if (r > b * 1.5) return base + 3;  // yellow
    if (b > r * 1.5) return base + 6;  // cyan
    return base + 2;                     // green
  } else {
    // Blue dominant
    if (r > g * 1.5) return base + 5;  // magenta
    if (g > r * 1.5) return base + 6;  // cyan
    return base + 4;                     // blue
  }
}

export interface AnsiOutputOptions {
  colorSupport: ColorSupport;
}

export interface BufferCell {
  char: string;
  foreground?: PackedRGBA;
  background?: PackedRGBA;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  reverse?: boolean;
}

export interface BufferDifference {
  x: number;
  y: number;
  cell: BufferCell;
}

interface ContiguousSpan {
  x: number;
  y: number;
  cells: BufferCell[];
}

/**
 * Generates optimized ANSI output from buffer differences
 */
export class AnsiOutputGenerator {
  private _colorSupport: ColorSupport;

  constructor(options: AnsiOutputOptions) {
    this._colorSupport = options.colorSupport;
  }

  /**
   * Update color support setting
   */
  setColorSupport(colorSupport: ColorSupport): void {
    this._colorSupport = colorSupport;
  }

  /**
   * Generate optimized ANSI output from buffer differences
   */
  generateOptimizedOutput(differences: BufferDifference[], terminalWidth: number): string {
    if (differences.length === 0) return '';

    const commands: string[] = [];
    let currentX = -1;
    let currentY = -1;
    let currentStyle = '';

    // Sort differences by position for optimal cursor movement (row-major order)
    differences.sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });

    // Group contiguous spans to reduce cursor movements
    const spans = this._groupContiguousSpans(differences);

    for (const span of spans) {
      // Optimize cursor movement to start of span
      const newCursorCommands = this._generateCursorMovement(currentX, currentY, span.x, span.y);
      if (newCursorCommands) {
        commands.push(newCursorCommands);
        currentX = span.x;
        currentY = span.y;
      }

      // Process all cells in this span
      for (const cell of span.cells) {
        // Apply styling only when it changes
        const cellStyle = this._generateCellStyle(cell);
        if (cellStyle !== currentStyle) {
          commands.push(cellStyle);
          currentStyle = cellStyle;
        }

        // Write character
        commands.push(cell.char);
        currentX++;

        // Handle last column: terminals use deferred wrap (cursor stays at last
        // column until the next character), so our tracked position would be wrong
        // for relative cursor moves. Force absolute positioning for the next span.
        if (currentX >= terminalWidth) {
          currentX = -1;
          currentY = -1;
        }
      }
    }

    return commands.join('');
  }

  /**
   * Group differences into contiguous horizontal spans for efficient rendering
   */
  private _groupContiguousSpans(differences: BufferDifference[]): ContiguousSpan[] {
    const spans: ContiguousSpan[] = [];

    if (differences.length === 0) return spans;

    let currentSpan: ContiguousSpan | null = null;

    for (const diff of differences) {
      // Start new span if this is the first cell or not contiguous
      if (!currentSpan ||
          currentSpan.y !== diff.y ||
          currentSpan.x + currentSpan.cells.length !== diff.x) {

        // Save previous span if exists
        if (currentSpan) {
          spans.push(currentSpan);
        }

        // Start new span
        currentSpan = {
          x: diff.x,
          y: diff.y,
          cells: [diff.cell]
        };
      } else {
        // Add to current span
        currentSpan.cells.push(diff.cell);
      }
    }

    // Add final span
    if (currentSpan) {
      spans.push(currentSpan);
    }

    return spans;
  }

  /**
   * Generate optimized cursor movement commands
   */
  private _generateCursorMovement(fromX: number, fromY: number, toX: number, toY: number): string | null {
    // No movement needed
    if (fromX === toX && fromY === toY) {
      return null;
    }

    // First render or position unknown
    if (fromX === -1 || fromY === -1) {
      return `\x1b[${toY + 1};${toX + 1}H`;
    }

    // Calculate distance for different movement strategies
    const deltaX = toX - fromX;
    const deltaY = toY - fromY;

    // Special cases for very short movements
    if (deltaX === 1 && deltaY === 0) {
      return '\x1b[C'; // Single right
    }
    if (deltaX === -1 && deltaY === 0) {
      return '\x1b[D'; // Single left
    }
    if (deltaY === 1 && deltaX === 0) {
      return '\x1b[B'; // Single down
    }
    if (deltaY === -1 && deltaX === 0) {
      return '\x1b[A'; // Single up
    }

    // Absolute positioning (always works)
    const absoluteCmd = `\x1b[${toY + 1};${toX + 1}H`;
    let absoluteCost = absoluteCmd.length;

    // Relative movement options
    let relativeCost = Infinity;
    let relativeCmd = '';

    // Try relative movements for reasonable distances
    const totalDistance = Math.abs(deltaX) + Math.abs(deltaY);
    if (totalDistance <= 8) { // Increased threshold for relative movement
      const movements: string[] = [];

      // Vertical movement first (more common pattern)
      if (deltaY > 0) {
        if (deltaY === 1) {
          movements.push('\x1b[B'); // Down 1
        } else {
          movements.push(`\x1b[${deltaY}B`); // Down N
        }
      } else if (deltaY < 0) {
        const absY = Math.abs(deltaY);
        if (absY === 1) {
          movements.push('\x1b[A'); // Up 1
        } else {
          movements.push(`\x1b[${absY}A`); // Up N
        }
      }

      // Horizontal movement
      if (deltaX > 0) {
        if (deltaX === 1) {
          movements.push('\x1b[C'); // Right 1
        } else {
          movements.push(`\x1b[${deltaX}C`); // Right N
        }
      } else if (deltaX < 0) {
        const absX = Math.abs(deltaX);
        if (absX === 1) {
          movements.push('\x1b[D'); // Left 1
        } else {
          movements.push(`\x1b[${absX}D`); // Left N
        }
      }

      if (movements.length > 0) {
        relativeCmd = movements.join('');
        relativeCost = relativeCmd.length;
      }
    }

    // Special optimization for start of line
    if (toX === 0 && deltaY !== 0) {
      const lineCmd = deltaY > 0 ? `\x1b[${deltaY}E` : `\x1b[${Math.abs(deltaY)}F`;
      if (lineCmd.length < Math.min(absoluteCost, relativeCost)) {
        return lineCmd;
      }
    }

    // Use the more efficient option
    return relativeCost < absoluteCost ? relativeCmd : absoluteCmd;
  }

  /**
   * Generate ANSI style codes for a cell
   */
  private _generateCellStyle(cell: BufferCell): string {
    const codes: string[] = [ANSI.reset];

    // Colors only if color support is enabled
    if (this._colorSupport !== 'none') {
      // Foreground color
      if (cell.foreground) {
        codes.push(this._getColorCode(cell.foreground, false));
      }

      // Background color
      if (cell.background) {
        codes.push(this._getColorCode(cell.background, true));
      }
    }

    // Text attributes work regardless of color support
    if (cell.bold) codes.push(ANSI.bold);
    if (cell.dim) codes.push(ANSI.dim);
    if (cell.italic) codes.push(ANSI.italic);
    if (cell.underline) codes.push(ANSI.underline);
    if (cell.reverse) codes.push(ANSI.reverse);

    return codes.join('');
  }

  /**
   * Convert packed RGBA color to ANSI escape code
   * Colors are now stored as packed 32-bit RGBA (0xRRGGBBAA)
   */
  private _getColorCode(color: number, isBackground: boolean): string {
    // If color support is disabled, don't use any colors
    if (this._colorSupport === 'none') {
      return '';
    }

    // Extract RGB from packed color
    const r = (color >> 24) & 0xFF;
    const g = (color >> 16) & 0xFF;
    const b = (color >> 8) & 0xFF;

    if (this._colorSupport === 'truecolor') {
      const code = isBackground ? 48 : 38;
      return `\x1b[${code};2;${r};${g};${b}m`;
    } else if (this._colorSupport === '256') {
      const color256 = rgbTo256Color(r, g, b);
      const code = isBackground ? 48 : 38;
      return `\x1b[${code};5;${color256}m`;
    }

    // For '16' color support, find nearest named color
    return this._getColorCode16(color, isBackground);
  }

  /**
   * Map packed RGBA to nearest 16-color ANSI code
   */
  private _getColorCode16(color: number, isBackground: boolean): string {
    const offset = isBackground ? 10 : 0;
    const r = (color >> 24) & 0xFF;
    const g = (color >> 16) & 0xFF;
    const b = (color >> 8) & 0xFF;
    const code = rgbTo16Color(r, g, b);
    return `\x1b[${code + offset}m`;
  }
}
