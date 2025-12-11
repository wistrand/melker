// Clipped Buffer Proxy - clips all buffer operations to a bounds rectangle
import { TerminalBuffer, DualBuffer, Cell, RenderOptions, BufferDiff } from './buffer.ts';
import { Bounds } from './types.ts';

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
    // Clip text to bounds
    const startX = Math.max(x, this.clipBounds.x);
    const endX = Math.min(x + text.length, this.clipBounds.x + this.clipBounds.width);
    const startY = y;
    const endY = y;

    if (startY < this.clipBounds.y ||
        startY >= this.clipBounds.y + this.clipBounds.height ||
        startX >= endX) {
      return; // Outside clip bounds, ignore
    }

    // Calculate clipped text
    const textStartOffset = startX - x;
    const clippedLength = endX - startX;
    const clippedText = text.substring(textStartOffset, textStartOffset + clippedLength);

    if (clippedText.length > 0) {
      this.buffer.setText(startX, startY, clippedText, style);
    }
  }

  getCell(x: number, y: number): Cell | null {
    return this.buffer.getCell(x, y) || null;
  }

  clear(): void {
    // Clear only the clipped area
    for (let y = this.clipBounds.y; y < this.clipBounds.y + this.clipBounds.height; y++) {
      for (let x = this.clipBounds.x; x < this.clipBounds.x + this.clipBounds.width; x++) {
        this.buffer.setCell(x, y, { char: ' ' });
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