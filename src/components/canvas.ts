// Canvas component for basic graphics rendering using Unicode sextant characters

import { Element, BaseProps, Renderable, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { TRANSPARENT, DEFAULT_FG, packRGBA, unpackRGBA, rgbaToCss, cssToRgba } from './color-utils.ts';
import { applySierraStableDither, applyFloydSteinbergDither, applyOrderedDither, type DitherMode } from '../video/dither.ts';
import { getCurrentTheme } from '../theme.ts';

// Re-export color utilities for external use
export { packRGBA, unpackRGBA, rgbaToCss, cssToRgba } from './color-utils.ts';

// Unicode sextant characters mapping (2x3 pixel blocks per character)
const BLOCKS_2X3 = [
  [' ', 0b000000],
  ['🬞', 0b000001],
  ['🬏', 0b000010],
  ['🬭', 0b000011],
  ['🬇', 0b000100],
  ['🬦', 0b000101],
  ['🬖', 0b000110],
  ['🬵', 0b000111],
  ['🬃', 0b001000],
  ['🬢', 0b001001],
  ['🬓', 0b001010],
  ['🬱', 0b001011],
  ['🬋', 0b001100],
  ['🬩', 0b001101],
  ['🬚', 0b001110],
  ['🬹', 0b001111],
  ['🬁', 0b010000],
  ['🬠', 0b010001],
  ['🬑', 0b010010],
  ['🬯', 0b010011],
  ['🬉', 0b010100],
  ['▐', 0b010101],
  ['🬘', 0b010110],
  ['🬷', 0b010111],
  ['🬅', 0b011000],
  ['🬤', 0b011001],
  ['🬔', 0b011010],
  ['🬳', 0b011011],
  ['🬍', 0b011100],
  ['🬫', 0b011101],
  ['🬜', 0b011110],
  ['🬻', 0b011111],
  ['🬀', 0b100000],
  ['🬟', 0b100001],
  ['🬐', 0b100010],
  ['🬮', 0b100011],
  ['🬈', 0b100100],
  ['🬧', 0b100101],
  ['🬗', 0b100110],
  ['🬶', 0b100111],
  ['🬄', 0b101000],
  ['🬣', 0b101001],
  ['▌', 0b101010],
  ['🬲', 0b101011],
  ['🬌', 0b101100],
  ['🬪', 0b101101],
  ['🬛', 0b101110],
  ['🬺', 0b101111],
  ['🬂', 0b110000],
  ['🬡', 0b110001],
  ['🬒', 0b110010],
  ['🬰', 0b110011],
  ['🬊', 0b110100],
  ['🬨', 0b110101],
  ['🬙', 0b110110],
  ['🬸', 0b110111],
  ['🬆', 0b111000],
  ['🬥', 0b111001],
  ['🬕', 0b111010],
  ['🬴', 0b111011],
  ['🬎', 0b111100],
  ['🬬', 0b111101],
  ['🬝', 0b111110],
  ['█', 0b111111]
] as const;

// Create lookup array for fast character access (direct index, faster than Map)
// Index is 6-bit pattern (0-63), value is sextant character
const PIXEL_TO_CHAR: string[] = new Array(64).fill(' ');
for (const [char, pattern] of BLOCKS_2X3) {
  PIXEL_TO_CHAR[pattern] = char;
}

export interface CanvasProps extends BaseProps {
  width: number;                     // Canvas width in terminal columns
  height: number;                    // Canvas height in terminal rows
  scale?: number;                    // Pixel scale factor (default: 1)
  backgroundColor?: string;          // Background color
  charAspectRatio?: number;          // Terminal char width/height ratio (default: 0.5)
  src?: string;                      // Image source path (loads and displays image)
  dither?: DitherMode | boolean;     // Dithering mode for images (e.g., 'sierra-stable' for B&W themes)
  ditherBits?: number;               // Bits per channel for dithering (1-8, default: 1 for B&W)
  logo?: boolean;                    // Enable animated Melker logo
  logoColor?: string;                // Logo color (default: cyan)
  logoSpeed?: number;                // Animation speed in ms per frame (default: 30)
  onPaint?: (event: { canvas: CanvasElement; bounds: Bounds }) => void;  // Called when canvas needs repainting
}

// Image data storage for loaded images
interface LoadedImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;  // RGBA pixel data
}

export class CanvasElement extends Element implements Renderable {
  declare type: 'canvas';
  declare props: CanvasProps;

  // Backing color buffer (scale * width * 2) x (scale * height * 3)
  // TRANSPARENT (0) means pixel off, any other value means pixel on with that color
  private _colorBuffer: Uint32Array;  // RGBA color per pixel (packed)
  private _previousColorBuffer: Uint32Array;  // For dirty tracking
  // Image background layer buffer (separate from drawing layer)
  private _imageColorBuffer: Uint32Array;
  private _bufferWidth: number;
  private _bufferHeight: number;
  private _scale: number;
  private _charAspectRatio: number;
  private _isDirty: boolean = false;
  private _currentColor: number = DEFAULT_FG;  // Current drawing color

  // Image loading support
  private _loadedImage: LoadedImage | null = null;
  private _imageLoading: boolean = false;
  private _imageSrc: string | null = null;

  // Logo animation support
  private _logoAnimationFrame: number = 0;
  private _logoAnimationTimer: number | null = null;
  private _logoAnimationComplete: boolean = false;
  private _logoRequestRender: (() => void) | null = null;

  // Pre-allocated working arrays for _renderToTerminal (avoid per-cell allocations)
  private _rtDrawingPixels: boolean[] = [false, false, false, false, false, false];
  private _rtDrawingColors: number[] = [0, 0, 0, 0, 0, 0];
  private _rtImagePixels: boolean[] = [false, false, false, false, false, false];
  private _rtImageColors: number[] = [0, 0, 0, 0, 0, 0];
  private _rtSextantPixels: boolean[] = [false, false, false, false, false, false];
  private _rtCompositePixels: boolean[] = [false, false, false, false, false, false];
  private _rtCompositeColors: number[] = [0, 0, 0, 0, 0, 0];
  private _rtIsDrawing: boolean[] = [false, false, false, false, false, false];
  // Reusable cell style object
  private _rtCellStyle: Partial<Cell> = {};

  // Dithering cache - stores composited & dithered RGBA buffer
  private _ditherCache: Uint8Array | null = null;
  private _ditherCacheValid: boolean = false;
  private _lastDitherMode: string | boolean | undefined = undefined;
  private _lastDitherBits: number | undefined = undefined;

  constructor(props: CanvasProps, children: Element[] = []) {
    const scale = Math.max(1, Math.floor(props.scale || 1));
    // Default terminal char aspect ratio (width/height) - varies by font, ~1.0-1.1 for many modern terminals
    const charAspectRatio = props.charAspectRatio ?? 1.05;

    const defaultProps: CanvasProps = {
      scale,
      charAspectRatio,
      backgroundColor: undefined,
      disabled: false,
      ...props,
      style: {
        // Default styles would go here (none currently)
        ...props.style
      },
    };

    super('canvas', defaultProps, children);

    this._scale = scale;
    this._charAspectRatio = charAspectRatio;
    // Each terminal character represents a 2x3 pixel block
    this._bufferWidth = props.width * 2 * scale;
    this._bufferHeight = props.height * 3 * scale;

    // Initialize color buffers (TRANSPARENT = pixel off, other value = pixel on)
    const bufferSize = this._bufferWidth * this._bufferHeight;
    this._colorBuffer = new Uint32Array(bufferSize);
    this._previousColorBuffer = new Uint32Array(bufferSize);
    // Initialize image background layer buffer
    this._imageColorBuffer = new Uint32Array(bufferSize);
    this.clear();
  }

  /**
   * Clear the entire canvas
   */
  clear(): void {
    this._colorBuffer.fill(TRANSPARENT);
    this._isDirty = true;
  }

  /**
   * Clear a rectangular region of the canvas.
   * More efficient than clear() when only part of the canvas needs clearing.
   */
  clearRect(x: number, y: number, width: number, height: number): void {
    x = Math.floor(x);
    y = Math.floor(y);
    width = Math.floor(width);
    height = Math.floor(height);
    if (width <= 0 || height <= 0) return;

    const bufW = this._bufferWidth;
    const bufH = this._bufferHeight;

    // Clamp to buffer bounds
    const startX = Math.max(0, x);
    const startY = Math.max(0, y);
    const endX = Math.min(bufW, x + width);
    const endY = Math.min(bufH, y + height);

    if (startX >= endX || startY >= endY) return;

    // Clear row by row using fill() for efficiency
    const clearWidth = endX - startX;
    for (let row = startY; row < endY; row++) {
      const rowStart = row * bufW + startX;
      this._colorBuffer.fill(TRANSPARENT, rowStart, rowStart + clearWidth);
    }

    this._isDirty = true;
  }

  /**
   * Set a single pixel (uses current drawing color)
   */
  setPixel(x: number, y: number, value: boolean = true): void {
    if (x < 0 || x >= this._bufferWidth || y < 0 || y >= this._bufferHeight) {
      return; // Out of bounds
    }

    const index = y * this._bufferWidth + x;
    const colorValue = value ? this._currentColor : TRANSPARENT;

    if (this._colorBuffer[index] !== colorValue) {
      this._colorBuffer[index] = colorValue;
      this._isDirty = true;
    }
  }

  /**
   * Get a single pixel (returns true if pixel is on, i.e., not TRANSPARENT)
   */
  getPixel(x: number, y: number): boolean {
    if (x < 0 || x >= this._bufferWidth || y < 0 || y >= this._bufferHeight) {
      return false; // Out of bounds
    }

    const index = y * this._bufferWidth + x;
    return this._colorBuffer[index] !== TRANSPARENT;
  }

  /**
   * Set the current drawing color (used by subsequent drawing operations)
   */
  setColor(color: number | string): void {
    if (typeof color === 'string') {
      this._currentColor = cssToRgba(color);
    } else {
      this._currentColor = color;
    }
  }

  /**
   * Get the current drawing color
   */
  getColor(): number {
    return this._currentColor;
  }

  /**
   * Set a pixel with a specific color
   */
  setPixelColor(x: number, y: number, color: number | string, value: boolean = true): void {
    if (x < 0 || x >= this._bufferWidth || y < 0 || y >= this._bufferHeight) {
      return; // Out of bounds
    }

    const index = y * this._bufferWidth + x;
    const colorValue = value ? (typeof color === 'string' ? cssToRgba(color) : color) : TRANSPARENT;

    if (this._colorBuffer[index] !== colorValue) {
      this._colorBuffer[index] = colorValue;
      this._isDirty = true;
    }
  }

  /**
   * Get the color of a specific pixel
   */
  getPixelColor(x: number, y: number): number {
    if (x < 0 || x >= this._bufferWidth || y < 0 || y >= this._bufferHeight) {
      return TRANSPARENT; // Out of bounds
    }

    const index = y * this._bufferWidth + x;
    return this._colorBuffer[index];
  }

  /**
   * Draw a rectangle outline
   */
  drawRect(x: number, y: number, width: number, height: number): void {
    // Floor inputs for consistent pixel placement
    x = Math.floor(x);
    y = Math.floor(y);
    width = Math.floor(width);
    height = Math.floor(height);
    if (width <= 0 || height <= 0) return;

    // Top and bottom edges
    for (let i = 0; i < width; i++) {
      this.setPixel(x + i, y, true);
      this.setPixel(x + i, y + height - 1, true);
    }

    // Left and right edges
    for (let i = 0; i < height; i++) {
      this.setPixel(x, y + i, true);
      this.setPixel(x + width - 1, y + i, true);
    }
  }

  /**
   * Draw a filled rectangle
   */
  fillRect(x: number, y: number, width: number, height: number): void {
    // Floor inputs for consistent pixel placement
    x = Math.floor(x);
    y = Math.floor(y);
    width = Math.floor(width);
    height = Math.floor(height);
    if (width <= 0 || height <= 0) return;

    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        this.setPixel(x + dx, y + dy, true);
      }
    }
  }

  /**
   * Draw a line using Bresenham's algorithm
   */
  drawLine(x0: number, y0: number, x1: number, y1: number): void {
    // Floor inputs - Bresenham algorithm requires integers
    x0 = Math.floor(x0);
    y0 = Math.floor(y0);
    x1 = Math.floor(x1);
    y1 = Math.floor(y1);

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let x = x0;
    let y = y0;

    while (true) {
      this.setPixel(x, y, true);

      if (x === x1 && y === y1) break;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /**
   * Draw a circle outline using midpoint circle algorithm
   */
  drawCircle(centerX: number, centerY: number, radius: number): void {
    // Floor all inputs - Bresenham algorithm requires integers
    centerX = Math.floor(centerX);
    centerY = Math.floor(centerY);
    radius = Math.floor(radius);
    if (radius <= 0) return;

    let x = 0;
    let y = radius;
    let d = 3 - 2 * radius;

    while (y >= x) {
      // Draw 8 octants
      this.setPixel(centerX + x, centerY + y, true);
      this.setPixel(centerX - x, centerY + y, true);
      this.setPixel(centerX + x, centerY - y, true);
      this.setPixel(centerX - x, centerY - y, true);
      this.setPixel(centerX + y, centerY + x, true);
      this.setPixel(centerX - y, centerY + x, true);
      this.setPixel(centerX + y, centerY - x, true);
      this.setPixel(centerX - y, centerY - x, true);

      if (d < 0) {
        d = d + 4 * x + 6;
      } else {
        d = d + 4 * (x - y) + 10;
        y--;
      }
      x++;
    }
  }

  /**
   * Draw an ellipse outline using midpoint ellipse algorithm
   */
  drawEllipse(centerX: number, centerY: number, radiusX: number, radiusY: number): void {
    centerX = Math.floor(centerX);
    centerY = Math.floor(centerY);
    radiusX = Math.floor(radiusX);
    radiusY = Math.floor(radiusY);

    if (radiusX <= 0 || radiusY <= 0) return;

    // Handle circle case
    if (radiusX === radiusY) {
      this.drawCircle(centerX, centerY, radiusX);
      return;
    }

    let x = 0;
    let y = radiusY;

    // Decision parameters for regions
    const rx2 = radiusX * radiusX;
    const ry2 = radiusY * radiusY;
    const twoRx2 = 2 * rx2;
    const twoRy2 = 2 * ry2;

    // Region 1
    let p = Math.round(ry2 - rx2 * radiusY + 0.25 * rx2);
    let px = 0;
    let py = twoRx2 * y;

    // Plot initial points
    this.setPixel(centerX + x, centerY + y, true);
    this.setPixel(centerX - x, centerY + y, true);
    this.setPixel(centerX + x, centerY - y, true);
    this.setPixel(centerX - x, centerY - y, true);

    // Region 1: slope > -1
    while (px < py) {
      x++;
      px += twoRy2;

      if (p < 0) {
        p += ry2 + px;
      } else {
        y--;
        py -= twoRx2;
        p += ry2 + px - py;
      }

      this.setPixel(centerX + x, centerY + y, true);
      this.setPixel(centerX - x, centerY + y, true);
      this.setPixel(centerX + x, centerY - y, true);
      this.setPixel(centerX - x, centerY - y, true);
    }

    // Region 2: slope <= -1
    p = Math.round(ry2 * (x + 0.5) * (x + 0.5) + rx2 * (y - 1) * (y - 1) - rx2 * ry2);

    while (y > 0) {
      y--;
      py -= twoRx2;

      if (p > 0) {
        p += rx2 - py;
      } else {
        x++;
        px += twoRy2;
        p += rx2 - py + px;
      }

      this.setPixel(centerX + x, centerY + y, true);
      this.setPixel(centerX - x, centerY + y, true);
      this.setPixel(centerX + x, centerY - y, true);
      this.setPixel(centerX - x, centerY - y, true);
    }
  }

  // ============================================
  // Color Drawing Methods
  // ============================================

  /**
   * Draw a line with a specific color
   */
  drawLineColor(x0: number, y0: number, x1: number, y1: number, color: number | string): void {
    const savedColor = this._currentColor;
    this.setColor(color);
    this.drawLine(x0, y0, x1, y1);
    this._currentColor = savedColor;
  }

  /**
   * Draw a rectangle outline with a specific color
   */
  drawRectColor(x: number, y: number, width: number, height: number, color: number | string): void {
    const savedColor = this._currentColor;
    this.setColor(color);
    this.drawRect(x, y, width, height);
    this._currentColor = savedColor;
  }

  /**
   * Draw a filled rectangle with a specific color
   */
  fillRectColor(x: number, y: number, width: number, height: number, color: number | string): void {
    const savedColor = this._currentColor;
    this.setColor(color);
    this.fillRect(x, y, width, height);
    this._currentColor = savedColor;
  }

  /**
   * Draw a circle outline with a specific color
   */
  drawCircleColor(centerX: number, centerY: number, radius: number, color: number | string): void {
    const savedColor = this._currentColor;
    this.setColor(color);
    this.drawCircle(centerX, centerY, radius);
    this._currentColor = savedColor;
  }

  /**
   * Draw an ellipse outline with a specific color
   */
  drawEllipseColor(centerX: number, centerY: number, radiusX: number, radiusY: number, color: number | string): void {
    const savedColor = this._currentColor;
    this.setColor(color);
    this.drawEllipse(centerX, centerY, radiusX, radiusY);
    this._currentColor = savedColor;
  }

  /**
   * Draw a visually correct circle with a specific color
   */
  drawCircleCorrectedColor(centerX: number, centerY: number, radius: number, color: number | string): void {
    const savedColor = this._currentColor;
    this.setColor(color);
    this.drawCircleCorrected(centerX, centerY, radius);
    this._currentColor = savedColor;
  }

  /**
   * Draw a visually correct square with a specific color
   */
  drawSquareCorrectedColor(x: number, y: number, size: number, color: number | string): void {
    const savedColor = this._currentColor;
    this.setColor(color);
    this.drawSquareCorrected(x, y, size);
    this._currentColor = savedColor;
  }

  /**
   * Fill a visually correct square with a specific color
   */
  fillSquareCorrectedColor(x: number, y: number, size: number, color: number | string): void {
    const savedColor = this._currentColor;
    this.setColor(color);
    this.fillSquareCorrected(x, y, size);
    this._currentColor = savedColor;
  }

  // ============================================
  // Image Loading Methods
  // ============================================

  /**
   * Load an image from a file path and render it to the canvas.
   * The image is scaled to fit the canvas while maintaining aspect ratio.
   * @param src Path to the image file (PNG, JPG, etc.) - relative paths resolve from cwd
   */
  async loadImage(src: string): Promise<void> {
    if (this._imageLoading) {
      return; // Already loading
    }

    this._imageLoading = true;
    this._imageSrc = src;

    // Resolve the path for file reading
    let resolvedSrc: string;
    if (src.startsWith('file://')) {
      // Handle file:// URLs - extract the path
      resolvedSrc = new URL(src).pathname;
    } else if (src.startsWith('/')) {
      // Absolute path
      resolvedSrc = src;
    } else {
      // Relative path - resolve from cwd
      resolvedSrc = `${Deno.cwd()}/${src}`;
    }

    try {
      // Read the image file
      const imageBytes = await Deno.readFile(resolvedSrc);
      const blob = new Blob([imageBytes]);

      // Decode the image using createImageBitmap
      const bitmap = await createImageBitmap(blob);

      // Extract pixel data using Deno's internal [[bitmapData]] symbol
      // deno-lint-ignore no-explicit-any
      const bitmapAny = bitmap as any;
      const bitmapDataSymbol = Object.getOwnPropertySymbols(bitmap)
        .find(sym => sym.description === '[[bitmapData]]');

      if (!bitmapDataSymbol) {
        throw new Error('Could not find [[bitmapData]] symbol on ImageBitmap');
      }

      const pixelData = bitmapAny[bitmapDataSymbol] as Uint8Array;

      // Store the loaded image (convert to Uint8ClampedArray)
      this._loadedImage = {
        width: bitmap.width,
        height: bitmap.height,
        data: new Uint8ClampedArray(pixelData)
      };

      // Clean up
      bitmap.close();

      // Render the image to the canvas
      this._renderImageToBuffer();

    } catch (error) {
      throw new Error(`Failed to load image '${src}': ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this._imageLoading = false;
    }
  }

  /**
   * Render the loaded image to the pixel buffer, scaling to fit.
   * Uses bilinear interpolation for smooth scaling.
   * Applies dithering if the dither prop is set.
   */
  private _renderImageToBuffer(): void {
    if (!this._loadedImage) return;

    const img = this._loadedImage;
    const bufW = this._bufferWidth;
    const bufH = this._bufferHeight;

    // Calculate scaling to fit while maintaining aspect ratio
    // Account for pixel aspect ratio (terminal chars are taller than wide)
    const pixelAspect = this.getPixelAspectRatio();
    const visualBufW = bufW * pixelAspect;

    const scaleX = visualBufW / img.width;
    const scaleY = bufH / img.height;
    const scale = Math.min(scaleX, scaleY);

    // Calculate scaled dimensions
    const scaledW = Math.floor(img.width * scale / pixelAspect);
    const scaledH = Math.floor(img.height * scale);

    // Calculate offset to center the image
    const offsetX = Math.floor((bufW - scaledW) / 2);
    const offsetY = Math.floor((bufH - scaledH) / 2);

    // Clear the image background buffer (not the drawing layer)
    this._imageColorBuffer.fill(TRANSPARENT);

    // First, create a scaled RGBA buffer for the image
    const scaledData = new Uint8Array(scaledW * scaledH * 4);

    // Sample and scale the image
    for (let y = 0; y < scaledH; y++) {
      for (let x = 0; x < scaledW; x++) {
        // Map buffer coordinates to image coordinates
        const imgX = (x / scaledW) * img.width;
        const imgY = (y / scaledH) * img.height;

        // Nearest neighbor sampling
        const srcX = Math.floor(imgX);
        const srcY = Math.floor(imgY);

        // Get pixel color from image
        const srcIdx = (srcY * img.width + srcX) * 4;
        const dstIdx = (y * scaledW + x) * 4;

        scaledData[dstIdx] = img.data[srcIdx];
        scaledData[dstIdx + 1] = img.data[srcIdx + 1];
        scaledData[dstIdx + 2] = img.data[srcIdx + 2];
        scaledData[dstIdx + 3] = img.data[srcIdx + 3];
      }
    }

    // Apply dithering if enabled
    const ditherMode = this.props.dither;
    if (ditherMode === 'sierra-stable') {
      const bits = this.props.ditherBits ?? 1; // Default to 1 bit (B&W)
      applySierraStableDither(scaledData, scaledW, scaledH, bits);
    }

    // Render the scaled (and possibly dithered) image to the buffer
    for (let y = 0; y < scaledH; y++) {
      for (let x = 0; x < scaledW; x++) {
        const srcIdx = (y * scaledW + x) * 4;
        const r = scaledData[srcIdx];
        const g = scaledData[srcIdx + 1];
        const b = scaledData[srcIdx + 2];
        const a = scaledData[srcIdx + 3];

        // Skip fully transparent pixels
        if (a < 128) continue;

        // Set the pixel in the image background buffer
        const bufX = offsetX + x;
        const bufY = offsetY + y;

        if (bufX >= 0 && bufX < bufW && bufY >= 0 && bufY < bufH) {
          const index = bufY * bufW + bufX;
          this._imageColorBuffer[index] = packRGBA(r, g, b, a);
        }
      }
    }

    this._isDirty = true;
  }

  /**
   * Check if an image is currently loaded
   */
  hasImage(): boolean {
    return this._loadedImage !== null;
  }

  /**
   * Get the loaded image dimensions
   */
  getImageSize(): { width: number; height: number } | null {
    if (!this._loadedImage) return null;
    return { width: this._loadedImage.width, height: this._loadedImage.height };
  }

  /**
   * Re-render the image (call after resize to rescale)
   */
  refreshImage(): void {
    if (this._loadedImage) {
      this._renderImageToBuffer();
    }
  }

  /**
   * Clear the loaded image
   */
  clearImage(): void {
    this._loadedImage = null;
    this._imageSrc = null;
    // Clear the image background buffer
    this._imageColorBuffer.fill(TRANSPARENT);
    this._isDirty = true;
  }

  // ============================================
  // Protected methods for subclasses (e.g., VideoElement)
  // ============================================

  /**
   * Clear the image background buffer
   * Used by VideoElement to render video frames
   */
  protected clearImageBuffer(): void {
    this._imageColorBuffer.fill(TRANSPARENT);
  }

  /**
   * Get direct access to the image color buffer for optimized writes
   */
  protected getImageColorBuffer(): Uint32Array {
    return this._imageColorBuffer;
  }

  /**
   * Set a pixel in the image background buffer
   * Used by VideoElement to render video frames
   * @param x X coordinate in buffer space
   * @param y Y coordinate in buffer space
   * @param color Packed RGBA color value (TRANSPARENT means pixel off)
   */
  protected setImagePixel(x: number, y: number, color: number): void {
    const bufW = this._bufferWidth;
    const bufH = this._bufferHeight;
    if (x >= 0 && x < bufW && y >= 0 && y < bufH) {
      const index = y * bufW + x;
      this._imageColorBuffer[index] = color;
    }
  }

  /**
   * Debug: Count non-transparent pixels in image buffer
   */
  debugImageBuffer(): { colorCount: number } {
    let colorCount = 0;
    for (let i = 0; i < this._imageColorBuffer.length; i++) {
      if (this._imageColorBuffer[i] !== TRANSPARENT) colorCount++;
    }
    return { colorCount };
  }

  // ============================================
  // Aspect Ratio Correction Methods
  // ============================================

  /**
   * Get the effective pixel aspect ratio (width/height).
   * This combines the sextant block ratio (2:3) with the terminal character ratio.
   * A value < 1 means pixels are taller than wide.
   */
  getPixelAspectRatio(): number {
    // Sextant blocks are 2 pixels wide x 3 pixels tall per character
    // Combined with terminal character aspect ratio (width/height)
    return (2 / 3) * this._charAspectRatio;
  }

  /**
   * Set the terminal character aspect ratio (width/height).
   * Typical values: 0.5 for most terminals, 0.6 for some fonts.
   */
  setCharAspectRatio(ratio: number): void {
    this._charAspectRatio = Math.max(0.1, Math.min(2.0, ratio));
    this.props.charAspectRatio = this._charAspectRatio;
  }

  /**
   * Get the current terminal character aspect ratio
   */
  getCharAspectRatio(): number {
    return this._charAspectRatio;
  }

  /**
   * Draw a visually correct circle (appears round on screen).
   * Internally draws an ellipse compensating for pixel aspect ratio.
   */
  drawCircleCorrected(centerX: number, centerY: number, radius: number): void {
    const aspectRatio = this.getPixelAspectRatio();
    // To make circle appear round, stretch X radius by inverse of aspect ratio
    const radiusX = Math.round(radius / aspectRatio);
    const radiusY = radius;
    this.drawEllipse(centerX, centerY, radiusX, radiusY);
  }

  /**
   * Draw a visually correct square (appears square on screen).
   * Internally adjusts width to compensate for pixel aspect ratio.
   */
  drawSquareCorrected(x: number, y: number, size: number): void {
    const aspectRatio = this.getPixelAspectRatio();
    // To make square appear square, stretch width by inverse of aspect ratio
    const width = Math.round(size / aspectRatio);
    const height = size;
    this.drawRect(x, y, width, height);
  }

  /**
   * Draw a visually correct filled square (appears square on screen).
   */
  fillSquareCorrected(x: number, y: number, size: number): void {
    const aspectRatio = this.getPixelAspectRatio();
    const width = Math.round(size / aspectRatio);
    const height = size;
    this.fillRect(x, y, width, height);
  }

  /**
   * Draw a line with aspect-corrected coordinates.
   * Input coordinates are in "visual" space where 1 unit = same distance in both axes.
   */
  drawLineCorrected(x0: number, y0: number, x1: number, y1: number): void {
    const aspectRatio = this.getPixelAspectRatio();
    // Scale X coordinates by inverse of aspect ratio
    const px0 = Math.round(x0 / aspectRatio);
    const px1 = Math.round(x1 / aspectRatio);
    this.drawLine(px0, y0, px1, y1);
  }

  /**
   * Convert visual coordinates to pixel coordinates.
   * Visual coordinates have equal units in both dimensions.
   * @returns [pixelX, pixelY]
   */
  visualToPixel(visualX: number, visualY: number): [number, number] {
    const aspectRatio = this.getPixelAspectRatio();
    return [Math.round(visualX / aspectRatio), visualY];
  }

  /**
   * Convert pixel coordinates to visual coordinates.
   * @returns [visualX, visualY]
   */
  pixelToVisual(pixelX: number, pixelY: number): [number, number] {
    const aspectRatio = this.getPixelAspectRatio();
    return [pixelX * aspectRatio, pixelY];
  }

  /**
   * Get buffer size in visual units (where 1 unit = same distance in both axes).
   * Useful for centering and positioning with corrected coordinates.
   */
  getVisualSize(): { width: number; height: number } {
    const aspectRatio = this.getPixelAspectRatio();
    return {
      width: this._bufferWidth * aspectRatio,
      height: this._bufferHeight
    };
  }

  // ============================================
  // Logo Animation Methods
  // ============================================

  // Pixelated "M" logo bitmap (15 rows x 11 columns)
  // Each row is a binary pattern where 1 = pixel on
  private static readonly MELKER_LOGO: number[] = [
    0b11000000011, // M   M
    0b11100000111, // MM MM
    0b11100000111, // MM MM
    0b11110001111, // MMM MMM
    0b11110001111, // MMM  MMM
    0b11011011011, // MM  M MM
    0b11011011011, // MM  M MM
    0b11011111011, // MM MMM MM
    0b11001110011, // MM MMM MM
    0b11001110011, // MM  M  MM
    0b11000100011, // MM  M  MM
    0b11000000011, // MM     MM
    0b11000000011, // MM     MM
    0b11000000011, // MM     MM
    0b11000000011, // MM     MM
  ];

  private static readonly LOGO_WIDTH = 11;
  private static readonly LOGO_HEIGHT = 15;

  /**
   * Get logo colors based on theme and props.
   * Default: green on black. In B&W themes: black on white.
   */
  private _getLogoColors(): { fgColor: string; bgColor: string } {
    const theme = getCurrentTheme();
    const isBW = theme.type === 'bw';

    if (this.props.logoColor) {
      // User specified color
      return {
        fgColor: this.props.logoColor,
        bgColor: isBW ? 'white' : (this.props.backgroundColor ?? 'black'),
      };
    }

    if (isBW) {
      return { fgColor: 'black', bgColor: 'white' };
    }

    // Default: green on black
    return { fgColor: '#00ff00', bgColor: this.props.backgroundColor ?? 'black' };
  }

  /**
   * Start the logo animation (raster lines shifting in)
   */
  startLogoAnimation(requestRender?: () => void): void {
    if (this._logoAnimationTimer !== null) {
      return; // Already running
    }

    this._logoRequestRender = requestRender ?? null;
    this._logoAnimationFrame = 0;
    this._logoAnimationComplete = false;
    this.clear();

    const speed = this.props.logoSpeed ?? 30;

    this._logoAnimationTimer = setInterval(() => {
      this._advanceLogoAnimation();
    }, speed);
  }

  /**
   * Stop the logo animation
   */
  stopLogoAnimation(): void {
    if (this._logoAnimationTimer !== null) {
      clearInterval(this._logoAnimationTimer);
      this._logoAnimationTimer = null;
    }
  }

  /**
   * Check if logo animation is complete
   */
  isLogoAnimationComplete(): boolean {
    return this._logoAnimationComplete;
  }

  /**
   * Draw the logo at current animation frame
   */
  private _advanceLogoAnimation(): void {
    const logoW = CanvasElement.LOGO_WIDTH;
    const logoH = CanvasElement.LOGO_HEIGHT;
    const logo = CanvasElement.MELKER_LOGO;

    // Calculate scale to fit the logo in the canvas
    const aspectRatio = this.getPixelAspectRatio();
    const maxLogoW = Math.floor(this._bufferWidth * 0.95);
    const maxLogoH = Math.floor(this._bufferHeight * 0.95);

    // Account for aspect ratio in scaling
    const scaleX = Math.floor(maxLogoW / (logoW / aspectRatio));
    const scaleY = Math.floor(maxLogoH / logoH);
    const scale = Math.max(1, Math.min(scaleX, scaleY));

    // Scaled dimensions (corrected for aspect ratio)
    const scaledW = Math.floor((logoW * scale) / aspectRatio);
    const scaledH = logoH * scale;

    // Center position
    const startX = Math.floor((this._bufferWidth - scaledW) / 2);
    const startY = Math.floor((this._bufferHeight - scaledH) / 2);

    // Total frames needed (one per row of scaled logo)
    const totalFrames = scaledH + scaledW; // Extra frames for full slide-in

    // Get logo colors based on theme
    const { fgColor, bgColor } = this._getLogoColors();
    this.setColor(fgColor);
    this.props.backgroundColor = bgColor;

    // Clear the canvas for this frame
    this.clear();

    // Draw rows that have animated in
    for (let scaledRow = 0; scaledRow < scaledH; scaledRow++) {
      const logoRow = Math.floor(scaledRow / scale);
      if (logoRow >= logoH) continue;

      const rowPattern = logo[logoRow];

      // Calculate how far this row has shifted in
      // Alternate direction: even rows from left, odd rows from right
      const rowDelay = scaledRow; // Each row starts one frame after the previous
      const framesIntoAnimation = this._logoAnimationFrame - rowDelay;

      if (framesIntoAnimation < 0) continue; // Row hasn't started yet

      // Calculate shift offset (starts off-screen, moves to final position)
      const fromRight = scaledRow % 2 === 1;
      const maxShift = scaledW;
      const currentShift = Math.min(framesIntoAnimation * 2, maxShift); // 2 pixels per frame

      for (let scaledCol = 0; scaledCol < scaledW; scaledCol++) {
        // Map scaled column to logo column (simple linear mapping)
        const logoCol = Math.floor((scaledCol * logoW) / scaledW);
        if (logoCol >= logoW) continue;

        // Check if this pixel is set in the logo
        const bitPos = logoW - 1 - logoCol;
        const isSet = (rowPattern >> bitPos) & 1;

        if (isSet) {
          // Calculate final x position
          let drawX: number;
          if (fromRight) {
            // Slide in from right
            const finalX = startX + scaledCol;
            const offsetX = maxShift - currentShift;
            drawX = finalX + offsetX;
          } else {
            // Slide in from left
            const finalX = startX + scaledCol;
            const offsetX = maxShift - currentShift;
            drawX = finalX - offsetX;
          }

          const drawY = startY + scaledRow;

          // Only draw if in bounds
          if (drawX >= 0 && drawX < this._bufferWidth) {
            this.setPixel(drawX, drawY, true);
          }
        }
      }
    }

    this._logoAnimationFrame++;

    // Check if animation is complete
    if (this._logoAnimationFrame >= totalFrames + 10) { // Extra frames for settling
      this._logoAnimationComplete = true;
      this.stopLogoAnimation();
      // Draw final complete logo
      this._drawLogoComplete();
    }

    // Request re-render
    if (this._logoRequestRender) {
      this._logoRequestRender();
    }
  }

  /**
   * Draw the complete logo (no animation)
   */
  private _drawLogoComplete(): void {
    const logoW = CanvasElement.LOGO_WIDTH;
    const logoH = CanvasElement.LOGO_HEIGHT;
    const logo = CanvasElement.MELKER_LOGO;

    const aspectRatio = this.getPixelAspectRatio();
    const maxLogoW = Math.floor(this._bufferWidth * 0.95);
    const maxLogoH = Math.floor(this._bufferHeight * 0.95);

    const scaleX = Math.floor(maxLogoW / (logoW / aspectRatio));
    const scaleY = Math.floor(maxLogoH / logoH);
    const scale = Math.max(1, Math.min(scaleX, scaleY));

    const scaledW = Math.floor((logoW * scale) / aspectRatio);
    const scaledH = logoH * scale;

    const startX = Math.floor((this._bufferWidth - scaledW) / 2);
    const startY = Math.floor((this._bufferHeight - scaledH) / 2);

    // Get logo colors based on theme
    const { fgColor, bgColor } = this._getLogoColors();
    this.setColor(fgColor);
    this.props.backgroundColor = bgColor;
    this.clear();

    for (let scaledRow = 0; scaledRow < scaledH; scaledRow++) {
      const logoRow = Math.floor(scaledRow / scale);
      if (logoRow >= logoH) continue;

      const rowPattern = logo[logoRow];

      for (let scaledCol = 0; scaledCol < scaledW; scaledCol++) {
        // Map scaled column to logo column (simple linear mapping)
        const logoCol = Math.floor((scaledCol * logoW) / scaledW);
        if (logoCol >= logoW) continue;

        const bitPos = logoW - 1 - logoCol;
        const isSet = (rowPattern >> bitPos) & 1;

        if (isSet) {
          const drawX = startX + scaledCol;
          const drawY = startY + scaledRow;
          this.setPixel(drawX, drawY, true);
        }
      }
    }
  }

  /**
   * Draw the Melker logo without animation
   */
  drawLogo(): void {
    this._drawLogoComplete();
  }

  /**
   * Convert 2x3 pixel block to sextant character
   */
  private _pixelsToSextant(pixels: boolean[]): string {
    // Map 2x3 pixels to 6-bit pattern based on Unicode sextant standard
    // pixels array layout: [0,1] (top row), [2,3] (middle row), [4,5] (bottom row)
    //                     [0,1] = [top-left, top-right]
    //                     [2,3] = [middle-left, middle-right]
    //                     [4,5] = [bottom-left, bottom-right]
    // Sextant bit pattern: bit 0 = bottom-right, bit 1 = bottom-left, bit 2 = middle-right,
    //                     bit 3 = middle-left, bit 4 = top-right, bit 5 = top-left
    let pattern = 0;
    if (pixels[5]) pattern |= 0b000001; // bottom-right
    if (pixels[4]) pattern |= 0b000010; // bottom-left
    if (pixels[3]) pattern |= 0b000100; // middle-right
    if (pixels[2]) pattern |= 0b001000; // middle-left
    if (pixels[1]) pattern |= 0b010000; // top-right
    if (pixels[0]) pattern |= 0b100000; // top-left

    return PIXEL_TO_CHAR[pattern];
  }

  // Pre-allocated buffers for quantization (avoid GC pressure)
  private _qPixels: boolean[] = [false, false, false, false, false, false];
  private _qBrightness: number[] = [0, 0, 0, 0, 0, 0];
  private _qFgColor = 0;
  private _qBgColor = 0;

  /**
   * Quantize 6 colors into two groups (foreground/background) for sextant rendering.
   * Optimized version using median brightness split - avoids sorting and allocations.
   */
  private _quantizeBlockColors(colors: number[]): {
    pixels: boolean[];
    fgColor: string | undefined;
    bgColor: string | undefined;
  } {
    // Calculate brightness for each pixel inline (avoid function call overhead)
    let validCount = 0;
    let totalBrightness = 0;
    let minBright = 1000, maxBright = -1;
    let firstColor = 0;
    let allSame = true;

    for (let i = 0; i < 6; i++) {
      const color = colors[i];
      this._qPixels[i] = false;
      if (color !== TRANSPARENT) {
        // Inline brightness: (r*77 + g*150 + b*29) >> 8 approximates 0.299r + 0.587g + 0.114b
        const r = (color >> 24) & 0xFF;
        const g = (color >> 16) & 0xFF;
        const b = (color >> 8) & 0xFF;
        const bright = (r * 77 + g * 150 + b * 29) >> 8;
        this._qBrightness[i] = bright;
        totalBrightness += bright;
        if (bright < minBright) minBright = bright;
        if (bright > maxBright) maxBright = bright;
        if (validCount === 0) {
          firstColor = color;
        } else if (color !== firstColor) {
          allSame = false;
        }
        validCount++;
      } else {
        this._qBrightness[i] = -1; // Mark as invalid
      }
    }

    // No valid colors
    if (validCount === 0) {
      return { pixels: this._qPixels, fgColor: undefined, bgColor: undefined };
    }

    // All same color - all pixels "on" with that color, use same for fg and bg
    if (allSame) {
      for (let i = 0; i < 6; i++) {
        if (colors[i] !== TRANSPARENT) this._qPixels[i] = true;
      }
      const color = rgbaToCss(firstColor);
      return { pixels: this._qPixels, fgColor: color, bgColor: color };
    }

    // Use median brightness as threshold (faster than sorting)
    const threshold = (minBright + maxBright) >> 1;

    // Split into bright (fg) and dark (bg) groups
    let fgCount = 0, bgCount = 0;
    this._qFgColor = 0;
    this._qBgColor = 0;

    for (let i = 0; i < 6; i++) {
      const bright = this._qBrightness[i];
      if (bright < 0) continue; // Skip transparent

      if (bright >= threshold) {
        this._qPixels[i] = true;
        fgCount++;
        // Track color for averaging (use first encountered for speed)
        if (this._qFgColor === 0) this._qFgColor = colors[i];
      } else {
        bgCount++;
        if (this._qBgColor === 0) this._qBgColor = colors[i];
      }
    }

    // If all went to one group, use midpoint split
    if (fgCount === 0 || bgCount === 0) {
      const midThreshold = totalBrightness / validCount;
      fgCount = bgCount = 0;
      this._qFgColor = this._qBgColor = 0;
      for (let i = 0; i < 6; i++) {
        const bright = this._qBrightness[i];
        if (bright < 0) continue;
        if (bright >= midThreshold) {
          this._qPixels[i] = true;
          if (this._qFgColor === 0) this._qFgColor = colors[i];
          fgCount++;
        } else {
          this._qPixels[i] = false;
          if (this._qBgColor === 0) this._qBgColor = colors[i];
          bgCount++;
        }
      }
    }

    // Ensure we always have both colors set to avoid white defaults
    // If one group is empty, use the other group's color for both
    if (this._qFgColor === 0 && this._qBgColor !== 0) {
      this._qFgColor = this._qBgColor;
    } else if (this._qBgColor === 0 && this._qFgColor !== 0) {
      this._qBgColor = this._qFgColor;
    }

    return {
      pixels: this._qPixels,
      fgColor: this._qFgColor !== 0 ? rgbaToCss(this._qFgColor) : undefined,
      bgColor: this._qBgColor !== 0 ? rgbaToCss(this._qBgColor) : undefined
    };
  }

  /**
   * Check if canvas needs re-rendering
   */
  private _hasChanged(): boolean {
    if (!this._isDirty) return false;

    // Compare with previous color buffer
    for (let i = 0; i < this._colorBuffer.length; i++) {
      if (this._colorBuffer[i] !== this._previousColorBuffer[i]) {
        return true;
      }
    }
    return false;
  }

  /**
   * Mark canvas as clean and update previous buffer.
   * Uses double-buffering pattern: swap pointers (O(1)) then optionally copy.
   * Protected so subclasses that fully rewrite each frame can skip the copy.
   */
  protected _markClean(): void {
    // Double-buffering: swap buffer pointers (O(1))
    // After swap, _previousColorBuffer holds the frame we just rendered
    const tempColor = this._colorBuffer;
    this._colorBuffer = this._previousColorBuffer;
    this._previousColorBuffer = tempColor;

    // For incremental drawing, copy previous → current to preserve state.
    // Subclasses that fully rewrite (like video overlays) can override to skip.
    this._copyPreviousToCurrent();

    this._isDirty = false;
  }

  /**
   * Copy previous buffer content to current buffer.
   * Override in subclasses that fully rewrite each frame to skip this O(n) copy.
   */
  protected _copyPreviousToCurrent(): void {
    this._colorBuffer.set(this._previousColorBuffer);
  }

  /**
   * Invalidate the dither cache, forcing re-computation on next render.
   */
  private _invalidateDitherCache(): void {
    this._ditherCacheValid = false;
  }

  /**
   * Prepare a dithered buffer by compositing drawing and image layers,
   * then applying the specified dithering algorithm.
   * Returns null if dithering is not enabled, allowing original behavior.
   */
  private _prepareDitheredBuffer(): Uint8Array | null {
    let ditherMode = this.props.dither;

    // Handle 'auto' mode based on current theme
    if (ditherMode === 'auto') {
      const theme = getCurrentTheme();
      if (theme.type === 'fullcolor') {
        // Fullcolor theme: no dithering needed
        return null;
      } else {
        // bw, gray, or color themes: use sierra-stable with 1 bit
        ditherMode = (Deno.env.get("MELKER_AUTO_DITHER") || 'sierra-stable') as DitherMode;
        // Note: ditherBits will default to 1 below if not specified
      }
    }

    // No dithering if not specified or explicitly disabled
    // Note: !ditherMode handles false, undefined, and empty string
    if (!ditherMode || ditherMode === 'none') {
      return null;
    }

    // Invalidate cache if content changed (drawing methods set _isDirty)
    if (this._isDirty) {
      this._ditherCacheValid = false;
    }

    // Check if dither settings changed
    if (this._lastDitherMode !== ditherMode || this._lastDitherBits !== this.props.ditherBits) {
      this._ditherCacheValid = false;
      this._lastDitherMode = ditherMode;
      this._lastDitherBits = this.props.ditherBits;
    }

    // Return cached result if still valid
    if (this._ditherCacheValid && this._ditherCache) {
      return this._ditherCache;
    }

    const bufW = this._bufferWidth;
    const bufH = this._bufferHeight;
    const bufferSize = bufW * bufH;

    // Allocate or reuse cache buffer (RGBA format: 4 bytes per pixel)
    if (!this._ditherCache || this._ditherCache.length !== bufferSize * 4) {
      this._ditherCache = new Uint8Array(bufferSize * 4);
    }

    const cache = this._ditherCache;

    // Composite drawing layer over image layer into RGBA buffer
    for (let i = 0; i < bufferSize; i++) {
      const drawingColor = this._colorBuffer[i];
      const imageColor = this._imageColorBuffer[i];
      const dstIdx = i * 4;

      let color: number;
      if (drawingColor !== TRANSPARENT) {
        // Drawing layer takes priority
        color = drawingColor;
      } else if (imageColor !== TRANSPARENT) {
        // Fall back to image layer
        color = imageColor;
      } else {
        // Transparent - use background or fully transparent
        const bgColor = this.props.backgroundColor;
        if (bgColor) {
          color = cssToRgba(bgColor);
        } else {
          // Fully transparent
          cache[dstIdx] = 0;
          cache[dstIdx + 1] = 0;
          cache[dstIdx + 2] = 0;
          cache[dstIdx + 3] = 0;
          continue;
        }
      }

      // Unpack RGBA from packed uint32
      const rgba = unpackRGBA(color);
      cache[dstIdx] = rgba.r;
      cache[dstIdx + 1] = rgba.g;
      cache[dstIdx + 2] = rgba.b;
      cache[dstIdx + 3] = rgba.a;
    }

    // Apply dithering algorithm
    const bits = this.props.ditherBits ?? 1; // Default to 1 bit (B&W)

    if (ditherMode === 'sierra-stable' || ditherMode === true) {
      applySierraStableDither(cache, bufW, bufH, bits);
    } else if (ditherMode === 'floyd-steinberg') {
      applyFloydSteinbergDither(cache, bufW, bufH, bits);
    } else if (ditherMode === 'ordered') {
      applyOrderedDither(cache, bufW, bufH, bits);
    }
    // 'none' case already handled above

    this._ditherCacheValid = true;
    return cache;
  }

  /**
   * Downscale the backing buffer and convert to sextant characters with color
   * Optimized to minimize memory allocations by using pre-allocated arrays
   */
  private _renderToTerminal(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer): void {
    const terminalWidth = Math.min(this.props.width, bounds.width);
    const terminalHeight = Math.min(this.props.height, bounds.height);
    const bufW = this._bufferWidth;
    const bufH = this._bufferHeight;
    const scale = this._scale;
    const halfScale = scale >> 1;

    // Check for dithered rendering mode
    const ditheredBuffer = this._prepareDitheredBuffer();
    if (ditheredBuffer) {
      // Use dithered rendering path
      this._renderDitheredToTerminal(bounds, style, buffer, ditheredBuffer);
      return;
    }

    // Non-dithered rendering path (original behavior)
    // Use pre-allocated arrays
    const drawingPixels = this._rtDrawingPixels;
    const drawingColors = this._rtDrawingColors;
    const imagePixels = this._rtImagePixels;
    const imageColors = this._rtImageColors;
    const sextantPixels = this._rtSextantPixels;
    const compositePixels = this._rtCompositePixels;
    const compositeColors = this._rtCompositeColors;
    const isDrawing = this._rtIsDrawing;

    // Pre-compute base style properties
    const hasStyleFg = style.foreground !== undefined;
    const hasStyleBg = style.background !== undefined;
    const propsBg = this.props.backgroundColor;

    for (let ty = 0; ty < terminalHeight; ty++) {
      const baseBufferY = ty * 3 * scale;

      for (let tx = 0; tx < terminalWidth; tx++) {
        const baseBufferX = tx * 2 * scale;

        // Sample 2x3 block - track drawing and image layers separately
        // Unrolled for performance (avoid nested loop overhead)
        let hasDrawingOn = false;
        let hasImageOn = false;

        // Row 0
        {
          const bufferY = baseBufferY + halfScale;
          const rowOffset = bufferY * bufW;

          // Pixel (0,0)
          const bufferX0 = baseBufferX + halfScale;
          if (bufferX0 >= 0 && bufferX0 < bufW && bufferY >= 0 && bufferY < bufH) {
            const bufIndex = rowOffset + bufferX0;
            drawingColors[0] = this._colorBuffer[bufIndex];
            drawingPixels[0] = drawingColors[0] !== TRANSPARENT;
            imageColors[0] = this._imageColorBuffer[bufIndex];
            imagePixels[0] = imageColors[0] !== TRANSPARENT;
          } else {
            drawingPixels[0] = false;
            drawingColors[0] = TRANSPARENT;
            imagePixels[0] = false;
            imageColors[0] = TRANSPARENT;
          }
          if (drawingPixels[0] && drawingColors[0] !== TRANSPARENT && drawingColors[0] !== DEFAULT_FG) hasDrawingOn = true;
          if (imagePixels[0] && imageColors[0] !== TRANSPARENT) hasImageOn = true;

          // Pixel (1,0)
          const bufferX1 = baseBufferX + scale + halfScale;
          if (bufferX1 >= 0 && bufferX1 < bufW && bufferY >= 0 && bufferY < bufH) {
            const bufIndex = rowOffset + bufferX1;
            drawingColors[1] = this._colorBuffer[bufIndex];
            drawingPixels[1] = drawingColors[1] !== TRANSPARENT;
            imageColors[1] = this._imageColorBuffer[bufIndex];
            imagePixels[1] = imageColors[1] !== TRANSPARENT;
          } else {
            drawingPixels[1] = false;
            drawingColors[1] = TRANSPARENT;
            imagePixels[1] = false;
            imageColors[1] = TRANSPARENT;
          }
          if (drawingPixels[1] && drawingColors[1] !== TRANSPARENT && drawingColors[1] !== DEFAULT_FG) hasDrawingOn = true;
          if (imagePixels[1] && imageColors[1] !== TRANSPARENT) hasImageOn = true;
        }

        // Row 1
        {
          const bufferY = baseBufferY + scale + halfScale;
          const rowOffset = bufferY * bufW;

          // Pixel (0,1)
          const bufferX0 = baseBufferX + halfScale;
          if (bufferX0 >= 0 && bufferX0 < bufW && bufferY >= 0 && bufferY < bufH) {
            const bufIndex = rowOffset + bufferX0;
            drawingColors[2] = this._colorBuffer[bufIndex];
            drawingPixels[2] = drawingColors[2] !== TRANSPARENT;
            imageColors[2] = this._imageColorBuffer[bufIndex];
            imagePixels[2] = imageColors[2] !== TRANSPARENT;
          } else {
            drawingPixels[2] = false;
            drawingColors[2] = TRANSPARENT;
            imagePixels[2] = false;
            imageColors[2] = TRANSPARENT;
          }
          if (drawingPixels[2] && drawingColors[2] !== TRANSPARENT && drawingColors[2] !== DEFAULT_FG) hasDrawingOn = true;
          if (imagePixels[2] && imageColors[2] !== TRANSPARENT) hasImageOn = true;

          // Pixel (1,1)
          const bufferX1 = baseBufferX + scale + halfScale;
          if (bufferX1 >= 0 && bufferX1 < bufW && bufferY >= 0 && bufferY < bufH) {
            const bufIndex = rowOffset + bufferX1;
            drawingColors[3] = this._colorBuffer[bufIndex];
            drawingPixels[3] = drawingColors[3] !== TRANSPARENT;
            imageColors[3] = this._imageColorBuffer[bufIndex];
            imagePixels[3] = imageColors[3] !== TRANSPARENT;
          } else {
            drawingPixels[3] = false;
            drawingColors[3] = TRANSPARENT;
            imagePixels[3] = false;
            imageColors[3] = TRANSPARENT;
          }
          if (drawingPixels[3] && drawingColors[3] !== TRANSPARENT && drawingColors[3] !== DEFAULT_FG) hasDrawingOn = true;
          if (imagePixels[3] && imageColors[3] !== TRANSPARENT) hasImageOn = true;
        }

        // Row 2
        {
          const bufferY = baseBufferY + 2 * scale + halfScale;
          const rowOffset = bufferY * bufW;

          // Pixel (0,2)
          const bufferX0 = baseBufferX + halfScale;
          if (bufferX0 >= 0 && bufferX0 < bufW && bufferY >= 0 && bufferY < bufH) {
            const bufIndex = rowOffset + bufferX0;
            drawingColors[4] = this._colorBuffer[bufIndex];
            drawingPixels[4] = drawingColors[4] !== TRANSPARENT;
            imageColors[4] = this._imageColorBuffer[bufIndex];
            imagePixels[4] = imageColors[4] !== TRANSPARENT;
          } else {
            drawingPixels[4] = false;
            drawingColors[4] = TRANSPARENT;
            imagePixels[4] = false;
            imageColors[4] = TRANSPARENT;
          }
          if (drawingPixels[4] && drawingColors[4] !== TRANSPARENT && drawingColors[4] !== DEFAULT_FG) hasDrawingOn = true;
          if (imagePixels[4] && imageColors[4] !== TRANSPARENT) hasImageOn = true;

          // Pixel (1,2)
          const bufferX1 = baseBufferX + scale + halfScale;
          if (bufferX1 >= 0 && bufferX1 < bufW && bufferY >= 0 && bufferY < bufH) {
            const bufIndex = rowOffset + bufferX1;
            drawingColors[5] = this._colorBuffer[bufIndex];
            drawingPixels[5] = drawingColors[5] !== TRANSPARENT;
            imageColors[5] = this._imageColorBuffer[bufIndex];
            imagePixels[5] = imageColors[5] !== TRANSPARENT;
          } else {
            drawingPixels[5] = false;
            drawingColors[5] = TRANSPARENT;
            imagePixels[5] = false;
            imageColors[5] = TRANSPARENT;
          }
          if (drawingPixels[5] && drawingColors[5] !== TRANSPARENT && drawingColors[5] !== DEFAULT_FG) hasDrawingOn = true;
          if (imagePixels[5] && imageColors[5] !== TRANSPARENT) hasImageOn = true;
        }

        let fgColor: string | undefined;
        let bgColor: string | undefined;

        if (hasDrawingOn && hasImageOn) {
          // Two-color optimization: drawing as fg, image as bg
          // Compute sextant pattern and find dominant colors inline
          let fgColorVal = 0;
          let bgColorVal = 0;

          for (let i = 0; i < 6; i++) {
            const isOn = drawingPixels[i] && drawingColors[i] !== TRANSPARENT && drawingColors[i] !== DEFAULT_FG;
            sextantPixels[i] = isOn;
            if (isOn && fgColorVal === 0) {
              fgColorVal = drawingColors[i];
            }
            if (imagePixels[i] && imageColors[i] !== TRANSPARENT && bgColorVal === 0) {
              bgColorVal = imageColors[i];
            }
          }

          if (fgColorVal !== 0) fgColor = rgbaToCss(fgColorVal);
          if (bgColorVal !== 0) bgColor = rgbaToCss(bgColorVal);

        } else if (hasImageOn && !hasDrawingOn) {
          // Image-only block: use color quantization for sextant detail
          this._quantizeBlockColorsInline(imageColors, sextantPixels);
          fgColor = this._qFgColor !== 0 ? rgbaToCss(this._qFgColor) : undefined;
          bgColor = this._qBgColor !== 0 ? rgbaToCss(this._qBgColor) : undefined;

        } else {
          // Standard compositing: drawing on top of image
          let fgColorVal = 0;
          let bgColorVal = 0;

          for (let i = 0; i < 6; i++) {
            if (drawingPixels[i] || (drawingColors[i] !== TRANSPARENT && drawingColors[i] !== DEFAULT_FG)) {
              compositePixels[i] = drawingPixels[i];
              compositeColors[i] = drawingColors[i];
              isDrawing[i] = true;
            } else {
              compositePixels[i] = imagePixels[i];
              compositeColors[i] = imageColors[i];
              isDrawing[i] = false;
            }
            sextantPixels[i] = compositePixels[i];

            // Find dominant colors inline
            const color = compositeColors[i];
            if (compositePixels[i]) {
              if (color !== TRANSPARENT && color !== DEFAULT_FG && fgColorVal === 0) {
                fgColorVal = color;
              }
            } else {
              if (color !== TRANSPARENT && bgColorVal === 0) {
                bgColorVal = color;
              }
            }
          }

          if (fgColorVal !== 0) fgColor = rgbaToCss(fgColorVal);
          if (bgColorVal !== 0) bgColor = rgbaToCss(bgColorVal);
        }

        // Convert pixels to sextant character
        // Sextant bit pattern: bit 0 = bottom-right[5], bit 1 = bottom-left[4],
        //                      bit 2 = middle-right[3], bit 3 = middle-left[2],
        //                      bit 4 = top-right[1], bit 5 = top-left[0]
        const pattern = (sextantPixels[5] ? 0b000001 : 0) |
                       (sextantPixels[4] ? 0b000010 : 0) |
                       (sextantPixels[3] ? 0b000100 : 0) |
                       (sextantPixels[2] ? 0b001000 : 0) |
                       (sextantPixels[1] ? 0b010000 : 0) |
                       (sextantPixels[0] ? 0b100000 : 0);
        const char = PIXEL_TO_CHAR[pattern];

        // Skip empty cells with no background
        if (char === ' ' && bgColor === undefined && !propsBg) {
          continue;
        }

        // Reuse cell style object to avoid allocation
        const cellStyle = this._rtCellStyle;
        cellStyle.foreground = fgColor ?? (hasStyleFg ? style.foreground : undefined);
        cellStyle.background = bgColor ?? propsBg ?? (hasStyleBg ? style.background : undefined);
        cellStyle.bold = style.bold;
        cellStyle.dim = style.dim;
        cellStyle.italic = style.italic;
        cellStyle.underline = style.underline;

        buffer.currentBuffer.setText(
          bounds.x + tx,
          bounds.y + ty,
          char,
          cellStyle
        );
      }
    }
  }

  /**
   * Render from dithered buffer to terminal.
   * Uses the pre-composited and dithered RGBA buffer for output.
   */
  private _renderDitheredToTerminal(
    bounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    ditheredBuffer: Uint8Array
  ): void {
    const terminalWidth = Math.min(this.props.width, bounds.width);
    const terminalHeight = Math.min(this.props.height, bounds.height);
    const bufW = this._bufferWidth;
    const bufH = this._bufferHeight;
    const scale = this._scale;
    const halfScale = scale >> 1;

    // Use pre-allocated arrays
    const sextantPixels = this._rtSextantPixels;
    const sextantColors = this._rtCompositeColors;

    // Pre-compute base style properties
    const hasStyleFg = style.foreground !== undefined;
    const hasStyleBg = style.background !== undefined;
    const propsBg = this.props.backgroundColor;

    for (let ty = 0; ty < terminalHeight; ty++) {
      const baseBufferY = ty * 3 * scale;

      for (let tx = 0; tx < terminalWidth; tx++) {
        const baseBufferX = tx * 2 * scale;

        // Sample 2x3 block from dithered buffer
        // The positions match the non-dithered path sampling
        const positions = [
          // Row 0: (0,0), (1,0)
          { x: baseBufferX + halfScale, y: baseBufferY + halfScale },
          { x: baseBufferX + scale + halfScale, y: baseBufferY + halfScale },
          // Row 1: (0,1), (1,1)
          { x: baseBufferX + halfScale, y: baseBufferY + scale + halfScale },
          { x: baseBufferX + scale + halfScale, y: baseBufferY + scale + halfScale },
          // Row 2: (0,2), (1,2)
          { x: baseBufferX + halfScale, y: baseBufferY + 2 * scale + halfScale },
          { x: baseBufferX + scale + halfScale, y: baseBufferY + 2 * scale + halfScale },
        ];

        let hasAnyPixel = false;

        for (let i = 0; i < 6; i++) {
          const pos = positions[i];
          if (pos.x >= 0 && pos.x < bufW && pos.y >= 0 && pos.y < bufH) {
            const bufIndex = pos.y * bufW + pos.x;
            const rgbaIdx = bufIndex * 4;
            const r = ditheredBuffer[rgbaIdx];
            const g = ditheredBuffer[rgbaIdx + 1];
            const b = ditheredBuffer[rgbaIdx + 2];
            const a = ditheredBuffer[rgbaIdx + 3];

            // Consider pixel "on" if not fully transparent
            // Note: black pixels are valid colors for dithering, don't treat as "off"
            const isOn = a >= 128;
            sextantPixels[i] = isOn;
            sextantColors[i] = isOn ? packRGBA(r, g, b, a) : TRANSPARENT;
            if (isOn) hasAnyPixel = true;
          } else {
            sextantPixels[i] = false;
            sextantColors[i] = TRANSPARENT;
          }
        }

        // Use quantization for color selection (same as image path)
        this._quantizeBlockColorsInline(sextantColors, sextantPixels);
        const fgColor = this._qFgColor !== 0 ? rgbaToCss(this._qFgColor) : undefined;
        const bgColor = this._qBgColor !== 0 ? rgbaToCss(this._qBgColor) : undefined;

        // Convert pixels to sextant character
        const pattern = (sextantPixels[5] ? 0b000001 : 0) |
                       (sextantPixels[4] ? 0b000010 : 0) |
                       (sextantPixels[3] ? 0b000100 : 0) |
                       (sextantPixels[2] ? 0b001000 : 0) |
                       (sextantPixels[1] ? 0b010000 : 0) |
                       (sextantPixels[0] ? 0b100000 : 0);
        const char = PIXEL_TO_CHAR[pattern];

        // Skip empty cells with no background
        if (char === ' ' && bgColor === undefined && !propsBg) {
          continue;
        }

        // Reuse cell style object to avoid allocation
        const cellStyle = this._rtCellStyle;
        cellStyle.foreground = fgColor ?? (hasStyleFg ? style.foreground : undefined);
        cellStyle.background = bgColor ?? propsBg ?? (hasStyleBg ? style.background : undefined);
        cellStyle.bold = style.bold;
        cellStyle.dim = style.dim;
        cellStyle.italic = style.italic;
        cellStyle.underline = style.underline;

        buffer.currentBuffer.setText(
          bounds.x + tx,
          bounds.y + ty,
          char,
          cellStyle
        );
      }
    }
  }

  /**
   * Inline version of _quantizeBlockColors that writes to pre-allocated arrays.
   * Uses averaged colors per group for better quality on gradients.
   * Results are stored in _qFgColor, _qBgColor, and the passed sextantPixels array.
   */
  private _quantizeBlockColorsInline(colors: number[], sextantPixels: boolean[]): void {
    // First pass: calculate brightness, find min/max, check if all same
    let validCount = 0;
    let totalBrightness = 0;
    let minBright = 1000, maxBright = -1;
    let firstColor = 0;
    let allSame = true;

    for (let i = 0; i < 6; i++) {
      const color = colors[i];
      sextantPixels[i] = false;
      if (color !== TRANSPARENT) {
        const r = (color >> 24) & 0xFF;
        const g = (color >> 16) & 0xFF;
        const b = (color >> 8) & 0xFF;
        const bright = (r * 77 + g * 150 + b * 29) >> 8;
        this._qBrightness[i] = bright;
        totalBrightness += bright;
        if (bright < minBright) minBright = bright;
        if (bright > maxBright) maxBright = bright;
        if (validCount === 0) {
          firstColor = color;
        } else if (color !== firstColor) {
          allSame = false;
        }
        validCount++;
      } else {
        this._qBrightness[i] = -1;
      }
    }

    if (validCount === 0) {
      this._qFgColor = 0;
      this._qBgColor = 0;
      return;
    }

    if (allSame) {
      for (let i = 0; i < 6; i++) {
        if (colors[i] !== TRANSPARENT) sextantPixels[i] = true;
      }
      this._qFgColor = firstColor;
      this._qBgColor = firstColor;
      return;
    }

    // Second pass: partition by threshold and accumulate color sums
    let threshold = (minBright + maxBright) >> 1;
    let fgR = 0, fgG = 0, fgB = 0, fgCount = 0;
    let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;

    for (let i = 0; i < 6; i++) {
      const bright = this._qBrightness[i];
      if (bright < 0) continue;

      const color = colors[i];
      const r = (color >> 24) & 0xFF;
      const g = (color >> 16) & 0xFF;
      const b = (color >> 8) & 0xFF;

      if (bright >= threshold) {
        sextantPixels[i] = true;
        fgR += r; fgG += g; fgB += b; fgCount++;
      } else {
        bgR += r; bgG += g; bgB += b; bgCount++;
      }
    }

    // If all went to one group, use mean brightness as threshold
    if (fgCount === 0 || bgCount === 0) {
      threshold = (totalBrightness / validCount) | 0;
      fgR = fgG = fgB = fgCount = 0;
      bgR = bgG = bgB = bgCount = 0;

      for (let i = 0; i < 6; i++) {
        const bright = this._qBrightness[i];
        if (bright < 0) continue;

        const color = colors[i];
        const r = (color >> 24) & 0xFF;
        const g = (color >> 16) & 0xFF;
        const b = (color >> 8) & 0xFF;

        if (bright >= threshold) {
          sextantPixels[i] = true;
          fgR += r; fgG += g; fgB += b; fgCount++;
        } else {
          sextantPixels[i] = false;
          bgR += r; bgG += g; bgB += b; bgCount++;
        }
      }
    }

    // Compute averaged colors
    if (fgCount > 0) {
      this._qFgColor = packRGBA(
        (fgR / fgCount) | 0,
        (fgG / fgCount) | 0,
        (fgB / fgCount) | 0,
        255
      );
    } else {
      this._qFgColor = 0;
    }

    if (bgCount > 0) {
      this._qBgColor = packRGBA(
        (bgR / bgCount) | 0,
        (bgG / bgCount) | 0,
        (bgB / bgCount) | 0,
        255
      );
    } else {
      this._qBgColor = 0;
    }

    // Fallback: if one group empty, use the other's color for both
    if (this._qFgColor === 0 && this._qBgColor !== 0) {
      this._qFgColor = this._qBgColor;
    } else if (this._qBgColor === 0 && this._qFgColor !== 0) {
      this._qBgColor = this._qFgColor;
    }
  }


  /**
   * Render the canvas to the terminal buffer
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Auto-load image from src prop if not already loaded/loading
    if (this.props.src && !this._loadedImage && !this._imageLoading && this._imageSrc !== this.props.src) {
      this.loadImage(this.props.src).then(() => {
        // Request re-render when image loads
        if (context.requestRender) {
          context.requestRender();
        }
      }).catch(() => {
        // Silently ignore load errors
      });
    }

    // Auto-start logo animation if logo prop is true
    if (this.props.logo && this._logoAnimationTimer === null && !this._logoAnimationComplete) {
      this.startLogoAnimation(context.requestRender);
    }

    // Call onPaint handler to allow user to update canvas content before rendering
    if (this.props.onPaint) {
      // Pass as event object for compatibility with string handlers in .melker files
      this.props.onPaint({ canvas: this, bounds });
    }

    // Always render to the buffer (buffer is rebuilt each frame)
    this._renderToTerminal(bounds, style, buffer);
    // Mark clean to track changes for next frame
    if (this._isDirty) {
      this._markClean();
    }
  }

  /**
   * Calculate intrinsic size for the canvas component
   * Returns available space for 'fill' styles to expand to container
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    const style = this.props.style || {};
    return {
      width: style.width === 'fill' ? context.availableSpace.width : this.props.width,
      height: style.height === 'fill' ? context.availableSpace.height : this.props.height
    };
  }

  /**
   * Get the actual pixel buffer dimensions
   */
  getBufferSize(): { width: number; height: number } {
    return {
      width: this._bufferWidth,
      height: this._bufferHeight
    };
  }

  /**
   * Get the pixel buffer width
   */
  getBufferWidth(): number {
    return this._bufferWidth;
  }

  /**
   * Get the pixel buffer height
   */
  getBufferHeight(): number {
    return this._bufferHeight;
  }

  /**
   * Force a re-render on next render cycle
   */
  markDirty(): void {
    this._isDirty = true;
  }

  /**
   * Check if canvas needs updating
   */
  isDirty(): boolean {
    return this._isDirty;
  }

  /**
   * Resize the canvas and reallocate buffers
   */
  setSize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid canvas size: ${width}x${height}`);
    }

    // Update props
    this.props.width = width;
    this.props.height = height;

    // Recalculate buffer dimensions
    this._bufferWidth = width * 2 * this._scale;
    this._bufferHeight = height * 3 * this._scale;

    // Reallocate color buffers
    const bufferSize = this._bufferWidth * this._bufferHeight;
    this._colorBuffer = new Uint32Array(bufferSize);
    this._previousColorBuffer = new Uint32Array(bufferSize);
    // Reallocate image background layer buffer
    this._imageColorBuffer = new Uint32Array(bufferSize);
    // Reset dither cache (will be reallocated on next render if needed)
    this._ditherCache = null;
    this._ditherCacheValid = false;

    // Clear the new canvas and mark as dirty for re-render
    this.markDirty();
    this.clear();
  }

  static validate(props: CanvasProps): boolean {
    if (typeof props.width !== 'number' || props.width <= 0) {
      return false;
    }
    if (typeof props.height !== 'number' || props.height <= 0) {
      return false;
    }
    if (props.scale !== undefined && (typeof props.scale !== 'number' || props.scale < 1)) {
      return false;
    }
    if (props.backgroundColor !== undefined && typeof props.backgroundColor !== 'string') {
      return false;
    }
    if (props.charAspectRatio !== undefined && (typeof props.charAspectRatio !== 'number' || props.charAspectRatio <= 0)) {
      return false;
    }
    return true;
  }
}

// Lint schema for canvas component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const canvasSchema: ComponentSchema = {
  description: 'Pixel graphics canvas using sextant characters',
  props: {
    width: { type: 'number', required: true, description: 'Canvas width in pixels' },
    height: { type: 'number', required: true, description: 'Canvas height in pixels' },
    scale: { type: 'number', description: 'Pixel scaling factor' },
    backgroundColor: { type: 'string', description: 'Background color' },
    charAspectRatio: { type: 'number', description: 'Character aspect ratio adjustment' },
    src: { type: 'string', description: 'Load image from file path' },
    dither: { type: ['string', 'boolean'], enum: ['auto', 'none', 'floyd-steinberg', 'floyd-steinberg-stable', 'sierra', 'sierra-stable', 'ordered'], description: 'Dithering algorithm (auto adapts to theme, none disables)' },
    ditherBits: { type: 'number', description: 'Color depth for dithering' },
    logo: { type: 'boolean', description: 'Enable animated Melker logo' },
    logoColor: { type: 'string', description: 'Logo color (default: cyan)' },
    logoSpeed: { type: 'number', description: 'Animation speed in ms per frame (default: 30)' },
    onPaint: { type: ['function', 'string'], description: 'Called when canvas needs repainting, receives event with {canvas, bounds}' },
  },
};

registerComponentSchema('canvas', canvasSchema);