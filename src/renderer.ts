// Terminal renderer using ANSI escape codes with dual-buffer optimization

import { DualBuffer, BufferDiff, Cell, RenderOptions } from './buffer.ts';

export interface RendererOptions {
  colorSupport: 'none' | '16' | '256' | 'truecolor';
  enableMouse?: boolean;
  enableKeypad?: boolean;
  alternateScreen?: boolean;
}

export class TerminalRenderer {
  private _options: RendererOptions;
  private _isInitialized = false;
  private _lastCursorX = -1;
  private _lastCursorY = -1;
  private _lastCursorVisible = false;

  constructor(options: Partial<RendererOptions> = {}) {
    this._options = {
      colorSupport: 'truecolor',
      enableMouse: false,
      enableKeypad: true,
      alternateScreen: true,
      ...options,
    };
  }

  get options(): RendererOptions {
    return { ...this._options };
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  // Initialize terminal for rendering
  async initialize(): Promise<void> {
    if (this._isInitialized) return;

    const commands: string[] = [];

    // Save cursor position and attributes
    commands.push('\x1b7'); // Save cursor
    commands.push('\x1b[s'); // Save cursor (alternate)

    // Switch to alternate screen if enabled
    if (this._options.alternateScreen) {
      commands.push('\x1b[?1049h'); // Enable alternate screen
    }

    // Hide cursor initially
    commands.push('\x1b[?25l'); // Hide cursor

    // Enable keypad if requested
    if (this._options.enableKeypad) {
      commands.push('\x1b[?1h'); // Enable application cursor keys
      commands.push('\x1b='); // Enable application keypad
    }

    // Enable mouse if requested
    if (this._options.enableMouse) {
      commands.push('\x1b[?1000h'); // Enable mouse tracking
      commands.push('\x1b[?1002h'); // Enable button event tracking
      commands.push('\x1b[?1015h'); // Enable urxvt mouse mode
      commands.push('\x1b[?1006h'); // Enable SGR mouse mode
    }

    // Clear screen
    commands.push('\x1b[2J'); // Clear entire screen
    commands.push('\x1b[H'); // Move cursor to home

    // Write all commands
    await this._writeToTerminal(commands.join(''));

    this._isInitialized = true;
  }

  // Cleanup terminal state
  async cleanup(): Promise<void> {
    if (!this._isInitialized) return;

    const commands: string[] = [];

    // Show cursor
    commands.push('\x1b[?25h'); // Show cursor

    // Disable mouse if it was enabled
    if (this._options.enableMouse) {
      commands.push('\x1b[?1006l'); // Disable SGR mouse mode
      commands.push('\x1b[?1015l'); // Disable urxvt mouse mode
      commands.push('\x1b[?1002l'); // Disable button event tracking
      commands.push('\x1b[?1000l'); // Disable mouse tracking
    }

    // Disable keypad if it was enabled
    if (this._options.enableKeypad) {
      commands.push('\x1b>'); // Disable application keypad
      commands.push('\x1b[?1l'); // Disable application cursor keys
    }

    // Restore screen if alternate was used
    if (this._options.alternateScreen) {
      commands.push('\x1b[?1049l'); // Disable alternate screen
    }

    // Restore cursor
    commands.push('\x1b[u'); // Restore cursor (alternate)
    commands.push('\x1b8'); // Restore cursor

    // Reset all attributes
    commands.push('\x1b[0m'); // Reset all attributes

    await this._writeToTerminal(commands.join(''));

    this._isInitialized = false;
  }

  // Render buffer differences to terminal
  async render(dualBuffer: DualBuffer): Promise<void> {
    if (!this._isInitialized) {
      await this.initialize();
    }

    const differences = dualBuffer.swapAndGetDiff();
    const renderOptions = dualBuffer.renderOptions;

    await this._renderDifferences(differences, renderOptions);
  }

  // Force complete redraw
  async forceRender(dualBuffer: DualBuffer): Promise<void> {
    if (!this._isInitialized) {
      await this.initialize();
    }

    // Clear screen first
    await this._writeToTerminal('\x1b[2J\x1b[H');

    const differences = dualBuffer.forceRedraw();
    const renderOptions = dualBuffer.renderOptions;

    await this._renderDifferences(differences, renderOptions);
  }

  // Clear the terminal screen
  async clearScreen(): Promise<void> {
    await this._writeToTerminal('\x1b[2J\x1b[H');
  }

  // Set terminal title
  async setTitle(title: string): Promise<void> {
    await this._writeToTerminal(`\x1b]0;${title}\x1b\\`);
  }

  // Get terminal size
  async getTerminalSize(): Promise<{ width: number; height: number }> {
    // This is a simplified version - in a real implementation, you'd want to
    // query the terminal size using ANSI escape sequences or platform-specific APIs
    const width = (globalThis as any).process?.stdout?.columns || 80;
    const height = (globalThis as any).process?.stdout?.rows || 24;

    return { width, height };
  }

  // Private method to render differences with advanced optimization
  private async _renderDifferences(
    differences: BufferDiff[],
    options: RenderOptions
  ): Promise<void> {
    if (differences.length === 0) return;

    // Pre-allocate buffer for better performance
    const output = new Array<string>();
    let currentX = -1;
    let currentY = -1;
    let lastStyle = {
      foreground: '',
      background: '',
      bold: false,
      italic: false,
      underline: false,
      dim: false,
      reverse: false
    };

    // Sort differences by position for optimal cursor movement and group consecutive cells
    differences.sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });

    // Group consecutive cells on the same row to minimize cursor movements
    let i = 0;
    while (i < differences.length) {
      const diff = differences[i];

      // Skip wide character continuation cells at the top level
      if (diff.cell.isWideCharContinuation) {
        i++;
        continue;
      }

      // Move cursor only when necessary
      if (currentX !== diff.x || currentY !== diff.y) {
        output.push(`\x1b[${diff.y + 1};${diff.x + 1}H`);
        currentX = diff.x;
        currentY = diff.y;
      }

      // Collect consecutive cells with potential style optimization
      let consecutiveChars = '';
      let consecutiveVisualWidth = 0;
      let j = i;
      let expectedX = diff.x;

      while (j < differences.length &&
             differences[j].y === diff.y &&
             differences[j].x === expectedX) {

        const cellDiff = differences[j];

        // Skip wide character continuation cells (they don't produce output)
        if (cellDiff.cell.isWideCharContinuation) {
          expectedX++;
          j++;
          continue;
        }

        // Apply styling only when it changes
        const newStyle = {
          foreground: cellDiff.cell.foreground || '',
          background: cellDiff.cell.background || '',
          bold: cellDiff.cell.bold || false,
          italic: cellDiff.cell.italic || false,
          underline: cellDiff.cell.underline || false,
          dim: cellDiff.cell.dim || false,
          reverse: cellDiff.cell.reverse || false
        };

        if (this._styleChanged(lastStyle, newStyle)) {
          // Flush any accumulated characters with previous style
          if (consecutiveChars) {
            output.push(consecutiveChars);
            currentX += consecutiveVisualWidth;
            consecutiveChars = '';
            consecutiveVisualWidth = 0;
          }

          // Apply new style efficiently
          output.push(this._getOptimizedStyleCode(lastStyle, newStyle));
          lastStyle = newStyle;
        }

        consecutiveChars += cellDiff.cell.char;
        const charWidth = cellDiff.cell.width || 1;
        consecutiveVisualWidth += charWidth;
        expectedX += charWidth; // Move expected position by character width
        j++;
      }

      // Write accumulated characters
      if (consecutiveChars) {
        output.push(consecutiveChars);
        currentX += consecutiveVisualWidth;
      }

      i = j;
    }

    // Handle cursor positioning and visibility
    if (options.cursorVisible !== this._lastCursorVisible) {
      output.push(options.cursorVisible ? '\x1b[?25h' : '\x1b[?25l');
      this._lastCursorVisible = options.cursorVisible || false;
    }

    if (
      options.cursorVisible &&
      (options.cursorX !== this._lastCursorX || options.cursorY !== this._lastCursorY)
    ) {
      const x = Math.max(0, options.cursorX || 0);
      const y = Math.max(0, options.cursorY || 0);
      output.push(`\x1b[${y + 1};${x + 1}H`);
      this._lastCursorX = x;
      this._lastCursorY = y;
    }

    // Handle title
    if (options.title) {
      output.push(`\x1b]0;${options.title}\x1b\\`);
    }

    // Single optimized write operation
    if (output.length > 0) {
      await this._writeToTerminal(output.join(''));
    }
  }

  // Check if style has changed
  private _styleChanged(oldStyle: any, newStyle: any): boolean {
    return (
      oldStyle.foreground !== newStyle.foreground ||
      oldStyle.background !== newStyle.background ||
      oldStyle.bold !== newStyle.bold ||
      oldStyle.italic !== newStyle.italic ||
      oldStyle.underline !== newStyle.underline ||
      oldStyle.dim !== newStyle.dim ||
      oldStyle.reverse !== newStyle.reverse
    );
  }

  // Generate optimized ANSI style codes (only changes)
  private _getOptimizedStyleCode(oldStyle: any, newStyle: any): string {
    const codes: string[] = [];

    // Only reset if we need to clear attributes or change colors significantly
    const needsReset = (
      (oldStyle.bold && !newStyle.bold) ||
      (oldStyle.italic && !newStyle.italic) ||
      (oldStyle.underline && !newStyle.underline) ||
      (oldStyle.dim && !newStyle.dim) ||
      (oldStyle.reverse && !newStyle.reverse) ||
      (oldStyle.foreground && !newStyle.foreground) ||
      (oldStyle.background && !newStyle.background)
    );

    if (needsReset) {
      codes.push('\x1b[0m'); // Reset only when necessary
    }

    // Apply foreground and background colors
    // For 16-color mode, ensure fg and bg have enough contrast for visibility
    if (this._options.colorSupport === '16' && newStyle.foreground && newStyle.background) {
      const fgCode = this._getColorCode16(newStyle.foreground);
      let bgCode = this._getColorCode16(newStyle.background);

      // Ensure fg and bg have enough contrast (at least 2 steps apart in gray scale)
      bgCode = this._ensureContrast(fgCode, bgCode);

      if (newStyle.foreground !== oldStyle.foreground) {
        codes.push(`\x1b[${fgCode}m`);
      }
      if (newStyle.background !== oldStyle.background || bgCode !== this._getColorCode16(newStyle.background)) {
        codes.push(`\x1b[${bgCode + 10}m`);
      }
    } else {
      // Apply foreground color only if changed
      if (newStyle.foreground !== oldStyle.foreground) {
        if (newStyle.foreground) {
          codes.push(this._getColorCode(newStyle.foreground, false));
        }
      }

      // Apply background color only if changed
      if (newStyle.background !== oldStyle.background) {
        if (newStyle.background) {
          codes.push(this._getColorCode(newStyle.background, true));
        }
      }
    }

    // Apply text attributes only if changed
    if (newStyle.bold && !oldStyle.bold) codes.push('\x1b[1m');
    if (newStyle.dim && !oldStyle.dim) codes.push('\x1b[2m');
    if (newStyle.italic && !oldStyle.italic) codes.push('\x1b[3m');
    if (newStyle.underline && !oldStyle.underline) codes.push('\x1b[4m');
    if (newStyle.reverse && !oldStyle.reverse) codes.push('\x1b[7m');

    return codes.join('');
  }

  // Generate ANSI style codes for a cell (legacy method, kept for compatibility)
  private _getCellStyleCode(cell: Cell): string {
    const codes: string[] = ['\x1b[0m']; // Reset

    // Foreground color
    if (cell.foreground) {
      codes.push(this._getColorCode(cell.foreground, false));
    }

    // Background color
    if (cell.background) {
      codes.push(this._getColorCode(cell.background, true));
    }

    // Text attributes
    if (cell.bold) codes.push('\x1b[1m');
    if (cell.dim) codes.push('\x1b[2m');
    if (cell.italic) codes.push('\x1b[3m');
    if (cell.underline) codes.push('\x1b[4m');

    return codes.join('');
  }

  // Convert color to ANSI escape code
  private _getColorCode(color: string, isBackground: boolean): string {
    const offset = isBackground ? 10 : 0;

    // Handle named colors
    const namedColors: Record<string, number> = {
      black: 30, red: 31, green: 32, yellow: 33,
      blue: 34, magenta: 35, cyan: 36, white: 37,
      gray: 90, grey: 90,
      brightred: 91, brightgreen: 92, brightyellow: 93,
      brightblue: 94, brightmagenta: 95, brightcyan: 96, brightwhite: 97,
    };

    const namedColor = namedColors[color.toLowerCase()];
    if (namedColor !== undefined) {
      return `\x1b[${namedColor + offset}m`;
    }

    // Handle hex colors (#RGB or #RRGGBB)
    if (color.startsWith('#')) {
      const rgb = this._parseHexColor(color);
      if (rgb) {
        if (this._options.colorSupport === 'truecolor') {
          const code = isBackground ? 48 : 38;
          return `\x1b[${code};2;${rgb.r};${rgb.g};${rgb.b}m`;
        } else if (this._options.colorSupport === '256') {
          const color256 = this._hexTo256Color(color);
          const code = isBackground ? 48 : 38;
          return `\x1b[${code};5;${color256}m`;
        } else if (this._options.colorSupport === '16') {
          const color16 = this._rgbTo16Color(rgb.r, rgb.g, rgb.b);
          return `\x1b[${color16 + offset}m`;
        }
      }
    }

    // Handle rgb(r,g,b) format
    const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
      const [, rs, gs, bs] = rgbMatch;
      const r = parseInt(rs, 10);
      const g = parseInt(gs, 10);
      const b = parseInt(bs, 10);
      if (this._options.colorSupport === 'truecolor') {
        const code = isBackground ? 48 : 38;
        return `\x1b[${code};2;${r};${g};${b}m`;
      } else if (this._options.colorSupport === '256') {
        const color256 = this._rgbTo256Color(r, g, b);
        const code = isBackground ? 48 : 38;
        return `\x1b[${code};5;${color256}m`;
      } else if (this._options.colorSupport === '16') {
        const color16 = this._rgbTo16Color(r, g, b);
        return `\x1b[${color16 + offset}m`;
      }
    }

    // Fallback to default
    return '';
  }

  // Parse hex color to RGB
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

  // Convert hex color to closest 256-color palette index
  private _hexTo256Color(hex: string): number {
    const rgb = this._parseHexColor(hex);
    if (!rgb) return 15; // Default to white
    return this._rgbTo256Color(rgb.r, rgb.g, rgb.b);
  }

  // Convert RGB to closest 256-color palette index
  private _rgbTo256Color(r: number, g: number, b: number): number {
    // Simplified 256-color conversion using the 6x6x6 color cube
    const rIdx = Math.round(r / 51);
    const gIdx = Math.round(g / 51);
    const bIdx = Math.round(b / 51);
    return 16 + (36 * rIdx) + (6 * gIdx) + bIdx;
  }

  // Get 16-color code for a color string (returns foreground code 30-37 or 90-97)
  private _getColorCode16(color: string): number {
    // Handle named colors
    const namedColors: Record<string, number> = {
      black: 30, red: 31, green: 32, yellow: 33,
      blue: 34, magenta: 35, cyan: 36, white: 37,
      gray: 90, grey: 90, brightblack: 90, // brightBlack from colorToGray maps to gray (90)
      brightred: 91, brightgreen: 92, brightyellow: 93,
      brightblue: 94, brightmagenta: 95, brightcyan: 96, brightwhite: 97,
    };
    const namedColor = namedColors[color.toLowerCase()];
    if (namedColor !== undefined) return namedColor;

    // Handle hex colors
    if (color.startsWith('#')) {
      const rgb = this._parseHexColor(color);
      if (rgb) return this._rgbTo16Color(rgb.r, rgb.g, rgb.b);
    }

    // Handle rgb(r,g,b) format
    const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
      const [, r, g, b] = rgbMatch;
      return this._rgbTo16Color(parseInt(r, 10), parseInt(g, 10), parseInt(b, 10));
    }

    return 37; // Default to white
  }

  // Ensure fg and bg have enough contrast for visibility
  // Returns adjusted bgCode if needed
  private _ensureContrast(fgCode: number, bgCode: number): number {
    // Gray scale codes: 30 (black), 90 (gray), 37 (white), 97 (bright white)
    // Map codes to grayscale "levels" for comparison
    const grayLevels: Record<number, number> = {
      30: 0,   // black
      90: 1,   // gray (bright black)
      37: 2,   // white (light gray)
      97: 3,   // bright white
    };

    const fgLevel = grayLevels[fgCode];
    const bgLevel = grayLevels[bgCode];

    // If both are grayscale colors, ensure they're at least 2 levels apart
    if (fgLevel !== undefined && bgLevel !== undefined) {
      const diff = Math.abs(fgLevel - bgLevel);
      if (diff < 2) {
        // Not enough contrast - pick a bg that's 2+ levels away
        if (fgLevel <= 1) {
          // Dark fg -> use bright bg
          return fgLevel === 0 ? 37 : 97;  // white or bright white
        } else {
          // Bright fg -> use dark bg
          return fgLevel === 3 ? 90 : 30;  // gray or black
        }
      }
    }

    // For non-gray colors or sufficient contrast, return original
    return bgCode;
  }

  // Convert RGB to closest 16-color ANSI code (foreground base: 30-37, 90-97)
  private _rgbTo16Color(r: number, g: number, b: number): number {
    // Calculate luminance (perceived brightness)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // Check if color is mostly grayscale (low saturation)
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;

    if (saturation < 0.2) {
      // Grayscale: map to black, gray, white, or bright white based on luminance
      // Evenly distributed thresholds (25% each)
      if (luminance < 0.25) return 30;     // black
      if (luminance < 0.50) return 90;     // gray (bright black)
      if (luminance < 0.75) return 37;     // white
      return 97;                            // bright white
    }

    // Determine the dominant color channel
    const isBright = luminance > 0.5;
    const base = isBright ? 90 : 30; // bright colors start at 90

    // Find the primary hue
    if (r >= g && r >= b) {
      // Red dominant
      if (g > b * 1.5) return base + 3;  // yellow (red + green)
      if (b > g * 1.5) return base + 5;  // magenta (red + blue)
      return base + 1;                     // red
    } else if (g >= r && g >= b) {
      // Green dominant
      if (r > b * 1.5) return base + 3;  // yellow (green + red)
      if (b > r * 1.5) return base + 6;  // cyan (green + blue)
      return base + 2;                     // green
    } else {
      // Blue dominant
      if (r > g * 1.5) return base + 5;  // magenta (blue + red)
      if (g > r * 1.5) return base + 6;  // cyan (blue + green)
      return base + 4;                     // blue
    }
  }

  // Write to terminal with synchronization to prevent tearing
  private async _writeToTerminal(data: string): Promise<void> {
    // Begin synchronized update (prevents flicker during rendering)
    const syncStart = '\x1b[?2026h'; // Begin synchronized update mode
    const syncEnd = '\x1b[?2026l';   // End synchronized update mode

    const output = syncStart + data + syncEnd;

    if ((globalThis as any).process?.stdout?.write) {
      // Use synchronous write for immediate output
      (globalThis as any).process.stdout.write(output);
    } else {
      // Fallback for environments without process.stdout
      console.log(output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '[ESC]'));
    }
  }
}