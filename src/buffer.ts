// Dual-buffer system for efficient terminal rendering

import { BORDER_CHARS, getBorderChars, type PackedRGBA, type BorderStyle } from './types.ts';
import { getCharWidth, getStringWidth, analyzeString } from './char-width.ts';
import { getThemeManager, colorToGray, colorToLowContrast } from './theme.ts';
import { getLogger } from './logging.ts';
import { getGlobalPerformanceDialog } from './performance-dialog.ts';

/**
 * Character used for filling/clearing cells.
 * Change to '.' or '·' for debugging to visualize fill areas.
 */
export const EMPTY_CHAR = ' ';

export interface Cell {
  char: string;
  foreground?: PackedRGBA;
  background?: PackedRGBA;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
  reverse?: boolean; // Swap foreground and background colors
  link?: string; // OSC 8 hyperlink URL
  // Wide character support
  width?: number; // Character display width (1 or 2)
  isWideCharContinuation?: boolean; // True if this cell is the second part of a wide character
}

export interface BufferDiff {
  x: number;
  y: number;
  cell: Cell;
}

/**
 * Lightweight collector that mimics TerminalBuffer's write API (setCell, setText, fillRect)
 * but collects BufferDiff[] instead of writing to a 2D array.
 * Used by the fast render path to avoid O(w×h) buffer copy.
 */
export class DiffCollector {
  private _diffs: BufferDiff[] = [];
  private _isGrayTheme: boolean;
  private _isGrayDark: boolean;

  constructor() {
    const theme = getThemeManager().getCurrentTheme();
    this._isGrayTheme = theme.type === 'gray';
    this._isGrayDark = theme.mode === 'dark';
  }

  getDiffs(): BufferDiff[] {
    return this._diffs;
  }

  setCell(x: number, y: number, cell: Cell): void {
    if (this._isGrayTheme) {
      if (cell.foreground) cell.foreground = colorToGray(cell.foreground, this._isGrayDark);
      if (cell.background) cell.background = colorToGray(cell.background, this._isGrayDark);
    }

    let charWidth: number;
    if (cell.width !== undefined) {
      charWidth = cell.width;
    } else {
      const char = cell.char;
      if (char.length === 1) {
        const code = char.charCodeAt(0);
        charWidth = (code >= 32 && code <= 126) ? 1 : getCharWidth(char);
      } else {
        charWidth = getCharWidth(char);
      }
      cell.width = charWidth;
    }

    if (charWidth === 2) {
      this._diffs.push({ x, y, cell: { ...cell } });
      this._diffs.push({ x: x + 1, y, cell: { ...cell, char: '', isWideCharContinuation: true, width: 0 } });
    } else if (charWidth === 1) {
      this._diffs.push({ x, y, cell: { ...cell } });
    }
  }

  setText(x: number, y: number, text: string, style: Partial<Cell> = {}): void {
    const chars = analyzeString(text);
    let visualX = x;
    // Template cell — DiffCollector.setCell clones before storing, so reuse is safe
    const cell = { char: '', width: 1 as number | undefined, ...style } as Cell;
    for (const charInfo of chars) {
      if (charInfo.width > 0) {
        cell.char = charInfo.char;
        cell.width = charInfo.width;
        this.setCell(visualX, y, cell);
        visualX += charInfo.width;
      }
    }
  }

  fillRect(x: number, y: number, width: number, height: number, cell: Cell): void {
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        this.setCell(x + dx, y + dy, cell);
      }
    }
  }
}


export class TerminalBuffer {
  private _width: number;
  private _height: number;
  private _cells: Cell[][];
  private _defaultCell: Cell;
  // Track which cells are occupied by wide characters
  private _wideCharMap: boolean[][]; // true if cell is occupied by a wide char
  // Dirty row tracking (injected by DualBuffer)
  private _dirtyRows?: Set<number>;
  private _referenceBuffer?: TerminalBuffer;
  // Cached theme state for hot path optimization
  private _isGrayTheme: boolean = false;
  private _isGrayDark: boolean = false;

  constructor(width: number, height: number, defaultCell: Cell = { char: EMPTY_CHAR }) {
    this._width = width;
    this._height = height;
    this._defaultCell = defaultCell;
    this._cells = this._createEmptyBuffer();
    this._wideCharMap = this._createWideCharMap();
    this._updateThemeCache();
  }

  // Update cached theme state (call when theme changes)
  updateThemeCache(): void {
    this._updateThemeCache();
  }

  private _updateThemeCache(): void {
    const theme = getThemeManager().getCurrentTheme();
    this._isGrayTheme = theme.type === 'gray';
    this._isGrayDark = theme.mode === 'dark';
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

  // Clear the entire buffer (reuses existing objects to avoid GC pressure)
  clear(): void {
    const dc = this._defaultCell;
    for (let y = 0; y < this._height; y++) {
      const row = this._cells[y];
      const wideRow = this._wideCharMap[y];
      for (let x = 0; x < this._width; x++) {
        const cell = row[x];
        cell.char = dc.char;
        cell.foreground = dc.foreground;
        cell.background = dc.background;
        cell.bold = dc.bold;
        cell.italic = dc.italic;
        cell.underline = dc.underline;
        cell.dim = dc.dim;
        cell.reverse = dc.reverse;
        cell.width = dc.width;
        cell.isWideCharContinuation = dc.isWideCharContinuation;
        wideRow[x] = false;
      }
    }
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

  // Enable dirty row tracking (called by DualBuffer)
  setDirtyTracking(referenceBuffer: TerminalBuffer, dirtyRows: Set<number>): void {
    this._referenceBuffer = referenceBuffer;
    this._dirtyRows = dirtyRows;
  }

  // Disable dirty row tracking
  clearDirtyTracking(): void {
    this._referenceBuffer = undefined;
    this._dirtyRows = undefined;
  }

  // Set a single cell with wide character support
  setCell(x: number, y: number, cell: Cell): void {
    x = x | 0;
    y = y | 0;
    if (x < 0 || x >= this._width || y < 0 || y >= this._height) {
      return;
    }

    // Apply gray theme conversion if needed (uses cached theme state)
    if (this._isGrayTheme) {
      if (cell.foreground) {
        cell.foreground = colorToGray(cell.foreground, this._isGrayDark);
      }
      if (cell.background) {
        cell.background = colorToGray(cell.background, this._isGrayDark);
      }
    }

    // Fast path: determine character width
    // For ASCII printable chars (32-126), width is always 1
    let charWidth: number;
    if (cell.width !== undefined) {
      charWidth = cell.width;
    } else {
      const char = cell.char;
      if (char.length === 1) {
        const code = char.charCodeAt(0);
        // ASCII printable range: space (32) to tilde (126)
        charWidth = (code >= 32 && code <= 126) ? 1 : getCharWidth(char);
      } else {
        charWidth = getCharWidth(char);
      }
      cell.width = charWidth;
    }

    // Only clear existing wide char if the target cell is part of a wide char
    // This skips the function call overhead in the common case
    if (this._wideCharMap[y][x]) {
      this._clearWideCharAt(x, y);
    }

    if (charWidth === 2) {
      // Wide character - needs two cells
      if (x + 1 >= this._width) {
        // Not enough space for wide character, skip
        return;
      }

      // Clear any existing wide char at the next position
      if (this._wideCharMap[y][x + 1]) {
        this._clearWideCharAt(x + 1, y);
      }

      // Set the main cell (in-place to avoid object allocation)
      const main = this._cells[y][x];
      main.char = cell.char;
      main.foreground = cell.foreground;
      main.background = cell.background;
      main.bold = cell.bold;
      main.italic = cell.italic;
      main.underline = cell.underline;
      main.dim = cell.dim;
      main.reverse = cell.reverse;
      main.link = cell.link;
      main.width = cell.width;
      main.isWideCharContinuation = cell.isWideCharContinuation;
      this._wideCharMap[y][x] = true;

      // Set the continuation cell (in-place)
      const cont = this._cells[y][x + 1];
      cont.char = '';
      cont.foreground = cell.foreground;
      cont.background = cell.background;
      cont.bold = cell.bold;
      cont.italic = cell.italic;
      cont.underline = cell.underline;
      cont.dim = cell.dim;
      cont.reverse = cell.reverse;
      cont.link = cell.link;
      cont.width = 0;
      cont.isWideCharContinuation = true;
      this._wideCharMap[y][x + 1] = true;
    } else if (charWidth === 1) {
      // Normal character (in-place to avoid object allocation)
      const target = this._cells[y][x];
      target.char = cell.char;
      target.foreground = cell.foreground;
      target.background = cell.background;
      target.bold = cell.bold;
      target.italic = cell.italic;
      target.underline = cell.underline;
      target.dim = cell.dim;
      target.reverse = cell.reverse;
      target.link = cell.link;
      target.width = cell.width;
      target.isWideCharContinuation = cell.isWideCharContinuation;
      this._wideCharMap[y][x] = false;
    }
    // Zero-width characters are ignored

    // Track dirty row if tracking enabled
    if (this._dirtyRows && this._referenceBuffer) {
      const written = this._cells[y][x];
      const reference = this._referenceBuffer._cells[y]?.[x];
      if (!reference || !this._cellsEqualDirect(written, reference)) {
        this._dirtyRows.add(y);
      }
    }
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
      const dc = this._defaultCell;

      if (cell.isWideCharContinuation) {
        // This is the second part of a wide char, clear the first part too
        if (x > 0 && this._wideCharMap[y][x - 1]) {
          this._resetCell(this._cells[y][x - 1], dc);
          this._wideCharMap[y][x - 1] = false;
        }
      } else if (cell.width === 2) {
        // This is the first part of a wide char, clear the second part too
        if (x + 1 < this._width && this._wideCharMap[y][x + 1]) {
          this._resetCell(this._cells[y][x + 1], dc);
          this._wideCharMap[y][x + 1] = false;
        }
      }

      // Clear this cell
      this._resetCell(this._cells[y][x], dc);
      this._wideCharMap[y][x] = false;
    }
  }

  // Reset a cell to default values in-place (avoids object allocation)
  private _resetCell(target: Cell, dc: Cell): void {
    target.char = dc.char;
    target.foreground = dc.foreground;
    target.background = dc.background;
    target.bold = dc.bold;
    target.italic = dc.italic;
    target.underline = dc.underline;
    target.dim = dc.dim;
    target.reverse = dc.reverse;
    target.width = dc.width;
    target.isWideCharContinuation = dc.isWideCharContinuation;
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
    // Create template cell once — setCell copies fields in-place, never stores reference
    const cell = { char: '', width: 1 as number | undefined, ...style } as Cell;

    for (const charInfo of chars) {
      if (visualX >= this._width) break;

      if (charInfo.width > 0) {
        // Skip if wide character won't fit
        if (charInfo.width === 2 && visualX + 1 >= this._width) {
          break;
        }

        cell.char = charInfo.char;
        cell.width = charInfo.width;
        this.setCell(visualX, y, cell);

        visualX += charInfo.width;
      }
      // Zero-width characters are handled by setCell (skipped)
    }
  }

  // Fill a horizontal line with EMPTY_CHAR (for clearing/background fill)
  fillLine(x: number, y: number, width: number, style: Partial<Cell> = {}): void {
    const cell = { char: EMPTY_CHAR, ...style } as Cell;
    for (let i = 0; i < width && x + i < this._width; i++) {
      this.setCell(x + i, y, cell);
    }
  }

  // Fill rectangle with character/style
  fillRect(x: number, y: number, width: number, height: number, cell: Cell): void {
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        this.setCell(x + dx, y + dy, cell);
      }
    }
  }

  // Apply low-contrast monochrome effect to all cells (for modal backdrop effect)
  applyLowContrastEffect(isDark: boolean): void {
    for (let y = 0; y < this._height; y++) {
      for (let x = 0; x < this._width; x++) {
        const cell = this._cells[y][x];
        if (cell.foreground) {
          cell.foreground = colorToLowContrast(cell.foreground, isDark);
        }
        if (cell.background) {
          cell.background = colorToLowContrast(cell.background, isDark);
        }
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
    borderStyle: Exclude<BorderStyle, 'none'> = 'thin'
  ): void {
    const chars = getBorderChars(borderStyle);

    // For block style, use foreground as background (spaces need bg color to be visible)
    const cellStyle = borderStyle === 'block'
      ? { ...style, background: style.foreground || style.background, foreground: undefined }
      : style;

    // Top and bottom borders
    for (let i = 1; i < width - 1; i++) {
      this.setCell(x + i, y, { char: chars.h, ...cellStyle });
      this.setCell(x + i, y + height - 1, { char: chars.h, ...cellStyle });
    }

    // Left and right borders
    for (let i = 1; i < height - 1; i++) {
      this.setCell(x, y + i, { char: chars.v, ...cellStyle });
      this.setCell(x + width - 1, y + i, { char: chars.v, ...cellStyle });
    }

    // Corners
    this.setCell(x, y, { char: chars.tl, ...cellStyle });
    this.setCell(x + width - 1, y, { char: chars.tr, ...cellStyle });
    this.setCell(x, y + height - 1, { char: chars.bl, ...cellStyle });
    this.setCell(x + width - 1, y + height - 1, { char: chars.br, ...cellStyle });
  }

  // Direct cell comparison (no cloning needed when accessing cells directly)
  private _cellsEqualDirect(a: Cell, b: Cell): boolean {
    return (
      a.char === b.char &&
      a.foreground === b.foreground &&
      a.background === b.background &&
      a.bold === b.bold &&
      a.italic === b.italic &&
      a.underline === b.underline &&
      a.dim === b.dim &&
      a.reverse === b.reverse &&
      a.link === b.link &&
      a.width === b.width &&
      a.isWideCharContinuation === b.isWideCharContinuation
    );
  }

  // Compare this buffer against another and return cell-level differences
  diff(other: TerminalBuffer): BufferDiff[] {
    const diffs: BufferDiff[] = [];
    const minHeight = Math.min(this._height, other._height);
    const minWidth = Math.min(this._width, other._width);
    for (let y = 0; y < minHeight; y++) {
      for (let x = 0; x < minWidth; x++) {
        const a = this._cells[y][x];
        const b = other._cells[y][x];
        if (!this._cellsEqualDirect(a, b)) {
          diffs.push({ x, y, cell: { ...a } });
        }
      }
    }
    return diffs;
  }

  // Copy content from another buffer
  copyFrom(sourceBuffer: TerminalBuffer): void {
    this.resize(sourceBuffer._width, sourceBuffer._height);

    // Copy cells (in-place) and wide char map
    for (let y = 0; y < this._height; y++) {
      for (let x = 0; x < this._width; x++) {
        this._resetCell(this._cells[y][x], sourceBuffer._cells[y][x]);
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
      a.link === b.link &&
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
  // Dirty row tracking stats
  dirtyRows: number;
  totalRows: number;
  scannedCells: number;
}

export class DualBuffer {
  private _currentBuffer: TerminalBuffer;
  private _previousBuffer: TerminalBuffer;
  private _width: number;
  private _height: number;
  private _renderOptions: RenderOptions;

  // Dirty row tracking
  private _dirtyRows = new Set<number>();

  // Force next render to bypass dirty tracking (for dialog opens, etc.)
  private _forceNextRender = false;

  // Statistics tracking
  private _stats?: BufferStats;
  private _renderTimes: number[] = [];
  private _lastFrameTime: number = 0;
  private _startTime: number = Date.now();

  constructor(width: number, height: number, defaultCell: Cell = { char: EMPTY_CHAR }) {
    this._width = width;
    this._height = height;
    this._currentBuffer = new TerminalBuffer(width, height, defaultCell);
    this._previousBuffer = new TerminalBuffer(width, height, defaultCell);
    this._renderOptions = {
      cursorVisible: false,
      cursorX: 0,
      cursorY: 0,
    };

    // Enable dirty row tracking on current buffer
    this._currentBuffer.setDirtyTracking(this._previousBuffer, this._dirtyRows);

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
      memoryUsage: this._estimateMemoryUsage(),
      dirtyRows: 0,
      totalRows: height,
      scannedCells: 0,
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

  // Update theme cache on both buffers (call when theme changes or before render)
  updateThemeCache(): void {
    this._currentBuffer.updateThemeCache();
    this._previousBuffer.updateThemeCache();
  }

  // Update render options
  setRenderOptions(options: Partial<RenderOptions>): void {
    this._renderOptions = { ...this._renderOptions, ...options };
  }

  // Resize both buffers
  resize(newWidth: number, newHeight: number): void {
    // Disable tracking during resize
    this._currentBuffer.clearDirtyTracking();

    this._width = newWidth;
    this._height = newHeight;
    this._currentBuffer.resize(newWidth, newHeight);
    this._previousBuffer.resize(newWidth, newHeight);

    // Mark all rows dirty (size change = full redraw)
    this._dirtyRows.clear();
    for (let y = 0; y < this._height; y++) {
      this._dirtyRows.add(y);
    }

    // Re-enable tracking
    this._currentBuffer.setDirtyTracking(this._previousBuffer, this._dirtyRows);

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

  /**
   * Mark the next render to bypass dirty tracking and do a full diff.
   * Use this when opening dialogs or making changes that dirty tracking might miss.
   * The flag is automatically cleared after the next swapAndGetDiff() call.
   */
  markForceNextRender(): void {
    this._forceNextRender = true;
  }

  // Swap buffers and return differences for rendering
  swapAndGetDiff(): BufferDiff[] {
    const startTime = performance.now();

    // Check if force render was requested (e.g., dialog opened)
    const useFullDiff = this._forceNextRender;
    if (this._forceNextRender) {
      this._forceNextRender = false; // Reset flag
    }

    // Use full diff if force render requested, otherwise use dirty row optimization
    const differences = useFullDiff ? this._computeFullDiff() : this._computeDirtyDiff();

    // Update statistics
    this._updateStats(differences, startTime);

    // Disable tracking on old current buffer
    this._currentBuffer.clearDirtyTracking();

    // Swap buffers
    const temp = this._previousBuffer;
    this._previousBuffer = this._currentBuffer;
    this._currentBuffer = temp;

    // Clear the new current buffer for next frame
    this._currentBuffer.clear();

    // Enable tracking on new current buffer (pointing to new previous)
    this._currentBuffer.setDirtyTracking(this._previousBuffer, this._dirtyRows);

    // Reset dirty rows for next frame
    this._dirtyRows.clear();

    return differences;
  }

  // Compute and return diff without swapping buffers (for benchmarking/inspection)
  getDiffOnly(): BufferDiff[] {
    return this._computeFullDiff();
  }

  // Compute diff using only dirty rows (optimized path)
  // Cells are referenced directly (not cloned) — safe because the buffer holding
  // these cells (now _previousBuffer after swap) is not modified until the next frame.
  private _computeDirtyDiff(): BufferDiff[] {
    const differences: BufferDiff[] = [];
    const currentCells = this._currentBuffer.cells;
    const previousCells = this._previousBuffer.cells;

    for (const y of this._dirtyRows) {
      const currentRow = currentCells[y];
      const previousRow = previousCells[y];
      if (!currentRow || !previousRow) continue;

      for (let x = 0; x < this._width; x++) {
        const current = currentRow[x];
        const previous = previousRow[x];
        if (!this._cellsEqualDirect(current, previous)) {
          differences.push({ x, y, cell: current });
        }
      }
    }

    return differences;
  }

  // Compute diff for all rows (used when force render is requested)
  private _computeFullDiff(): BufferDiff[] {
    const differences: BufferDiff[] = [];
    const currentCells = this._currentBuffer.cells;
    const previousCells = this._previousBuffer.cells;

    for (let y = 0; y < this._height; y++) {
      const currentRow = currentCells[y];
      const previousRow = previousCells[y];
      if (!currentRow || !previousRow) continue;

      for (let x = 0; x < this._width; x++) {
        const current = currentRow[x];
        const previous = previousRow[x];
        if (!this._cellsEqualDirect(current, previous)) {
          differences.push({ x, y, cell: current });
        }
      }
    }

    return differences;
  }

  // Direct cell comparison (no cloning needed when accessing cells directly)
  private _cellsEqualDirect(a: Cell, b: Cell): boolean {
    return (
      a.char === b.char &&
      a.foreground === b.foreground &&
      a.background === b.background &&
      a.bold === b.bold &&
      a.italic === b.italic &&
      a.underline === b.underline &&
      a.dim === b.dim &&
      a.reverse === b.reverse &&
      a.link === b.link &&
      a.width === b.width &&
      a.isWideCharContinuation === b.isWideCharContinuation
    );
  }

  // Force complete redraw (useful for initialization or after screen clear)
  forceRedraw(): BufferDiff[] {
    const differences: BufferDiff[] = [];
    const currentCells = this._currentBuffer.cells;

    for (let y = 0; y < this._height; y++) {
      const row = currentCells[y];
      if (!row) continue;
      for (let x = 0; x < this._width; x++) {
        const cell = row[x];
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
        memoryUsage: this._estimateMemoryUsage(),
        dirtyRows: 0,
        totalRows: this._height,
        scannedCells: 0,
      };
      this._renderTimes = [];
      this._startTime = Date.now();
    }

    // Always update basic stats (cheap)
    this._stats.frameCount++;
    this._stats.renderOperations++;
    this._stats.changedCells = differences.length;
    this._stats.dirtyRows = this._dirtyRows.size;
    this._stats.totalRows = this._height;
    this._stats.scannedCells = this._dirtyRows.size * this._width;

    // Only compute expensive stats when Performance Dialog is visible
    const perfDialogOpen = getGlobalPerformanceDialog().isVisible();
    if (perfDialogOpen) {
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

      const elapsedSeconds = (currentTime - this._startTime) / 1000;
      this._stats.renderFrequency = this._stats.frameCount / Math.max(elapsedSeconds, 1);

      // Expensive: full buffer scan for non-empty cells
      this._stats.nonEmptyCells = this._countNonEmptyCells();
      this._stats.bufferUtilization = (this._stats.nonEmptyCells / this._stats.totalCells) * 100;
      this._stats.memoryUsage = this._estimateMemoryUsage();

      this._lastFrameTime = currentTime;

      // Log dirty stats only when dialog is open
      const savedPercent = this._stats.totalCells > 0
        ? Math.round((1 - this._stats.scannedCells / this._stats.totalCells) * 100)
        : 0;
      getLogger('buffer').debug(
        `Diff scan: ${this._stats.scannedCells}/${this._stats.totalCells} cells (${savedPercent}% saved), ` +
        `${this._stats.dirtyRows}/${this._stats.totalRows} rows dirty, ${this._stats.changedCells} cells changed`
      );
    }
  }

  // Count non-empty cells in current buffer
  private _countNonEmptyCells(): number {
    let count = 0;
    const currentCells = this._currentBuffer.cells;
    for (let y = 0; y < this._height; y++) {
      const row = currentCells[y];
      if (!row) continue;
      for (let x = 0; x < this._width; x++) {
        if (row[x].char !== EMPTY_CHAR) {
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
      memoryUsage: this._estimateMemoryUsage(),
      dirtyRows: 0,
      totalRows: this._height,
      scannedCells: 0,
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

    const currentCells = this._currentBuffer.cells;
    for (let y = 0; y < this._height; y++) {
      const row = currentCells[y];
      if (!row) continue;
      for (let x = 0; x < this._width; x++) {
        const cell = row[x];
        if (cell.char !== EMPTY_CHAR && !cell.isWideCharContinuation) {
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