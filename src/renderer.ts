// Terminal renderer using ANSI escape codes with dual-buffer optimization

import { DualBuffer, BufferDiff, Cell, RenderOptions } from './buffer.ts';
import { ANSI, rgbTo256Color, rgbTo16Color } from './ansi-output.ts';

// Reusable TextEncoder to avoid per-write allocations
const textEncoder = new TextEncoder();

// Gray level mapping for contrast calculation (avoids object allocation per call)
const GRAY_LEVELS: Record<number, number> = {
  30: 0,   // black
  90: 1,   // gray (bright black)
  37: 2,   // white (light gray)
  97: 3,   // bright white
};

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
    commands.push(ANSI.saveCursor);

    // Switch to alternate screen if enabled
    if (this._options.alternateScreen) {
      commands.push(ANSI.alternateScreen);
    }

    // Hide cursor initially
    commands.push(ANSI.hideCursor);

    // Enable keypad if requested
    if (this._options.enableKeypad) {
      commands.push(ANSI.appCursorOn);
      commands.push(ANSI.appKeypadOn);
    }

    // Enable mouse if requested
    if (this._options.enableMouse) {
      commands.push(ANSI.mouseBasicOn);
      commands.push(ANSI.mouseButtonOn);
      commands.push(ANSI.mouseUrxvtOn);
      commands.push(ANSI.mouseSgrOn);
    }

    // Clear screen
    commands.push(ANSI.clearScreen);
    commands.push(ANSI.cursorHome);

    // Write all commands
    this._writeToTerminal(commands.join(''));

    this._isInitialized = true;
  }

  // Cleanup terminal state
  async cleanup(): Promise<void> {
    if (!this._isInitialized) return;

    const commands: string[] = [];

    // Show cursor
    commands.push(ANSI.showCursor);

    // Disable mouse if it was enabled
    if (this._options.enableMouse) {
      commands.push(ANSI.mouseSgrOff);
      commands.push(ANSI.mouseUrxvtOff);
      commands.push(ANSI.mouseButtonOff);
      commands.push(ANSI.mouseBasicOff);
    }

    // Disable keypad if it was enabled
    if (this._options.enableKeypad) {
      commands.push(ANSI.appKeypadOff);
      commands.push(ANSI.appCursorOff);
    }

    // Restore screen if alternate was used
    if (this._options.alternateScreen) {
      commands.push(ANSI.normalScreen);
    }

    // Restore cursor
    commands.push(ANSI.restoreCursor);
    commands.push('\x1b8'); // Restore cursor (DEC)

    // Reset all attributes
    commands.push(ANSI.reset);

    this._writeToTerminal(commands.join(''));

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
    this._writeToTerminal(ANSI.clearScreen + ANSI.cursorHome);

    const differences = dualBuffer.forceRedraw();
    const renderOptions = dualBuffer.renderOptions;

    await this._renderDifferences(differences, renderOptions);
  }

  // Clear the terminal screen
  async clearScreen(): Promise<void> {
    this._writeToTerminal(ANSI.clearScreen + ANSI.cursorHome);
  }

  // Set terminal title
  async setTitle(title: string): Promise<void> {
    this._writeToTerminal(`\x1b]0;${title}\x1b\\`);
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
      foreground: 0 as number | undefined,
      background: 0 as number | undefined,
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
          foreground: cellDiff.cell.foreground,
          background: cellDiff.cell.background,
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
      output.push(options.cursorVisible ? ANSI.showCursor : ANSI.hideCursor);
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

    // Single optimized write operation with sync to prevent tearing
    if (output.length > 0) {
      this._writeToTerminalSynced(output.join(''));
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
      codes.push(ANSI.reset);
    }

    // Apply foreground and background colors
    // For 16-color mode, ensure fg and bg have enough contrast for visibility
    if (this._options.colorSupport === '16' && newStyle.foreground && newStyle.background) {
      const fgCode = this._getColorCode16(newStyle.foreground);
      const originalBgCode = this._getColorCode16(newStyle.background);
      const bgCode = this._ensureContrast(fgCode, originalBgCode);

      if (newStyle.foreground !== oldStyle.foreground) {
        codes.push(`\x1b[${fgCode}m`);
      }
      if (newStyle.background !== oldStyle.background || bgCode !== originalBgCode) {
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
    if (newStyle.bold && !oldStyle.bold) codes.push(ANSI.bold);
    if (newStyle.dim && !oldStyle.dim) codes.push(ANSI.dim);
    if (newStyle.italic && !oldStyle.italic) codes.push(ANSI.italic);
    if (newStyle.underline && !oldStyle.underline) codes.push(ANSI.underline);
    if (newStyle.reverse && !oldStyle.reverse) codes.push(ANSI.reverse);

    return codes.join('');
  }

  // Generate ANSI style codes for a cell (legacy method, kept for compatibility)
  private _getCellStyleCode(cell: Cell): string {
    const codes: string[] = [ANSI.reset];

    // Foreground color
    if (cell.foreground) {
      codes.push(this._getColorCode(cell.foreground, false));
    }

    // Background color
    if (cell.background) {
      codes.push(this._getColorCode(cell.background, true));
    }

    // Text attributes
    if (cell.bold) codes.push(ANSI.bold);
    if (cell.dim) codes.push(ANSI.dim);
    if (cell.italic) codes.push(ANSI.italic);
    if (cell.underline) codes.push(ANSI.underline);

    return codes.join('');
  }

  // Convert packed RGBA color to ANSI escape code
  // Color is packed as 0xRRGGBBAA
  private _getColorCode(color: number, isBackground: boolean): string {
    const offset = isBackground ? 10 : 0;

    // Extract RGB from packed color (ignore alpha)
    const r = (color >> 24) & 0xFF;
    const g = (color >> 16) & 0xFF;
    const b = (color >> 8) & 0xFF;

    if (this._options.colorSupport === 'truecolor') {
      const code = isBackground ? 48 : 38;
      return `\x1b[${code};2;${r};${g};${b}m`;
    } else if (this._options.colorSupport === '256') {
      const color256 = rgbTo256Color(r, g, b);
      const code = isBackground ? 48 : 38;
      return `\x1b[${code};5;${color256}m`;
    } else if (this._options.colorSupport === '16') {
      const color16 = rgbTo16Color(r, g, b);
      return `\x1b[${color16 + offset}m`;
    }

    // Fallback to default
    return '';
  }

  // Get 16-color code for a packed RGBA color (returns foreground code 30-37 or 90-97)
  private _getColorCode16(color: number): number {
    // Extract RGB from packed color
    const r = (color >> 24) & 0xFF;
    const g = (color >> 16) & 0xFF;
    const b = (color >> 8) & 0xFF;

    return rgbTo16Color(r, g, b);
  }

  // Ensure fg and bg have enough contrast for visibility
  // Returns adjusted bgCode if needed
  private _ensureContrast(fgCode: number, bgCode: number): number {
    const fgLevel = GRAY_LEVELS[fgCode];
    const bgLevel = GRAY_LEVELS[bgCode];

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

  // Write to terminal
  private _writeToTerminal(data: string): void {
    Deno.stdout.writeSync(textEncoder.encode(data));
  }

  // Write to terminal with synchronization to prevent tearing (for rendering)
  private _writeToTerminalSynced(data: string): void {
    Deno.stdout.writeSync(textEncoder.encode(ANSI.beginSync + data + ANSI.endSync));
  }
}