// Clipped Buffer Proxy - clips all buffer operations to a bounds rectangle
import { TerminalBuffer, DualBuffer, Cell, RenderOptions, BufferDiff, EMPTY_CHAR } from './buffer.ts';
import { Bounds } from './types.ts';
import { analyzeString } from './char-width.ts';

export class ClippedBufferProxy {
  constructor(
    private buffer: TerminalBuffer,
    private clipBounds: Bounds
  ) {}

  get width() {
    return this.buffer.width;
  }

  get height() {
    return this.buffer.height;
  }

  setCell(x: number, y: number, cell: Cell): void {
    // Clip coordinates to bounds
    if (x < this.clipBounds.x ||
        x >= this.clipBounds.x + this.clipBounds.width ||
        y < this.clipBounds.y ||
        y >= this.clipBounds.y + this.clipBounds.height) {
      return; // Outside clip bounds, ignore
    }

    this.buffer.setCell(x, y, cell);
  }

  setText(x: number, y: number, text: string, style: Partial<Cell>): void {
    // Check Y bounds first
    if (y < this.clipBounds.y || y >= this.clipBounds.y + this.clipBounds.height) {
      return; // Outside clip bounds vertically
    }

    // Analyze text to get proper visual widths (handles surrogate pairs correctly)
    const chars = analyzeString(text);

    // Calculate visual width of text
    let visualWidth = 0;
    for (const charInfo of chars) {
      visualWidth += charInfo.width;
    }

    // Calculate X clipping using visual width
    const startX = Math.max(x, this.clipBounds.x);
    const endX = Math.min(x + visualWidth, this.clipBounds.x + this.clipBounds.width);

    if (startX >= endX) {
      return; // Outside clip bounds horizontally
    }

    // Build clipped text by iterating over characters with visual positions
    let clippedText = '';
    let visualX = x;
    for (const charInfo of chars) {
      const charEndX = visualX + charInfo.width;

      // Skip characters entirely before clip region
      if (charEndX <= startX) {
        visualX = charEndX;
        continue;
      }

      // Stop when we've passed the clip region
      if (visualX >= endX) {
        break;
      }

      // Include this character (it's at least partially in the clip region)
      // For wide chars that would extend past endX, we skip them to avoid partial rendering
      if (charInfo.width === 2 && visualX + 1 >= endX) {
        break; // Wide char won't fit
      }

      clippedText += charInfo.char;
      visualX = charEndX;
    }

    if (clippedText.length > 0) {
      this.buffer.setText(startX, y, clippedText, style);
    }
  }

  fillLine(x: number, y: number, width: number, style: Partial<Cell> = {}): void {
    // Check Y bounds
    if (y < this.clipBounds.y || y >= this.clipBounds.y + this.clipBounds.height) {
      return;
    }

    // Clip X range
    const startX = Math.max(x, this.clipBounds.x);
    const endX = Math.min(x + width, this.clipBounds.x + this.clipBounds.width);
    const clippedWidth = endX - startX;

    if (clippedWidth > 0) {
      this.buffer.fillLine(startX, y, clippedWidth, style);
    }
  }

  getCell(x: number, y: number): Cell | null {
    return this.buffer.getCell(x, y) || null;
  }

  clear(): void {
    // Clear only the clipped area
    for (let y = this.clipBounds.y; y < this.clipBounds.y + this.clipBounds.height; y++) {
      for (let x = this.clipBounds.x; x < this.clipBounds.x + this.clipBounds.width; x++) {
        this.buffer.setCell(x, y, { char: EMPTY_CHAR });
      }
    }
  }

  fillRect(x: number, y: number, width: number, height: number, cell: Cell): void {
    // Clip fill rectangle to bounds
    const clipX1 = Math.max(x, this.clipBounds.x);
    const clipY1 = Math.max(y, this.clipBounds.y);
    const clipX2 = Math.min(x + width, this.clipBounds.x + this.clipBounds.width);
    const clipY2 = Math.min(y + height, this.clipBounds.y + this.clipBounds.height);

    if (clipX1 >= clipX2 || clipY1 >= clipY2) {
      return; // Nothing to fill
    }

    this.buffer.fillRect(clipX1, clipY1, clipX2 - clipX1, clipY2 - clipY1, cell);
  }

  toString(): string {
    return this.buffer.toString();
  }
}

export class ClippedDualBuffer {
  public currentBuffer: ClippedBufferProxy;

  constructor(
    private dualBuffer: DualBuffer,
    private clipBounds: Bounds
  ) {
    this.currentBuffer = new ClippedBufferProxy(dualBuffer.currentBuffer, clipBounds);
  }

  get width() {
    return this.dualBuffer.width;
  }

  get height() {
    return this.dualBuffer.height;
  }

  get renderOptions() {
    return this.dualBuffer.renderOptions;
  }

  setRenderOptions(options: Partial<RenderOptions>): void {
    this.dualBuffer.setRenderOptions(options);
  }

  resize(newWidth: number, newHeight: number): void {
    this.dualBuffer.resize(newWidth, newHeight);
    // Update the currentBuffer proxy to point to the resized buffer
    this.currentBuffer = new ClippedBufferProxy(this.dualBuffer.currentBuffer, this.clipBounds);
  }

  clear(): void {
    // Clear only the clipped area
    this.currentBuffer.clear();
  }

  swapAndGetDiff(): BufferDiff[] {
    return this.dualBuffer.swapAndGetDiff();
  }

  forceRedraw(): BufferDiff[] {
    return this.dualBuffer.forceRedraw();
  }

  getStats() {
    return this.dualBuffer.getStats();
  }

  getDisplayBuffer() {
    return this.dualBuffer.getDisplayBuffer();
  }
}