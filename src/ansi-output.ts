// ANSI output generation for terminal rendering
// Handles cursor movement optimization, color codes, and cell styling

// ANSI escape codes for terminal control
export const ANSI = {
  clearScreen: '\x1b[2J',
  cursorHome: '\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  alternateScreen: '\x1b[?1049h',
  normalScreen: '\x1b[?1049l',
  // Synchronized output sequences for reducing flicker
  beginSync: '\x1b[?2026h',     // Begin synchronized update (DEC Private Mode 2026)
  endSync: '\x1b[?2026l',       // End synchronized update
  // Additional anti-flicker sequences
  saveCursor: '\x1b[s',         // Save cursor position
  restoreCursor: '\x1b[u',      // Restore cursor position
};

export type ColorSupport = 'none' | '16' | '256' | 'truecolor';

export interface AnsiOutputOptions {
  colorSupport: ColorSupport;
}

export interface BufferCell {
  char: string;
  foreground?: string;
  background?: string;
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

        // Handle line wrapping
        if (currentX >= terminalWidth) {
          currentX = 0;
          currentY++;
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
    const codes: string[] = ['\x1b[0m']; // Reset

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
    if (cell.bold) codes.push('\x1b[1m');
    if (cell.dim) codes.push('\x1b[2m');
    if (cell.italic) codes.push('\x1b[3m');
    if (cell.underline) codes.push('\x1b[4m');
    if (cell.reverse) codes.push('\x1b[7m');

    return codes.join('');
  }

  /**
   * Convert color to ANSI escape code
   */
  private _getColorCode(color: string, isBackground: boolean): string {
    const offset = isBackground ? 10 : 0;

    // Handle named colors - map to ANSI codes for 16/256 color modes
    const namedColors: Record<string, number> = {
      black: 30, red: 31, green: 32, yellow: 33,
      blue: 34, magenta: 35, cyan: 36, white: 37,
      gray: 90, grey: 90,
      brightred: 91, brightgreen: 92, brightyellow: 93,
      brightblue: 94, brightmagenta: 95, brightcyan: 96, brightwhite: 97,
    };

    // Named colors to RGB for truecolor mode (standard CSS/web colors)
    const namedColorsRgb: Record<string, { r: number; g: number; b: number }> = {
      black: { r: 0, g: 0, b: 0 },
      red: { r: 255, g: 0, b: 0 },
      green: { r: 0, g: 128, b: 0 },
      yellow: { r: 255, g: 255, b: 0 },
      blue: { r: 0, g: 0, b: 255 },
      magenta: { r: 255, g: 0, b: 255 },
      cyan: { r: 0, g: 255, b: 255 },
      white: { r: 255, g: 255, b: 255 },
      gray: { r: 128, g: 128, b: 128 },
      grey: { r: 128, g: 128, b: 128 },
      brightred: { r: 255, g: 85, b: 85 },
      brightgreen: { r: 85, g: 255, b: 85 },
      brightyellow: { r: 255, g: 255, b: 85 },
      brightblue: { r: 85, g: 85, b: 255 },
      brightmagenta: { r: 255, g: 85, b: 255 },
      brightcyan: { r: 85, g: 255, b: 255 },
      brightwhite: { r: 255, g: 255, b: 255 },
    };

    const colorLower = color.toLowerCase();
    const namedColor = namedColors[colorLower];
    if (namedColor !== undefined) {
      // For 'none' color support, don't output colors
      if (this._colorSupport === 'none') {
        return '';
      }
      // In truecolor mode, use actual RGB values for named colors
      if (this._colorSupport === 'truecolor') {
        const rgb = namedColorsRgb[colorLower];
        if (rgb) {
          const code = isBackground ? 48 : 38;
          return `\x1b[${code};2;${rgb.r};${rgb.g};${rgb.b}m`;
        }
      }
      // For 16/256 color modes, use basic ANSI codes
      return `\x1b[${namedColor + offset}m`;
    }

    // If color support is disabled, don't use any colors
    if (this._colorSupport === 'none') {
      return '';
    }

    // Handle hex colors (#RGB or #RRGGBB)
    if (color.startsWith('#')) {
      const rgb = this._parseHexColor(color);
      if (rgb) {
        if (this._colorSupport === 'truecolor') {
          const code = isBackground ? 48 : 38;
          return `\x1b[${code};2;${rgb.r};${rgb.g};${rgb.b}m`;
        } else if (this._colorSupport === '256') {
          const color256 = this._hexTo256Color(rgb);
          const code = isBackground ? 48 : 38;
          return `\x1b[${code};5;${color256}m`;
        }
        // For '16' color support, fall back to nearest named color
        return this._getNearestNamedColor(rgb, isBackground);
      }
    }

    // Handle rgb(r,g,b) format
    const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1]);
      const g = parseInt(rgbMatch[2]);
      const b = parseInt(rgbMatch[3]);

      if (this._colorSupport === 'truecolor') {
        const code = isBackground ? 48 : 38;
        return `\x1b[${code};2;${r};${g};${b}m`;
      } else if (this._colorSupport === '256') {
        const color256 = this._hexTo256Color({ r, g, b });
        const code = isBackground ? 48 : 38;
        return `\x1b[${code};5;${color256}m`;
      }
      // For '16' color support, fall back to nearest named color
      return this._getNearestNamedColor({ r, g, b }, isBackground);
    }

    // Fallback to default
    return '';
  }

  /**
   * Parse hex color to RGB
   */
  private _parseHexColor(hex: string): { r: number; g: number; b: number } | null {
    const match = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return null;

    const color = match[1];
    if (color.length === 3) {
      // #RGB -> #RRGGBB
      const [r, g, b] = color.split('').map(c => c + c);
      return {
        r: parseInt(r, 16),
        g: parseInt(g, 16),
        b: parseInt(b, 16),
      };
    } else {
      // #RRGGBB
      return {
        r: parseInt(color.substr(0, 2), 16),
        g: parseInt(color.substr(2, 2), 16),
        b: parseInt(color.substr(4, 2), 16),
      };
    }
  }

  /**
   * Convert RGB to 256-color palette index
   */
  private _hexTo256Color(rgb: { r: number; g: number; b: number }): number {
    // Simplified 256-color conversion
    const r = Math.round(rgb.r / 51) * 51;
    const g = Math.round(rgb.g / 51) * 51;
    const b = Math.round(rgb.b / 51) * 51;

    return 16 + (36 * Math.round(r / 51)) + (6 * Math.round(g / 51)) + Math.round(b / 51);
  }

  /**
   * Get nearest named color for 16-color fallback
   */
  private _getNearestNamedColor(rgb: { r: number; g: number; b: number }, isBackground: boolean): string {
    const offset = isBackground ? 10 : 0;

    // Simple color distance calculation to nearest named color
    const colors = [
      { name: 'black', r: 0, g: 0, b: 0, code: 30 },
      { name: 'red', r: 255, g: 0, b: 0, code: 31 },
      { name: 'green', r: 0, g: 255, b: 0, code: 32 },
      { name: 'yellow', r: 255, g: 255, b: 0, code: 33 },
      { name: 'blue', r: 0, g: 0, b: 255, code: 34 },
      { name: 'magenta', r: 255, g: 0, b: 255, code: 35 },
      { name: 'cyan', r: 0, g: 255, b: 255, code: 36 },
      { name: 'white', r: 255, g: 255, b: 255, code: 37 },
    ];

    let nearestColor = colors[0];
    let minDistance = Infinity;

    for (const color of colors) {
      const distance = Math.sqrt(
        Math.pow(rgb.r - color.r, 2) +
        Math.pow(rgb.g - color.g, 2) +
        Math.pow(rgb.b - color.b, 2)
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestColor = color;
      }
    }

    return `\x1b[${nearestColor.code + offset}m`;
  }
}
