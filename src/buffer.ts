// Dual-buffer system for efficient terminal rendering

import { Bounds } from './types.ts';
import { getCharWidth, getStringWidth, analyzeString, type CharInfo } from './char-width.ts';
import { getThemeManager, colorToGray } from './theme.ts';
import type { TerminalColor } from './types.ts';

export interface Cell {
  char: string;
  foreground?: string;
  background?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
  reverse?: boolean; // Swap foreground and background colors
  // Wide character support
  width?: number; // Character display width (1 or 2)
  isWideCharContinuation?: boolean; // True if this cell is the second part of a wide character
}

export interface BufferDiff {
  x: number;
  y: number;
  cell: Cell;
}


export class TerminalBuffer {
  private _width: number;
  private _height: number;
  private _cells: Cell[][];
  private _defaultCell: Cell;
  // Track which cells are occupied by wide characters
  private _wideCharMap: boolean[][]; // true if cell is occupied by a wide char

  constructor(width: number, height: number, defaultCell: Cell = { char: ' ' }) {
    this._width = width;
    this._height = height;
    this._defaultCell = defaultCell;
    this._cells = this._createEmptyBuffer();
    this._wideCharMap = this._createWideCharMap();
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  get cells(): Cell[][] {
    return this._cells;
  }

  // Create empty buffer filled with default cells
  private _createEmptyBuffer(): Cell[][] {
    const buffer: Cell[][] = [];
    for (let y = 0; y < this._height; y++) {
      buffer[y] = [];
      for (let x = 0; x < this._width; x++) {
        buffer[y][x] = { ...this._defaultCell };
      }
    }
    return buffer;
  }

  // Create wide character tracking map
  private _createWideCharMap(): boolean[][] {
    const map: boolean[][] = [];
    for (let y = 0; y < this._height; y++) {
      map[y] = new Array(this._width).fill(false);
    }
    return map;
  }

  // Clear the entire buffer
  clear(): void {
    this._cells = this._createEmptyBuffer();
    this._wideCharMap = this._createWideCharMap();
  }

  // Resize buffer (preserving content where possible)
  resize(newWidth: number, newHeight: number): void {
    const oldCells = this._cells;
    const oldWideCharMap = this._wideCharMap;
    this._width = newWidth;
    this._height = newHeight;
    this._cells = this._createEmptyBuffer();
    this._wideCharMap = this._createWideCharMap();

    // Copy old content where it fits
    const copyHeight = Math.min(oldCells.length, newHeight);
    for (let y = 0; y < copyHeight; y++) {
      const copyWidth = Math.min(oldCells[y]?.length || 0, newWidth);
      for (let x = 0; x < copyWidth; x++) {
        // Only copy if it's not a broken wide character
        const cell = oldCells[y][x];
        const isWideChar = oldWideCharMap[y]?.[x] || false;

        if (!isWideChar || (cell.width === 2 && x + 1 < copyWidth)) {
          this._cells[y][x] = cell;
          if (isWideChar) {
            this._wideCharMap[y][x] = true;
            if (x + 1 < newWidth) {
              this._wideCharMap[y][x + 1] = true;
            }
          }
        }
      }
    }
  }

  // Set a single cell with wide character support
  setCell(x: number, y: number, cell: Cell): void {
    if (x < 0 || x >= this._width || y < 0 || y >= this._height) {
      return;
    }

    // Apply gray theme conversion if needed
    const theme = getThemeManager().getCurrentTheme();
    if (theme.type === 'gray') {
      const isDark = theme.mode === 'dark';
      if (cell.foreground) {
        cell.foreground = colorToGray(cell.foreground as TerminalColor, isDark);
      }
      if (cell.background) {
        cell.background = colorToGray(cell.background as TerminalColor, isDark);
      }
    }

    // Clear any existing wide character that might be affected
    this._clearWideCharAt(x, y);

    const charWidth = cell.width ?? getCharWidth(cell.char);
    cell.width = charWidth;

    if (charWidth === 2) {
      // Wide character - needs two cells
      if (x + 1 >= this._width) {
        // Not enough space for wide character, skip
        return;
      }

      // Clear any existing wide char at the next position
      this._clearWideCharAt(x + 1, y);

      // Set the main cell
      this._cells[y][x] = { ...cell };
      this._wideCharMap[y][x] = true;

      // Set the continuation cell
      this._cells[y][x + 1] = {
        ...cell, // Copy style
        char: '',
        isWideCharContinuation: true,
        width: 0,
      };
      this._wideCharMap[y][x + 1] = true;
    } else if (charWidth === 1) {
      // Normal character
      this._cells[y][x] = { ...cell };
      this._wideCharMap[y][x] = false;
    }
    // Skip zero-width and control characters
  }

  // Clear wide character at position if it exists
  private _clearWideCharAt(x: number, y: number): void {
    // Check for NaN coordinates first
    if (isNaN(x) || isNaN(y)) {
      throw new Error(`Invalid coordinates: (${x}, ${y}) - coordinates cannot be NaN`);
    }

    if (x < 0 || x >= this._width || y < 0 || y >= this._height) {
      return;
    }

    if (this._wideCharMap[y][x]) {
      const cell = this._cells[y][x];

      if (cell.isWideCharContinuation) {
        // This is the second part of a wide char, clear the first part too
        if (x > 0 && this._wideCharMap[y][x - 1]) {
          this._cells[y][x - 1] = { ...this._defaultCell };
          this._wideCharMap[y][x - 1] = false;
        }
      } else if (cell.width === 2) {
        // This is the first part of a wide char, clear the second part too
        if (x + 1 < this._width && this._wideCharMap[y][x + 1]) {
          this._cells[y][x + 1] = { ...this._defaultCell };
          this._wideCharMap[y][x + 1] = false;
        }
      }

      // Clear this cell
      this._cells[y][x] = { ...this._defaultCell };
      this._wideCharMap[y][x] = false;
    }
  }

  // Get a single cell
  getCell(x: number, y: number): Cell | undefined {
    if (x >= 0 && x < this._width && y >= 0 && y < this._height) {
      return { ...this._cells[y][x] };
    }
    return undefined;
  }

  // Set text at position with optional styling and wide character support
  setText(x: number, y: number, text: string, style: Partial<Cell> = {}): void {
    const chars = analyzeString(text);
    let visualX = x;

    for (const charInfo of chars) {
      if (visualX >= this._width) break;

      if (charInfo.width > 0) {
        // Skip if wide character won't fit
        if (charInfo.width === 2 && visualX + 1 >= this._width) {
          break;
        }

        this.setCell(visualX, y, {
          char: charInfo.char,
          width: charInfo.width,
          ...style,
        });

        visualX += charInfo.width;
      }
      // Zero-width characters are handled by setCell (skipped)
    }
  }

  // Get the visual width that text would occupy
  getTextWidth(text: string): number {
    return getStringWidth(text);
  }

  // Fill rectangle with character/style
  fillRect(x: number, y: number, width: number, height: number, cell: Cell): void {
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        this.setCell(x + dx, y + dy, cell);
      }
    }
  }

  // Draw border around rectangle
  drawBorder(
    x: number,
    y: number,
    width: number,
    height: number,
    style: Partial<Cell> = {},
    borderStyle: 'thin' | 'thick' | 'double' = 'thin'
  ): void {
    let chars: Record<string, string>;

    switch (borderStyle) {
      case 'thick':
        chars = { h: '━', v: '┃', tl: '┏', tr: '┓', bl: '┗', br: '┛' };
        break;
      case 'double':
        chars = { h: '═', v: '║', tl: '╔', tr: '╗', bl: '╚', br: '╝' };
        break;
      default: // thin
        chars = { h: '─', v: '│', tl: '┌', tr: '┐', bl: '└', br: '┘' };
    }

    // Top and bottom borders
    for (let i = 1; i < width - 1; i++) {
      this.setCell(x + i, y, { char: chars.h, ...style });
      this.setCell(x + i, y + height - 1, { char: chars.h, ...style });
    }

    // Left and right borders
    for (let i = 1; i < height - 1; i++) {
      this.setCell(x, y + i, { char: chars.v, ...style });
      this.setCell(x + width - 1, y + i, { char: chars.v, ...style });
    }

    // Corners
    this.setCell(x, y, { char: chars.tl, ...style });
    this.setCell(x + width - 1, y, { char: chars.tr, ...style });
    this.setCell(x, y + height - 1, { char: chars.bl, ...style });
    this.setCell(x + width - 1, y + height - 1, { char: chars.br, ...style });
  }

  // Compare with another buffer and return differences
  diff(otherBuffer: TerminalBuffer): BufferDiff[] {
    const differences: BufferDiff[] = [];

    const maxHeight = Math.max(this._height, otherBuffer._height);
    const maxWidth = Math.max(this._width, otherBuffer._width);

    for (let y = 0; y < maxHeight; y++) {
      for (let x = 0; x < maxWidth; x++) {
        const thisCell = this.getCell(x, y) || this._defaultCell;
        const otherCell = otherBuffer.getCell(x, y) || otherBuffer._defaultCell;

        if (!this._cellsEqual(thisCell, otherCell)) {
          differences.push({
            x,
            y,
            cell: { ...thisCell },
          });
        }
      }
    }

    return differences;
  }

  // Copy content from another buffer
  copyFrom(sourceBuffer: TerminalBuffer): void {
    this.resize(sourceBuffer._width, sourceBuffer._height);

    // Copy cells and wide char map
    for (let y = 0; y < this._height; y++) {
      for (let x = 0; x < this._width; x++) {
        this._cells[y][x] = { ...sourceBuffer._cells[y][x] };
        this._wideCharMap[y][x] = sourceBuffer._wideCharMap[y][x];
      }
    }
  }

  // Create a copy of this buffer
  clone(): TerminalBuffer {
    const cloned = new TerminalBuffer(this._width, this._height, this._defaultCell);
    cloned.copyFrom(this);
    return cloned;
  }

  // Convert buffer to string representation (useful for debugging)
  toString(): string {
    let result = '';
    for (let y = 0; y < this._height; y++) {
      for (let x = 0; x < this._width; x++) {
        const cell = this._cells[y][x];
        if (cell.isWideCharContinuation) {
          // Skip continuation cells in string output
          continue;
        }
        result += cell.char;
      }
      if (y < this._height - 1) {
        result += '\n';
      }
    }
    return result;
  }

  // Check if a position can accept a character of given width
  canPlaceCharAt(x: number, y: number, width: number): boolean {
    if (x < 0 || y < 0 || y >= this._height) {
      return false;
    }

    if (width === 1) {
      return x < this._width && !this._wideCharMap[y][x];
    } else if (width === 2) {
      return x + 1 < this._width &&
             !this._wideCharMap[y][x] &&
             !this._wideCharMap[y][x + 1];
    }

    return false;
  }

  // Helper method to compare cells for equality
  private _cellsEqual(a: Cell, b: Cell): boolean {
    return (
      a.char === b.char &&
      a.foreground === b.foreground &&
      a.background === b.background &&
      a.bold === b.bold &&
      a.italic === b.italic &&
      a.underline === b.underline &&
      a.dim === b.dim &&
      a.reverse === b.reverse &&
      a.width === b.width &&
      a.isWideCharContinuation === b.isWideCharContinuation
    );
  }
}


export interface RenderOptions {
  cursorVisible?: boolean;
  cursorX?: number;
  cursorY?: number;
  title?: string;
}

export interface BufferStats {
  totalCells: number;
  changedCells: number;
  nonEmptyCells: number;
  renderOperations: number;
  lastRenderTime: number;
  averageRenderTime: number;
  bufferUtilization: number; // percentage of non-empty cells
  renderFrequency: number; // renders per second
  frameCount: number;
  memoryUsage: number; // estimated bytes
}

export class DualBuffer {
  private _currentBuffer: TerminalBuffer;
  private _previousBuffer: TerminalBuffer;
  private _width: number;
  private _height: number;
  private _renderOptions: RenderOptions;

  // Statistics tracking
  private _stats?: BufferStats;
  private _renderTimes: number[] = [];
  private _lastFrameTime: number = 0;
  private _startTime: number = Date.now();

  constructor(width: number, height: number, defaultCell: Cell = { char: ' ' }) {
    this._width = width;
    this._height = height;
    this._currentBuffer = new TerminalBuffer(width, height, defaultCell);
    this._previousBuffer = new TerminalBuffer(width, height, defaultCell);
    this._renderOptions = {
      cursorVisible: false,
      cursorX: 0,
      cursorY: 0,
    };

    // Initialize statistics immediately for overlay support
    this._stats = {
      totalCells: width * height,
      changedCells: 0,
      nonEmptyCells: 0,
      renderOperations: 0,
      lastRenderTime: 0,
      averageRenderTime: 0,
      bufferUtilization: 0,
      renderFrequency: 0,
      frameCount: 0,
      memoryUsage: this._estimateMemoryUsage()
    };
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  get currentBuffer(): TerminalBuffer {
    return this._currentBuffer;
  }

  get previousBuffer(): TerminalBuffer {
    return this._previousBuffer;
  }

  get renderOptions(): RenderOptions {
    return { ...this._renderOptions };
  }

  get stats(): BufferStats | null {
    // Return null if stats not properly initialized yet
    if (!this._stats) {
      return null;
    }
    return { ...this._stats };
  }

  // Update render options
  setRenderOptions(options: Partial<RenderOptions>): void {
    this._renderOptions = { ...this._renderOptions, ...options };
  }

  // Resize both buffers
  resize(newWidth: number, newHeight: number): void {
    this._width = newWidth;
    this._height = newHeight;
    this._currentBuffer.resize(newWidth, newHeight);
    this._previousBuffer.resize(newWidth, newHeight);

    // Update stats with new size
    if (this._stats) {
      this._stats.totalCells = newWidth * newHeight;
      this._stats.memoryUsage = this._estimateMemoryUsage();
    }
  }

  // Clear the current buffer
  clear(): void {
    this._currentBuffer.clear();
  }

  // Update statistics without swapping buffers (useful for real-time stats)
  updateStatsOnly(): void {
    const startTime = performance.now();
    const differences = this._currentBuffer.diff(this._previousBuffer);
    this._updateStats(differences, startTime);
  }

  // Swap buffers and return differences for rendering
  swapAndGetDiff(): BufferDiff[] {
    const startTime = performance.now();
    const differences = this._currentBuffer.diff(this._previousBuffer);

    // Update statistics
    this._updateStats(differences, startTime);

    // Swap buffers
    const temp = this._previousBuffer;
    this._previousBuffer = this._currentBuffer;
    this._currentBuffer = temp;

    // Clear the new current buffer for next frame
    this._currentBuffer.clear();

    return differences;
  }

  // Force complete redraw (useful for initialization or after screen clear)
  forceRedraw(): BufferDiff[] {
    const differences: BufferDiff[] = [];

    for (let y = 0; y < this._height; y++) {
      for (let x = 0; x < this._width; x++) {
        const cell = this._currentBuffer.getCell(x, y);
        if (cell) {
          differences.push({ x, y, cell });
        }
      }
    }

    // Update previous buffer to match current
    this._previousBuffer.copyFrom(this._currentBuffer);

    return differences;
  }

  // Update statistics based on rendering operation
  private _updateStats(differences: BufferDiff[], startTime: number): void {
    // Initialize stats if not already done
    if (!this._stats) {
      this._stats = {
        totalCells: this._width * this._height,
        changedCells: 0,
        nonEmptyCells: 0,
        renderOperations: 0,
        lastRenderTime: 0,
        averageRenderTime: 0,
        bufferUtilization: 0,
        renderFrequency: 0,
        frameCount: 0,
        memoryUsage: this._estimateMemoryUsage()
      };
      this._renderTimes = [];
      this._startTime = Date.now();
    }

    const endTime = performance.now();
    const renderTime = endTime - startTime;
    const currentTime = Date.now();

    // Update render timing
    this._stats.lastRenderTime = renderTime;
    this._renderTimes.push(renderTime);

    // Keep only last 60 render times for rolling average
    if (this._renderTimes.length > 60) {
      this._renderTimes.shift();
    }

    this._stats.averageRenderTime = this._renderTimes.reduce((a, b) => a + b, 0) / this._renderTimes.length;

    // Update frame count and frequency
    this._stats.frameCount++;
    this._stats.renderOperations++;

    const elapsedSeconds = (currentTime - this._startTime) / 1000;
    this._stats.renderFrequency = this._stats.frameCount / Math.max(elapsedSeconds, 1);

    // Update cell statistics
    this._stats.changedCells = differences.length;
    this._stats.nonEmptyCells = this._countNonEmptyCells();
    this._stats.bufferUtilization = (this._stats.nonEmptyCells / this._stats.totalCells) * 100;
    this._stats.memoryUsage = this._estimateMemoryUsage();

    this._lastFrameTime = currentTime;
  }

  // Count non-empty cells in current buffer
  private _countNonEmptyCells(): number {
    let count = 0;
    for (let y = 0; y < this._height; y++) {
      for (let x = 0; x < this._width; x++) {
        const cell = this._currentBuffer.getCell(x, y);
        if (cell && cell.char !== ' ') {
          count++;
        }
      }
    }
    return count;
  }

  // Estimate memory usage of buffers
  private _estimateMemoryUsage(): number {
    // Rough estimate: each cell contains char (2-4 bytes) + style properties
    // Plus overhead for array structures
    const cellSize = 50; // estimated bytes per cell including overhead
    const totalCells = this._width * this._height;
    const buffersSize = totalCells * cellSize * 2; // current + previous
    const statsSize = 200; // size of stats objects and arrays
    return buffersSize + statsSize;
  }

  // Reset statistics (useful for testing or debugging)
  resetStats(): void {
    this._stats = {
      totalCells: this._width * this._height,
      changedCells: 0,
      nonEmptyCells: 0,
      renderOperations: 0,
      lastRenderTime: 0,
      averageRenderTime: 0,
      bufferUtilization: 0,
      renderFrequency: 0,
      frameCount: 0,
      memoryUsage: this._estimateMemoryUsage()
    };
    this._renderTimes = [];
    this._startTime = Date.now();
  }

  // Legacy getStats method for compatibility
  getStats(): {
    totalCells: number;
    nonEmptyCells: number;
    bufferUtilization: number;
    wideCharCells: number;
  } {
    let nonEmptyCells = 0;
    let wideCharCells = 0;
    const totalCells = this._width * this._height;

    for (let y = 0; y < this._height; y++) {
      for (let x = 0; x < this._width; x++) {
        const cell = this._currentBuffer.getCell(x, y);
        if (cell && cell.char !== ' ' && !cell.isWideCharContinuation) {
          nonEmptyCells++;
          if (cell.width === 2) {
            wideCharCells++;
          }
        }
      }
    }

    return {
      totalCells,
      nonEmptyCells,
      bufferUtilization: totalCells > 0 ? nonEmptyCells / totalCells : 0,
      wideCharCells,
    };
  }

  // Get the buffer that contains the currently displayed content
  // After swapAndGetDiff(), this is the previousBuffer
  getDisplayBuffer(): TerminalBuffer {
    return this._previousBuffer;
  }
}