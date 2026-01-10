// Canvas component for basic graphics rendering using Unicode sextant characters

import { Element, BaseProps, Renderable, Focusable, Interactive, Bounds, ComponentRenderContext, IntrinsicSizeContext, KeyPressEvent } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { TRANSPARENT, DEFAULT_FG, packRGBA, unpackRGBA, rgbaToCss, cssToRgba } from './color-utils.ts';
import { applySierraStableDither, applySierraDither, applyFloydSteinbergDither, applyFloydSteinbergStableDither, applyOrderedDither, type DitherMode } from '../video/dither.ts';
import { getCurrentTheme } from '../theme.ts';
import { getLogger } from '../logging.ts';
import { getGlobalPerformanceDialog } from '../performance-dialog.ts';
import { MelkerConfig } from '../config/mod.ts';
import * as Draw from './canvas-draw.ts';
import { shaderUtils, type ShaderResolution, type ShaderSource, type ShaderUtils, type ShaderCallback } from './canvas-shader.ts';
import { PIXEL_TO_CHAR } from './canvas-terminal.ts';
// Pure JS image decoders (stable API, no Deno internals)
import { decode as decodePng } from 'npm:fast-png';
import { decode as decodeJpeg } from 'npm:jpeg-js';
import { GifReader } from 'npm:omggif';

const logger = getLogger('canvas');

// Re-export color utilities for external use
export { packRGBA, unpackRGBA, rgbaToCss, cssToRgba } from './color-utils.ts';

// Re-export shader types for external use
export { type ShaderResolution, type ShaderSource, type ShaderUtils, type ShaderCallback } from './canvas-shader.ts';

export interface CanvasProps extends BaseProps {
  width: number;                     // Canvas width in terminal columns
  height: number;                    // Canvas height in terminal rows
  scale?: number;                    // Pixel scale factor (default: 1)
  backgroundColor?: string;          // Background color
  charAspectRatio?: number;          // Terminal char width/height ratio (default: 0.5)
  src?: string;                      // Image source path (loads and displays image)
  objectFit?: 'contain' | 'fill' | 'cover';  // How image fits: contain (default), fill (stretch), cover (crop)
  dither?: DitherMode | boolean;     // Dithering mode for images (e.g., 'sierra-stable' for B&W themes)
  ditherBits?: number;               // Bits per channel for dithering (1-8, default: 1 for B&W)
  onPaint?: (event: { canvas: CanvasElement; bounds: Bounds }) => void;  // Called when canvas needs repainting
  onShader?: ShaderCallback;         // Shader-style per-pixel callback (TypeScript, not GLSL)
  shaderFps?: number;                // Shader frame rate (default: 30)
  shaderRunTime?: number;            // Stop shader after this many ms, keep final frame as image
  onKeyPress?: (event: KeyPressEvent) => boolean | void;  // Called on keyboard events when focused
}

// Image data storage for loaded images
interface LoadedImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;  // RGB or RGBA pixel data
  bytesPerPixel: number;    // 3 for RGB, 4 for RGBA
}

export class CanvasElement extends Element implements Renderable, Focusable, Interactive {
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

  // Shader animation support
  private _shaderTimer: number | null = null;
  private _shaderStartTime: number = 0;
  private _shaderRequestRender: (() => void) | null = null;
  private _shaderResolution: ShaderResolution = { width: 0, height: 0, pixelAspect: 0.7 };
  private _shaderSource: ShaderSource | null = null;
  private _shaderFinished: boolean = false;  // True when stopped due to shaderRunTime

  // Mouse tracking for shader
  private _shaderMouseX: number = -1;  // Pixel coordinates (-1 = not over canvas)
  private _shaderMouseY: number = -1;
  private _shaderBounds: Bounds | null = null;  // Cache bounds for mouse coordinate conversion
  private _shaderPermissionWarned: boolean = false;  // Track if we've warned about missing permission
  private _shaderOutputBuffer: Uint32Array | null = null;  // Separate buffer for shader output (avoid race condition)
  private _shaderFrameInterval: number = 33;  // Target ms between frames
  private _shaderLastFrameTime: number = 0;  // Time of last frame start
  private _shaderRegisteredId: string | null = null;  // ID registered with performance dialog

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
      tabIndex: props.onKeyPress ? 0 : -1,  // Focusable if has keyboard handler
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

  // Focusable interface
  canReceiveFocus(): boolean {
    return !this.props.disabled && (this.props.tabIndex ?? -1) >= 0;
  }

  // Interactive interface
  isInteractive(): boolean {
    return !!this.props.onKeyPress;
  }

  /**
   * Handle keyboard events when canvas has focus
   */
  onKeyPress(event: KeyPressEvent): boolean {
    if (this.props.onKeyPress) {
      const result = this.props.onKeyPress(event);
      return result === true;
    }
    return false;
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
   * Set the current drawing color directly (without conversion)
   */
  setColorDirect(color: number): void {
    this._currentColor = color;
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
    Draw.drawRect(this, x, y, width, height);
  }

  /**
   * Draw a filled rectangle
   */
  fillRect(x: number, y: number, width: number, height: number): void {
    Draw.fillRect(this, x, y, width, height);
  }

  /**
   * Draw a line using Bresenham's algorithm
   */
  drawLine(x0: number, y0: number, x1: number, y1: number): void {
    Draw.drawLine(this, x0, y0, x1, y1);
  }

  /**
   * Draw a circle outline using midpoint circle algorithm
   */
  drawCircle(centerX: number, centerY: number, radius: number): void {
    Draw.drawCircle(this, centerX, centerY, radius);
  }

  /**
   * Draw an ellipse outline using midpoint ellipse algorithm
   */
  drawEllipse(centerX: number, centerY: number, radiusX: number, radiusY: number): void {
    Draw.drawEllipse(this, centerX, centerY, radiusX, radiusY);
  }

  // ============================================
  // Color Drawing Methods
  // ============================================

  /**
   * Draw a line with a specific color
   */
  drawLineColor(x0: number, y0: number, x1: number, y1: number, color: number | string): void {
    Draw.drawLineColor(this, x0, y0, x1, y1, color);
  }

  /**
   * Draw a rectangle outline with a specific color
   */
  drawRectColor(x: number, y: number, width: number, height: number, color: number | string): void {
    Draw.drawRectColor(this, x, y, width, height, color);
  }

  /**
   * Draw a filled rectangle with a specific color
   */
  fillRectColor(x: number, y: number, width: number, height: number, color: number | string): void {
    Draw.fillRectColor(this, x, y, width, height, color);
  }

  /**
   * Draw a circle outline with a specific color
   */
  drawCircleColor(centerX: number, centerY: number, radius: number, color: number | string): void {
    Draw.drawCircleColor(this, centerX, centerY, radius, color);
  }

  /**
   * Draw an ellipse outline with a specific color
   */
  drawEllipseColor(centerX: number, centerY: number, radiusX: number, radiusY: number, color: number | string): void {
    Draw.drawEllipseColor(this, centerX, centerY, radiusX, radiusY, color);
  }

  /**
   * Draw a visually correct circle with a specific color
   */
  drawCircleCorrectedColor(centerX: number, centerY: number, radius: number, color: number | string): void {
    Draw.drawCircleCorrectedColor(this, centerX, centerY, radius, color);
  }

  /**
   * Draw a visually correct square with a specific color
   */
  drawSquareCorrectedColor(x: number, y: number, size: number, color: number | string): void {
    Draw.drawSquareCorrectedColor(this, x, y, size, color);
  }

  /**
   * Fill a visually correct square with a specific color
   */
  fillSquareCorrectedColor(x: number, y: number, size: number, color: number | string): void {
    Draw.fillSquareCorrectedColor(this, x, y, size, color);
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

      // Detect format by magic bytes and decode using stable pure-JS libraries
      let width: number;
      let height: number;
      let pixelData: Uint8Array | Uint8ClampedArray;
      let bytesPerPixel: number;

      // PNG magic: 0x89 0x50 0x4E 0x47
      const isPng = imageBytes[0] === 0x89 && imageBytes[1] === 0x50 &&
                    imageBytes[2] === 0x4E && imageBytes[3] === 0x47;
      // JPEG magic: 0xFF 0xD8 0xFF
      const isJpeg = imageBytes[0] === 0xFF && imageBytes[1] === 0xD8 && imageBytes[2] === 0xFF;
      // GIF magic: GIF87a or GIF89a
      const isGif = imageBytes[0] === 0x47 && imageBytes[1] === 0x49 && imageBytes[2] === 0x46 &&
                    imageBytes[3] === 0x38 && (imageBytes[4] === 0x37 || imageBytes[4] === 0x39) &&
                    imageBytes[5] === 0x61;

      if (isPng) {
        const decoded = decodePng(imageBytes);
        width = decoded.width;
        height = decoded.height;
        bytesPerPixel = decoded.channels; // 3 for RGB, 4 for RGBA
        // Handle 16-bit PNG by converting to 8-bit
        if (decoded.depth === 16) {
          const data16 = decoded.data as Uint16Array;
          pixelData = new Uint8Array(data16.length);
          for (let i = 0; i < data16.length; i++) {
            pixelData[i] = data16[i] >> 8; // Take high byte
          }
        } else {
          pixelData = decoded.data as Uint8Array;
        }
      } else if (isJpeg) {
        const decoded = decodeJpeg(imageBytes, { useTArray: true, formatAsRGBA: true });
        width = decoded.width;
        height = decoded.height;
        bytesPerPixel = 4; // jpeg-js with formatAsRGBA always gives RGBA
        pixelData = decoded.data;
      } else if (isGif) {
        const gifReader = new GifReader(imageBytes);
        width = gifReader.width;
        height = gifReader.height;
        bytesPerPixel = 4; // GIF decoder outputs RGBA
        pixelData = new Uint8Array(width * height * 4);
        gifReader.decodeAndBlitFrameRGBA(0, pixelData); // Decode first frame
      } else {
        throw new Error(`Unsupported image format. Supported: PNG, JPEG, GIF`);
      }

      // Store the loaded image
      this._loadedImage = {
        width,
        height,
        data: new Uint8ClampedArray(pixelData),
        bytesPerPixel,
      };

      // Render the image to the canvas
      this._renderImageToBuffer();

    } catch (error) {
      logger.error("failed loadIimage, resolvedSrc " + resolvedSrc + " " + error);
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

    // Calculate scaling based on objectFit mode
    const pixelAspect = this.getPixelAspectRatio();
    const visualBufW = bufW * pixelAspect;
    const objectFit = this.props.objectFit ?? 'contain';

    let scaledW: number;
    let scaledH: number;
    let offsetX: number;
    let offsetY: number;

    if (objectFit === 'fill') {
      // Stretch to fill entire buffer (may distort aspect ratio)
      scaledW = bufW;
      scaledH = bufH;
      offsetX = 0;
      offsetY = 0;
    } else if (objectFit === 'cover') {
      // Scale to cover entire buffer, cropping if needed
      const scaleX = visualBufW / img.width;
      const scaleY = bufH / img.height;
      const scale = Math.max(scaleX, scaleY);
      scaledW = Math.floor(img.width * scale / pixelAspect);
      scaledH = Math.floor(img.height * scale);
      // Center the crop
      offsetX = Math.floor((bufW - scaledW) / 2);
      offsetY = Math.floor((bufH - scaledH) / 2);
    } else {
      // 'contain' - fit while maintaining aspect ratio, center
      const scaleX = visualBufW / img.width;
      const scaleY = bufH / img.height;
      const scale = Math.min(scaleX, scaleY);
      scaledW = Math.floor(img.width * scale / pixelAspect);
      scaledH = Math.floor(img.height * scale);
      // Center the image
      offsetX = Math.floor((bufW - scaledW) / 2);
      offsetY = Math.floor((bufH - scaledH) / 2);
    }

    // Clear the image background buffer (not the drawing layer)
    this._imageColorBuffer.fill(TRANSPARENT);

    // First, create a scaled RGBA buffer for the image
    const scaledData = new Uint8Array(scaledW * scaledH * 4);

    // Sample and scale the image
    const bpp = img.bytesPerPixel; // 3 for RGB, 4 for RGBA

    for (let y = 0; y < scaledH; y++) {
      for (let x = 0; x < scaledW; x++) {
        // Map buffer coordinates to image coordinates
        const imgX = (x / scaledW) * img.width;
        const imgY = (y / scaledH) * img.height;

        // Nearest neighbor sampling
        const srcX = Math.floor(imgX);
        const srcY = Math.floor(imgY);

        // Get pixel color from image (using correct bytes per pixel)
        const srcIdx = (srcY * img.width + srcX) * bpp;
        const dstIdx = (y * scaledW + x) * 4;

        scaledData[dstIdx] = img.data[srcIdx];         // R
        scaledData[dstIdx + 1] = img.data[srcIdx + 1]; // G
        scaledData[dstIdx + 2] = img.data[srcIdx + 2]; // B
        // Alpha: use from data if RGBA, otherwise assume fully opaque
        scaledData[dstIdx + 3] = bpp === 4 ? img.data[srcIdx + 3] : 255;
      }
    }

    // Apply dithering if enabled (for static image loading path)
    const ditherMode = this.props.dither;
    const bits = this.props.ditherBits ?? 1;
    if (ditherMode === 'sierra-stable' || ditherMode === true) {
      applySierraStableDither(scaledData, scaledW, scaledH, bits);
    } else if (ditherMode === 'sierra') {
      applySierraDither(scaledData, scaledW, scaledH, bits);
    } else if (ditherMode === 'floyd-steinberg') {
      applyFloydSteinbergDither(scaledData, scaledW, scaledH, bits);
    } else if (ditherMode === 'floyd-steinberg-stable') {
      applyFloydSteinbergStableDither(scaledData, scaledW, scaledH, bits);
    } else if (ditherMode === 'ordered') {
      applyOrderedDither(scaledData, scaledW, scaledH, bits);
    }

    // Get background color for alpha blending (default to black if not specified)
    let bgR = 0, bgG = 0, bgB = 0;
    const bgColorProp = this.props.backgroundColor;
    if (bgColorProp) {
      const bg = unpackRGBA(cssToRgba(bgColorProp));
      bgR = bg.r;
      bgG = bg.g;
      bgB = bg.b;
    }

    // Render the scaled (and possibly dithered) image to the buffer
    for (let y = 0; y < scaledH; y++) {
      for (let x = 0; x < scaledW; x++) {
        const srcIdx = (y * scaledW + x) * 4;
        let r = scaledData[srcIdx];
        let g = scaledData[srcIdx + 1];
        let b = scaledData[srcIdx + 2];
        const a = scaledData[srcIdx + 3];

        // Skip fully transparent pixels (alpha < 128)
        if (a < 128) continue;

        // Pre-blend semi-transparent pixels with background color
        // (Terminal cells can't do true alpha blending)
        if (a < 255) {
          const alpha = a / 255;
          const invAlpha = 1 - alpha;
          r = Math.round(r * alpha + bgR * invAlpha);
          g = Math.round(g * alpha + bgG * invAlpha);
          b = Math.round(b * alpha + bgB * invAlpha);
        }

        // Set the pixel in the image background buffer (now fully opaque)
        const bufX = offsetX + x;
        const bufY = offsetY + y;

        if (bufX >= 0 && bufX < bufW && bufY >= 0 && bufY < bufH) {
          const index = bufY * bufW + bufX;
          this._imageColorBuffer[index] = packRGBA(r, g, b, 255);
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
  getImageColorBuffer(): Uint32Array {
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
   * Set a pixel in the image background buffer (public version)
   * Writes to the same buffer as video, bypassing the drawing layer.
   * @param x X coordinate in buffer space
   * @param y Y coordinate in buffer space
   * @param color CSS color string or packed RGBA value
   */
  setImagePixelColor(x: number, y: number, color: number | string): void {
    const bufW = this._bufferWidth;
    const bufH = this._bufferHeight;
    if (x >= 0 && x < bufW && y >= 0 && y < bufH) {
      const index = y * bufW + x;
      const colorValue = typeof color === 'string' ? cssToRgba(color) : color;
      this._imageColorBuffer[index] = colorValue;
      this._isDirty = true;
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
    Draw.drawCircleCorrected(this, centerX, centerY, radius);
  }

  /**
   * Draw a visually correct square (appears square on screen).
   * Internally adjusts width to compensate for pixel aspect ratio.
   */
  drawSquareCorrected(x: number, y: number, size: number): void {
    Draw.drawSquareCorrected(this, x, y, size);
  }

  /**
   * Draw a visually correct filled square (appears square on screen).
   */
  fillSquareCorrected(x: number, y: number, size: number): void {
    Draw.fillSquareCorrected(this, x, y, size);
  }

  /**
   * Draw a line with aspect-corrected coordinates.
   * Input coordinates are in "visual" space where 1 unit = same distance in both axes.
   */
  drawLineCorrected(x0: number, y0: number, x1: number, y1: number): void {
    Draw.drawLineCorrected(this, x0, y0, x1, y1);
  }

  /**
   * Convert visual coordinates to pixel coordinates.
   * Visual coordinates have equal units in both dimensions.
   * @returns [pixelX, pixelY]
   */
  visualToPixel(visualX: number, visualY: number): [number, number] {
    return Draw.visualToPixel(this, visualX, visualY);
  }

  /**
   * Convert pixel coordinates to visual coordinates.
   * @returns [visualX, visualY]
   */
  pixelToVisual(pixelX: number, pixelY: number): [number, number] {
    return Draw.pixelToVisual(this, pixelX, pixelY);
  }

  /**
   * Get buffer size in visual units (where 1 unit = same distance in both axes).
   * Useful for centering and positioning with corrected coordinates.
   */
  getVisualSize(): { width: number; height: number } {
    return Draw.getVisualSize(this);
  }

  // ============================================
  // Shader Animation Methods
  // ============================================

  /**
   * Start the shader animation loop.
   * The onShader callback will be called for each pixel on every frame.
   */
  startShader(requestRender?: () => void): void {
    if (this._shaderTimer !== null) {
      return; // Already running
    }

    if (!this.props.onShader) {
      return; // No shader callback
    }

    // Check shader permission - requires explicit policy with shader: true
    const engine = (globalThis as any).melkerEngine;
    if (!engine || typeof engine.hasPermission !== 'function' || !engine.hasPermission('shader')) {
      if (!this._shaderPermissionWarned) {
        this._shaderPermissionWarned = true;
        logger.warn(`Shader blocked: requires policy with "shader": true permission.`);
      }
      return; // Permission denied
    }

    this._shaderRequestRender = requestRender ?? null;
    this._shaderStartTime = performance.now();
    this._shaderFinished = false;  // Reset in case of manual restart
    this._shaderResolution = {
      width: this._bufferWidth,
      height: this._bufferHeight,
      pixelAspect: this.getPixelAspectRatio()  // (2/3) * charAspectRatio
    };

    const fps = this.props.shaderFps ?? 30;
    this._shaderFrameInterval = Math.floor(1000 / fps);
    this._shaderLastFrameTime = performance.now();

    // Register with performance dialog for stats tracking
    const shaderId = this.props.id ?? `shader_${Date.now()}`;
    this._shaderRegisteredId = shaderId;
    const pixelCount = this._bufferWidth * this._bufferHeight;
    getGlobalPerformanceDialog().registerShader(shaderId, pixelCount);

    // Schedule first frame via setTimeout to avoid running inside render()
    this._shaderTimer = setTimeout(() => {
      this._shaderLastFrameTime = performance.now();
      this._runShaderFrame();
    }, 0);
  }

  /**
   * Schedule next shader frame with proper time-keeping.
   * Uses setTimeout instead of setInterval to prevent frame overlap.
   */
  private _scheduleNextShaderFrame(): void {
    if (this._shaderTimer === null) return; // Stopped

    const now = performance.now();
    const elapsed = now - this._shaderLastFrameTime;
    const delay = Math.max(0, this._shaderFrameInterval - elapsed);

    this._shaderTimer = setTimeout(() => {
      this._shaderLastFrameTime = performance.now();
      this._runShaderFrame();
    }, delay);
  }

  /**
   * Stop the shader animation loop
   */
  stopShader(): void {
    if (this._shaderTimer !== null) {
      clearTimeout(this._shaderTimer);
      this._shaderTimer = null;
    }

    // Unregister from performance dialog
    if (this._shaderRegisteredId !== null) {
      const pixelCount = this._bufferWidth * this._bufferHeight;
      getGlobalPerformanceDialog().unregisterShader(this._shaderRegisteredId, pixelCount);
      this._shaderRegisteredId = null;
    }
  }

  /**
   * Check if shader is currently running
   */
  isShaderRunning(): boolean {
    return this._shaderTimer !== null;
  }

  /**
   * Freeze current shader output as a LoadedImage.
   * This allows the final shader frame to be treated like a loaded image,
   * supporting resize and repaint operations.
   */
  private _freezeShaderAsImage(): void {
    const bufW = this._bufferWidth;
    const bufH = this._bufferHeight;
    const bufferSize = bufW * bufH;

    // Convert color buffer to RGBA Uint8ClampedArray format
    const rgbaData = new Uint8ClampedArray(bufferSize * 4);

    for (let i = 0; i < bufferSize; i++) {
      const color = this._colorBuffer[i];
      const rgba = unpackRGBA(color);
      const idx = i * 4;
      rgbaData[idx] = rgba.r;
      rgbaData[idx + 1] = rgba.g;
      rgbaData[idx + 2] = rgba.b;
      rgbaData[idx + 3] = rgba.a;
    }

    // Store as a LoadedImage so resize logic works
    this._loadedImage = {
      width: bufW,
      height: bufH,
      data: rgbaData,
      bytesPerPixel: 4,
    };

    // Copy to image color buffer (background layer) for display
    this._imageColorBuffer.set(this._colorBuffer);

    // Clear the drawing layer so image layer shows through
    // (drawing layer has priority in rendering, so we need to clear it)
    this._colorBuffer.fill(TRANSPARENT);
    this._previousColorBuffer.fill(TRANSPARENT);  // Prevent _markClean() from restoring old content

    // Invalidate dither cache to force re-render
    this._ditherCacheValid = false;

    logger.debug(`Shader frozen as ${bufW}x${bufH} image`);
  }

  /**
   * Run a single shader frame - calls onShader for each pixel
   * Uses a separate output buffer to avoid race conditions with rendering.
   */
  private _runShaderFrame(): void {
    const shader = this.props.onShader;
    if (!shader) return;

    const bufW = this._bufferWidth;
    const bufH = this._bufferHeight;
    const bufferSize = bufW * bufH;
    const elapsedMs = performance.now() - this._shaderStartTime;
    const time = elapsedMs / 1000; // Time in seconds

    // Check if shaderRunTime is set and exceeded
    if (this.props.shaderRunTime !== undefined && elapsedMs >= this.props.shaderRunTime) {
      // Save current frame as a "frozen" image and stop the shader
      this._freezeShaderAsImage();
      this._shaderFinished = true;  // Prevent auto-restart in render()
      this.stopShader();
      // Request one final render to display the frozen frame
      if (this._shaderRequestRender) {
        this._shaderRequestRender();
      }
      return;
    }

    // Update resolution in case canvas was resized
    this._shaderResolution.width = bufW;
    this._shaderResolution.height = bufH;
    this._shaderResolution.pixelAspect = this.getPixelAspectRatio();

    // Ensure shader output buffer exists and is correct size
    if (!this._shaderOutputBuffer || this._shaderOutputBuffer.length !== bufferSize) {
      this._shaderOutputBuffer = new Uint32Array(bufferSize);
    }
    const outputBuffer = this._shaderOutputBuffer;

    // Create or update source accessor for image pixel access
    const imageBuffer = this._imageColorBuffer;
    const hasImage = this._loadedImage !== null;
    const imgWidth = this._loadedImage?.width ?? 0;
    const imgHeight = this._loadedImage?.height ?? 0;

    // Create source accessor object (reuse if possible)
    if (!this._shaderSource) {
      this._shaderSource = {
        hasImage: false,
        width: 0,
        height: 0,
        getPixel: (_x: number, _y: number) => null,
        mouse: { x: -1, y: -1 },
        mouseUV: { u: -1, v: -1 },
      };
    }

    // Update source properties
    this._shaderSource.hasImage = hasImage;
    this._shaderSource.width = imgWidth;
    this._shaderSource.height = imgHeight;

    // Update mouse position
    this._shaderSource.mouse.x = this._shaderMouseX;
    this._shaderSource.mouse.y = this._shaderMouseY;
    if (this._shaderMouseX >= 0 && this._shaderMouseY >= 0) {
      this._shaderSource.mouseUV.u = this._shaderMouseX / bufW;
      this._shaderSource.mouseUV.v = this._shaderMouseY / bufH;
    } else {
      this._shaderSource.mouseUV.u = -1;
      this._shaderSource.mouseUV.v = -1;
    }

    // Create getPixel function that reads from image buffer
    // The image buffer contains the scaled/rendered image at buffer resolution
    const source = this._shaderSource;
    source.getPixel = (px: number, py: number): [number, number, number, number] | null => {
      if (px < 0 || px >= bufW || py < 0 || py >= bufH) return null;
      const idx = py * bufW + px;
      const color = imageBuffer[idx];
      if (color === TRANSPARENT) return null;
      const rgba = unpackRGBA(color);
      return [rgba.r, rgba.g, rgba.b, rgba.a];
    };

    // Call shader for each pixel - write directly to _colorBuffer
    // (Bypassing intermediate buffer since JS is single-threaded)
    const shaderExecStart = performance.now();
    const colorBuffer = this._colorBuffer;
    for (let y = 0; y < bufH; y++) {
      for (let x = 0; x < bufW; x++) {
        const rgba = shader(x, y, time, this._shaderResolution, source, shaderUtils);
        // Clamp values to 0-255
        const r = Math.max(0, Math.min(255, Math.floor(rgba[0])));
        const g = Math.max(0, Math.min(255, Math.floor(rgba[1])));
        const b = Math.max(0, Math.min(255, Math.floor(rgba[2])));
        // Alpha is optional (defaults to 255 if not provided)
        const a = rgba.length > 3 ? Math.max(0, Math.min(255, Math.floor((rgba as [number, number, number, number])[3]))) : 255;
        // Pack and set pixel (TRANSPARENT if alpha is 0)
        const color = a === 0 ? TRANSPARENT : packRGBA(r, g, b, a);
        const index = y * bufW + x;
        colorBuffer[index] = color;
      }
    }
    const shaderExecTime = performance.now() - shaderExecStart;

    // Record shader frame time for performance stats
    getGlobalPerformanceDialog().recordShaderFrameTime(shaderExecTime);

    this._isDirty = true;

    // Schedule next frame immediately based on elapsed time, then request render
    // This keeps consistent frame timing regardless of render duration
    this._scheduleNextShaderFrame();

    // Request render (will show current frame's output)
    if (this._shaderRequestRender) {
      this._shaderRequestRender();
    }
  }

  /**
   * Update shader mouse position from terminal coordinates.
   * Call this from onMouseMove handler to enable interactive shaders.
   */
  updateShaderMouse(termX: number, termY: number): void {
    if (!this._shaderBounds) {
      this._shaderMouseX = -1;
      this._shaderMouseY = -1;
      return;
    }

    const bounds = this._shaderBounds;

    // Check if mouse is within canvas bounds
    if (termX < bounds.x || termX >= bounds.x + bounds.width ||
        termY < bounds.y || termY >= bounds.y + bounds.height) {
      this._shaderMouseX = -1;
      this._shaderMouseY = -1;
      return;
    }

    // Convert terminal coordinates to pixel coordinates
    // Each terminal cell is 2 pixels wide and 3 pixels tall (sextant characters)
    const localX = termX - bounds.x;
    const localY = termY - bounds.y;

    // Scale to pixel buffer coordinates
    this._shaderMouseX = Math.floor((localX / bounds.width) * this._bufferWidth);
    this._shaderMouseY = Math.floor((localY / bounds.height) * this._bufferHeight);
  }

  /**
   * Clear shader mouse position (call on mouse leave)
   */
  clearShaderMouse(): void {
    this._shaderMouseX = -1;
    this._shaderMouseY = -1;
  }

  /**
   * Get current shader mouse position in pixel coordinates
   */
  getShaderMouse(): { x: number; y: number } {
    return { x: this._shaderMouseX, y: this._shaderMouseY };
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
    const shaderActive = this._shaderTimer !== null;

    // Handle 'auto' mode based on config and theme
    // Track if original mode was 'auto' for dither.bits handling
    const wasAutoMode = ditherMode === 'auto';
    if (ditherMode === 'auto') {
      // config dither.algorithm is always respected (any theme, any dither type)
      const config = MelkerConfig.get();
      const configDither = config.ditherAlgorithm;
      // dither.bits implies user wants dithering
      const configBits = config.ditherBits;

      if (configDither) {
        ditherMode = configDither as DitherMode;
      } else if (configBits !== undefined) {
        // User specified bits but not algorithm - use default algorithm
        ditherMode = 'sierra-stable';
      } else {
        // No env override - use theme-based defaults
        const theme = getCurrentTheme();
        if (theme.type === 'fullcolor') {
          // Fullcolor: no dithering needed (but shaders need snapshot)
          if (!shaderActive) {
            return null;
          }
          ditherMode = 'none'; // Passthrough mode for shader snapshot
        } else {
          // bw, gray, or color themes: default to sierra-stable
          ditherMode = 'sierra-stable';
        }
      }
    }

    // No dithering if not specified or explicitly disabled
    // Note: !ditherMode handles false, undefined, and empty string
    // Exception: shaders need a snapshot buffer to avoid race conditions
    if (!ditherMode || ditherMode === 'none') {
      if (!shaderActive) {
        return null;
      }
      // For shaders with dither=none, still create snapshot but skip dithering
    }

    // Compute effective bits early for cache invalidation
    // Priority: prop > env var (if auto mode) > theme-based default (if auto mode) > fallback
    let effectiveBits: number;
    if (this.props.ditherBits !== undefined) {
      effectiveBits = this.props.ditherBits;
    } else if (wasAutoMode) {
      // Check config dither.bits when dither="auto" was used
      const configBits = MelkerConfig.get().ditherBits;
      if (configBits !== undefined) {
        effectiveBits = configBits;
        if (effectiveBits < 1 || effectiveBits > 8) effectiveBits = 1;
      } else {
        // Theme-based defaults
        const theme = getCurrentTheme();
        switch (theme.type) {
          case 'bw': effectiveBits = 1; break;       // 2 levels (black/white)
          case 'gray': effectiveBits = 2; break;     // 4 levels of gray
          case 'color': effectiveBits = 3; break;    // 8 levels per channel
          case 'fullcolor': effectiveBits = 6; break; // 64 levels (subtle dithering)
          default: effectiveBits = 1;
        }
      }
    } else {
      effectiveBits = 1;
    }

    // Invalidate cache if content changed (drawing methods set _isDirty)
    // For active shaders, ALWAYS invalidate - external events can trigger renders
    // between shader write and our scheduled render, consuming _isDirty flag
    if (this._isDirty || shaderActive) {
      this._ditherCacheValid = false;
    }

    // Check if dither settings changed
    if (this._lastDitherMode !== ditherMode || this._lastDitherBits !== effectiveBits) {
      this._ditherCacheValid = false;
      this._lastDitherMode = ditherMode;
      this._lastDitherBits = effectiveBits;
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
        // Fall back to image layer (already pre-blended for alpha)
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

    // Apply dithering algorithm (effectiveBits computed earlier for cache check)
    if (ditherMode === 'sierra-stable' || ditherMode === true) {
      applySierraStableDither(cache, bufW, bufH, effectiveBits);
    } else if (ditherMode === 'sierra') {
      applySierraDither(cache, bufW, bufH, effectiveBits);
    } else if (ditherMode === 'floyd-steinberg') {
      applyFloydSteinbergDither(cache, bufW, bufH, effectiveBits);
    } else if (ditherMode === 'floyd-steinberg-stable') {
      applyFloydSteinbergStableDither(cache, bufW, bufH, effectiveBits);
    } else if (ditherMode === 'ordered') {
      applyOrderedDither(cache, bufW, bufH, effectiveBits);
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
    let terminalWidth = Math.min(this.props.width, bounds.width);
    const terminalHeight = Math.min(this.props.height, bounds.height);
    const bufW = this._bufferWidth;
    const bufH = this._bufferHeight;
    const scale = this._scale;
    const halfScale = scale >> 1;

    // Workaround for terminal edge rendering glitch:
    // When canvas extends to the exact right edge of the terminal, some terminals
    // have issues with sextant characters in the last column (autowrap, width calculation).
    // Skip the last column when we're at the terminal edge to avoid visual artifacts.
    const engine = (globalThis as any).melkerEngine;
    if (engine && bounds.x + terminalWidth >= engine._currentSize?.width) {
      terminalWidth = Math.max(1, terminalWidth - 1);
    }

    // Cache blockMode config (avoid repeated lookups in hot path)
    const blockMode = MelkerConfig.get().blockMode;

    // Check for dithered rendering mode
    const ditheredBuffer = this._prepareDitheredBuffer();
    if (ditheredBuffer) {
      // Use dithered rendering path
      this._renderDitheredToTerminal(bounds, style, buffer, ditheredBuffer, blockMode);
      return;
    }

    // Block mode: 1 colored space per cell instead of sextant characters
    if (blockMode) {
      this._renderBlockMode(bounds, style, buffer, terminalWidth, terminalHeight);
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
    ditheredBuffer: Uint8Array,
    blockMode: boolean
  ): void {
    let terminalWidth = Math.min(this.props.width, bounds.width);
    const terminalHeight = Math.min(this.props.height, bounds.height);
    const bufW = this._bufferWidth;
    const bufH = this._bufferHeight;
    const scale = this._scale;
    const halfScale = scale >> 1;

    // Workaround for terminal edge rendering glitch (same as non-dithered path)
    const engine = (globalThis as any).melkerEngine;
    if (engine && bounds.x + terminalWidth >= engine._currentSize?.width) {
      terminalWidth = Math.max(1, terminalWidth - 1);
    }

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

        // Block mode: average colors and output colored space
        if (blockMode) {
          if (!hasAnyPixel) continue;

          // Average all non-transparent colors
          let totalR = 0, totalG = 0, totalB = 0, count = 0;
          for (let i = 0; i < 6; i++) {
            const color = sextantColors[i];
            if (color !== TRANSPARENT) {
              totalR += (color >> 24) & 0xFF;
              totalG += (color >> 16) & 0xFF;
              totalB += (color >> 8) & 0xFF;
              count++;
            }
          }
          const avgColor = count > 0
            ? rgbaToCss(packRGBA(Math.round(totalR / count), Math.round(totalG / count), Math.round(totalB / count), 255))
            : propsBg ?? (hasStyleBg ? style.background as string : undefined);

          if (!avgColor) continue;

          buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
            char: ' ',
            background: avgColor,
            bold: style.bold,
            dim: style.dim,
          });
          continue;
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
   * Block mode rendering: 1 colored space per terminal cell (no sextant characters)
   * Each cell shows averaged color from the corresponding 2x3 pixel region
   */
  private _renderBlockMode(
    bounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    terminalWidth: number,
    terminalHeight: number
  ): void {
    const bufW = this._bufferWidth;
    const bufH = this._bufferHeight;
    const scale = this._scale;
    const halfScale = scale >> 1;
    const hasStyleBg = style.background !== undefined;
    const propsBg = this.props.backgroundColor;

    for (let ty = 0; ty < terminalHeight; ty++) {
      const baseBufferY = ty * 3 * scale;

      for (let tx = 0; tx < terminalWidth; tx++) {
        const baseBufferX = tx * 2 * scale;

        // Sample center pixel of 2x3 block and average colors
        let totalR = 0, totalG = 0, totalB = 0, count = 0;

        // Sample 6 pixels in 2x3 grid
        for (let py = 0; py < 3; py++) {
          const bufferY = baseBufferY + py * scale + halfScale;
          if (bufferY < 0 || bufferY >= bufH) continue;
          const rowOffset = bufferY * bufW;

          for (let px = 0; px < 2; px++) {
            const bufferX = baseBufferX + px * scale + halfScale;
            if (bufferX < 0 || bufferX >= bufW) continue;

            const bufIndex = rowOffset + bufferX;
            // Check drawing layer first, then image layer
            let color = this._colorBuffer[bufIndex];
            if (color === TRANSPARENT) {
              color = this._imageColorBuffer[bufIndex];
            }
            if (color !== TRANSPARENT) {
              totalR += (color >> 24) & 0xFF;
              totalG += (color >> 16) & 0xFF;
              totalB += (color >> 8) & 0xFF;
              count++;
            }
          }
        }

        // Determine background color
        let bgColor: string | undefined;
        if (count > 0) {
          const avgR = Math.round(totalR / count);
          const avgG = Math.round(totalG / count);
          const avgB = Math.round(totalB / count);
          bgColor = rgbaToCss(packRGBA(avgR, avgG, avgB, 255));
        } else {
          bgColor = propsBg ?? (hasStyleBg ? style.background as string : undefined);
        }

        // Skip empty cells with no background
        if (!bgColor) continue;

        buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
          char: ' ',
          background: bgColor,
          bold: style.bold,
          dim: style.dim,
        });
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
    // Cache bounds for mouse coordinate conversion in shaders
    this._shaderBounds = bounds;

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

    // Auto-start shader animation if onShader prop is provided
    // Don't restart if shader finished due to shaderRunTime
    if (this.props.onShader && this._shaderTimer === null && !this._shaderFinished) {
      this.startShader(context.requestRender);
    }

    // Call onPaint handler to allow user to update canvas content before rendering
    if (this.props.onPaint) {
      // Pass as event object for compatibility with string handlers in .melker files
      this.props.onPaint({ canvas: this, bounds });
    }

    // Always render to the buffer (buffer is rebuilt each frame)
    this._renderToTerminal(bounds, style, buffer);
    // Mark clean to track changes for next frame
    // Skip for active shaders - they rewrite every pixel and the buffer swap causes glitches
    if (this._isDirty && this._shaderTimer === null) {
      this._markClean();
    }
    this._isDirty = false;
  }

  /**
   * Calculate intrinsic size for the canvas component
   * Returns available space for 'fill' styles to expand to container
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    const style = this.props.style || {};
    // Return 0 as fallback when width/height not explicitly set
    // This allows flexbox stretch alignment to work correctly
    return {
      width: style.width === 'fill' ? context.availableSpace.width : (this.props.width ?? 0),
      height: style.height === 'fill' ? context.availableSpace.height : (this.props.height ?? 0)
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
    // Reset shader output buffer (will be reallocated on next frame if needed)
    this._shaderOutputBuffer = null;
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
    onPaint: { type: ['function', 'string'], description: 'Called when canvas needs repainting, receives event with {canvas, bounds}' },
    onShader: { type: ['function', 'string'], description: 'Shader callback (x, y, time, resolution, source?) => [r,g,b] or [r,g,b,a]. source has getPixel(), mouse, mouseUV' },
    shaderFps: { type: 'number', description: 'Shader frame rate (default: 30)' },
    shaderRunTime: { type: 'number', description: 'Stop shader after this many ms, final frame becomes static image' },
  },
};

registerComponentSchema('canvas', canvasSchema);