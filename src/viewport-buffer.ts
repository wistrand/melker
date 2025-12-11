// Viewport-based buffer system that replaces ClippedDualBuffer
import { TerminalBuffer, DualBuffer, Cell, RenderOptions, BufferDiff } from './buffer.ts';
import { Viewport, CoordinateTransform } from './viewport.ts';
import { analyzeString } from './char-width.ts';

/**
 * ViewportBufferProxy provides viewport-aware buffer operations
 * with proper wide character support and coordinate transformation
 */
export class ViewportBufferProxy {
  private _transform: CoordinateTransform;

  constructor(
    private _buffer: TerminalBuffer,
    private _viewport: Viewport
  ) {
    this._transform = new CoordinateTransform(_viewport);
  }

  get width() {
    return this._buffer.width;
  }

  get height() {
    return this._buffer.height;
  }

  setCell(x: number, y: number, cell: Cell): void {
    // Transform coordinates and check visibility
    if (!this._transform.isPointVisible(x, y)) {
      return; // Outside viewport, ignore
    }

    const transformed = this._transform.transformPoint({ x, y });
    this._buffer.setCell(transformed.x, transformed.y, cell);
  }

  setText(x: number, y: number, text: string, style: Partial<Cell> = {}): void {
    if (!text || !this._transform.isPointVisible(x, y)) {
      return;
    }

    // Handle wide characters correctly
    const clippedRun = this._clipTextRun(x, y, text);
    if (clippedRun.text.length > 0) {
      const transformed = this._transform.transformPoint({ x: clippedRun.x, y: clippedRun.y });
      this._buffer.setText(transformed.x, transformed.y, clippedRun.text, style);
    }
  }

  getCell(x: number, y: number): Cell | undefined {
    const transformed = this._transform.transformPoint({ x, y });
    return this._buffer.getCell(transformed.x, transformed.y);
  }

  clear(): void {
    // Clear only the viewport area
    const clip = this._viewport.clipRect;
    for (let y = clip.y; y < clip.y + clip.height; y++) {
      for (let x = clip.x; x < clip.x + clip.width; x++) {
        this._buffer.setCell(x, y, { char: ' ' });
      }
    }
  }

  fillRect(x: number, y: number, width: number, height: number, cell: Cell): void {
    // Transform the rectangle and clip to viewport
    const bounds = {
      x: x - this._viewport.scrollOffset.x,
      y: y - this._viewport.scrollOffset.y,
      width,
      height
    };

    if (!this._transform.isVisible(bounds)) {
      return; // Entirely outside viewport
    }

    // Clip the fill area to the viewport
    const clip = this._viewport.clipRect;
    const clipX1 = Math.max(bounds.x, clip.x);
    const clipY1 = Math.max(bounds.y, clip.y);
    const clipX2 = Math.min(bounds.x + bounds.width, clip.x + clip.width);
    const clipY2 = Math.min(bounds.y + bounds.height, clip.y + clip.height);

    if (clipX1 >= clipX2 || clipY1 >= clipY2) {
      return; // Nothing to fill
    }

    this._buffer.fillRect(clipX1, clipY1, clipX2 - clipX1, clipY2 - clipY1, cell);
  }

  toString(): string {
    return this._buffer.toString();
  }

  /**
   * Clip text run to viewport with proper wide character handling
   */
  private _clipTextRun(x: number, y: number, text: string): {
    x: number; y: number; text: string;
  } {
    const charInfo = analyzeString(text);
    let clippedChars = '';
    let visualX = x;

    for (const char of charInfo) {
      const endX = visualX + char.width - 1;

      if (this._transform.isPointVisible(visualX, y) &&
          this._transform.isPointVisible(endX, y)) {
        clippedChars += char.char;
        visualX += char.width;
      } else {
        break; // Stop at first character that doesn't fit
      }
    }

    return { x, y, text: clippedChars };
  }
}

/**
 * ViewportDualBuffer replaces ClippedDualBuffer with viewport-aware operations
 */
export class ViewportDualBuffer {
  public currentBuffer: ViewportBufferProxy;

  constructor(
    private _dualBuffer: DualBuffer,
    private _viewport: Viewport
  ) {
    this.currentBuffer = new ViewportBufferProxy(_dualBuffer.currentBuffer, _viewport);
  }

  get width() {
    return this._dualBuffer.width;
  }

  get height() {
    return this._dualBuffer.height;
  }

  get renderOptions() {
    return this._dualBuffer.renderOptions;
  }

  get viewport(): Viewport {
    return this._viewport;
  }

  setRenderOptions(options: Partial<RenderOptions>): void {
    this._dualBuffer.setRenderOptions(options);
  }

  resize(newWidth: number, newHeight: number): void {
    this._dualBuffer.resize(newWidth, newHeight);
    // Update the currentBuffer proxy to point to the resized buffer
    this.currentBuffer = new ViewportBufferProxy(this._dualBuffer.currentBuffer, this._viewport);
  }

  clear(): void {
    // Clear only the viewport area
    this.currentBuffer.clear();
  }

  swapAndGetDiff(): BufferDiff[] {
    return this._dualBuffer.swapAndGetDiff();
  }

  forceRedraw(): BufferDiff[] {
    return this._dualBuffer.forceRedraw();
  }

  getStats() {
    return this._dualBuffer.getStats();
  }

  getDisplayBuffer() {
    return this._dualBuffer.getDisplayBuffer();
  }

  /**
   * Update viewport and recreate buffer proxy
   */
  updateViewport(newViewport: Viewport): ViewportDualBuffer {
    return new ViewportDualBuffer(this._dualBuffer, newViewport);
  }
}