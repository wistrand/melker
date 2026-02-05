// Canvas component for basic graphics rendering using Unicode sextant characters

import { Element, BaseProps, Renderable, Focusable, Interactive, Bounds, ComponentRenderContext, IntrinsicSizeContext, KeyPressEvent, ColorInput } from '../types.ts';
import { type DualBuffer, type Cell } from '../buffer.ts';
import { TRANSPARENT, DEFAULT_FG, packRGBA, cssToRgba } from './color-utils.ts';
import {
  applySierraStableDither, applySierraDither,
  applyFloydSteinbergDither, applyFloydSteinbergStableDither,
  applyAtkinsonDither, applyAtkinsonStableDither,
  applyBlueNoiseDither, applyOrderedDither,
  type DitherMode
} from '../video/dither.ts';
import { getLogger } from '../logging.ts';
import * as Draw from './canvas-draw.ts';
import { shaderUtils, type ShaderResolution, type ShaderSource, type ShaderUtils, type ShaderCallback } from './canvas-shader.ts';
import {
  CanvasRenderState, renderToTerminal, renderIsolinesToTerminal, getEffectiveGfxMode, generateSixelOutput, generateKittyOutput, generateITerm2Output,
  GFX_MODES, type CanvasRenderData, type GfxMode, type SixelOutputData, type KittyOutputData, type ITermOutputData, type IsolineRenderProps
} from './canvas-render.ts';
import type { Isoline, IsolineMode, IsolineSource } from '../isoline.ts';
import {
  decodeImageBytes, loadImageFromSource,
  calculateImageScaling, scaleImageToBuffer, renderScaledDataToBuffer,
  type LoadedImage, type ImageRenderConfig
} from './canvas-image.ts';
import {
  createShaderState, startShader, stopShader, isShaderRunning,
  updateShaderMouse, clearShaderMouse, getShaderMouse,
  type ShaderState, type ShaderContext
} from './canvas-shader-runner.ts';
import {
  DitherState, prepareDitheredBuffer, type DitherData
} from './canvas-dither.ts';
import { MelkerConfig } from '../config/mod.ts';

// Re-export for external use
export { type LoadedImage } from './canvas-image.ts';

const logger = getLogger('canvas');

// Re-export color utilities for external use
export { packRGBA, unpackRGBA, rgbaToCss, cssToRgba } from './color-utils.ts';

// Re-export shader types for external use
export { type ShaderResolution, type ShaderSource, type ShaderUtils, type ShaderCallback } from './canvas-shader.ts';

export interface CanvasProps extends BaseProps {
  width: number;                     // Canvas width in terminal columns
  height: number;                    // Canvas height in terminal rows
  scale?: number;                    // Pixel scale factor (default: 1)
  backgroundColor?: ColorInput;      // Background color
  charAspectRatio?: number;          // Terminal char width/height ratio (default: 0.5)
  src?: string;                      // Image source path (loads and displays image)
  objectFit?: 'contain' | 'fill' | 'cover';  // How image fits: contain (default), fill (stretch), cover (crop)
  dither?: DitherMode | boolean;     // Dithering mode for images (e.g., 'sierra-stable' for B&W themes)
  ditherBits?: number;               // Bits per channel for dithering (1-8, default: 1 for B&W)
  gfxMode?: GfxMode;  // Per-element graphics mode (global config overrides)
  onPaint?: (event: { canvas: CanvasElement; bounds: Bounds }) => void;  // Called when canvas needs repainting
  onShader?: ShaderCallback;         // Shader-style per-pixel callback (TypeScript, not GLSL)
  onFilter?: ShaderCallback;         // One-time filter callback, runs once when image loads (same signature as onShader)
  shaderFps?: number;                // Shader frame rate (default: 30)
  shaderRunTime?: number;            // Stop shader after this many ms, keep final frame as image
  onKeyPress?: (event: KeyPressEvent) => boolean | void;  // Called on keyboard events when focused
  // Isoline props (for isolines/isolines-filled gfx modes)
  isolineCount?: number;             // Number of auto-generated isolines (default: 5)
  isolineMode?: IsolineMode;         // Distribution algorithm: equal, quantile, nice (default: equal)
  isolines?: Isoline[];              // Manual isoline definitions (overrides isolineCount)
  isolineSource?: IsolineSource;     // Color channel to use: luma, red, green, blue, alpha (default: luma)
}

export class CanvasElement extends Element implements Renderable, Focusable, Interactive {
  declare type: 'canvas';
  declare props: CanvasProps;

  // Backing color buffer (scale * width * 2) x (scale * height * 3) for sextant mode
  // Or (width * cellWidth) x (height * cellHeight) for sixel mode
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
  // Pixel multiplier per terminal cell (2x3 for sextant, cellWidth x cellHeight for sixel)
  private _pixelsPerCellX: number = 2;
  private _pixelsPerCellY: number = 3;

  // Image loading support
  private _loadedImage: LoadedImage | null = null;
  private _imageLoading: boolean = false;
  private _imageSrc: string | null = null;

  // Shader animation state (shared object for zero-overhead access)
  private _shaderState: ShaderState = createShaderState();

  // Pre-allocated render state (working arrays, cell styles) - see canvas-render.ts
  private _renderState: CanvasRenderState = new CanvasRenderState();

  // Dithering state - managed by canvas-dither.ts
  private _ditherState: DitherState = new DitherState();

  // Sixel output data (generated during render when gfxMode='sixel')
  private _sixelOutput: SixelOutputData | null = null;

  // Kitty output data (generated during render when gfxMode='kitty')
  private _kittyOutput: KittyOutputData | null = null;

  // iTerm2 output data (generated during render when gfxMode='iterm2')
  private _itermOutput: ITermOutputData | null = null;

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

    // info about common sizing footgun: style dimensions don't affect buffer size
    // Only  for actual canvas elements, not subclasses (img has its own warning)
    if (this.constructor === CanvasElement) {
      if (props.style?.width !== undefined) {
        logger.info(`canvas: style.width only affects layout, not buffer resolution. Use width prop for buffer sizing.`);
      }
      if (props.style?.height !== undefined) {
        logger.info(`canvas: style.height only affects layout, not buffer resolution. Use height prop for buffer sizing.`);
      }
    }

    this._scale = scale;
    this._charAspectRatio = charAspectRatio;

    // Calculate buffer dimensions based on gfx mode
    const dims = this._calculateBufferDimensions(props.width, props.height, scale);
    this._bufferWidth = dims.width;
    this._bufferHeight = dims.height;
    this._pixelsPerCellX = dims.pixelsPerCellX;
    this._pixelsPerCellY = dims.pixelsPerCellY;

    // Initialize color buffers (TRANSPARENT = pixel off, other value = pixel on)
    const bufferSize = this._bufferWidth * this._bufferHeight;
    this._colorBuffer = new Uint32Array(bufferSize);
    this._previousColorBuffer = new Uint32Array(bufferSize);
    // Initialize image background layer buffer
    this._imageColorBuffer = new Uint32Array(bufferSize);
    this.clear();
  }

  /**
   * Calculate buffer dimensions based on graphics mode.
   * Sixel/Kitty modes use full terminal pixel resolution (cellWidth x cellHeight per cell).
   * Other modes use sextant resolution (2x3 pixels per cell).
   */
  private _calculateBufferDimensions(width: number, height: number, scale: number): {
    width: number;
    height: number;
    pixelsPerCellX: number;
    pixelsPerCellY: number;
  } {
    const gfxMode = getEffectiveGfxMode(this.props.gfxMode);
    const engine = globalThis.melkerEngine;
    const sixelCapabilities = engine?.sixelCapabilities;

    logger.debug('_calculateBufferDimensions', {
      terminalSize: `${width}x${height}`,
      gfxMode,
      hasEngine: !!engine,
      hasCaps: !!sixelCapabilities,
      capsSupported: sixelCapabilities?.supported,
      cellSize: sixelCapabilities ? `${sixelCapabilities.cellWidth}x${sixelCapabilities.cellHeight}` : 'n/a',
    });

    // Sixel, Kitty, and iTerm2 all use full terminal pixel resolution
    if (gfxMode === 'sixel' || gfxMode === 'kitty' || gfxMode === 'iterm2') {
      // Use sixel capabilities for cell dimensions
      if (sixelCapabilities?.cellWidth && sixelCapabilities.cellWidth > 0 && sixelCapabilities.cellHeight > 0) {
        const result = {
          width: width * sixelCapabilities.cellWidth,
          height: height * sixelCapabilities.cellHeight,
          pixelsPerCellX: sixelCapabilities.cellWidth,
          pixelsPerCellY: sixelCapabilities.cellHeight,
        };
        return result;
      }
      // Fallback if caps not available yet - use 8x16 defaults
      return {
        width: width * 8,
        height: height * 16,
        pixelsPerCellX: 8,
        pixelsPerCellY: 16,
      };
    }

    // Non-sixel/kitty modes: use sextant resolution (2x3 pixels per terminal cell)
    return {
      width: width * 2 * scale,
      height: height * 3 * scale,
      pixelsPerCellX: 2 * scale,
      pixelsPerCellY: 3 * scale,
    };
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
   * Decode image bytes (PNG, JPEG, GIF) to pixel data
   * Can be used to decode fetched tile data before calling drawImage()
   */
  decodeImageBytes(imageBytes: Uint8Array): LoadedImage {
    return decodeImageBytes(imageBytes);
  }

  /**
   * Load an image from a file path or data URL and render it to the canvas.
   * The image is scaled to fit the canvas while maintaining aspect ratio.
   * @param src Path to image file (PNG, JPEG, GIF), or data URL (data:image/png;base64,...)
   */
  async loadImage(src: string): Promise<void> {
    // Track the requested src - last one wins
    this._imageSrc = src;
    this._imageLoading = true;

    try {
      logger.debug("loadImage " + src);
      // Load image bytes from source (file path or data URL)
      const imageBytes = await loadImageFromSource(src);

      // Check if src changed while loading - if so, skip (stale result)
      if (this._imageSrc !== src) {
        return;
      }

      // Decode and store the image
      this._loadedImage = decodeImageBytes(imageBytes);

      // Render the image to the canvas
      this._renderImageToBuffer();

    } catch (error) {
      // Only log/throw if this is still the current src
      if (this._imageSrc === src) {
        logger.error(`Failed to load image '${src}': ${error}`);
        throw new Error(`Failed to load image '${src}': ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      // Only clear loading flag if this is still the current src
      if (this._imageSrc === src) {
        this._imageLoading = false;
      }
    }
  }

  /**
   * Set the image source and load it
   * Convenience method that combines setting src and loading
   * @param src Path to image file (PNG, JPEG, GIF), or data URL (data:image/png;base64,...)
   */
  async setSrc(src: string): Promise<void> {
    await this.loadImage(src);
  }

  /**
   * Load an image directly from raw bytes (PNG, JPEG, or GIF data)
   * Use this when you've already fetched the image data (e.g., from fetch())
   * @param bytes Raw image file bytes
   */
  loadImageFromBytes(bytes: Uint8Array): void {
    try {
      this._loadedImage = this.decodeImageBytes(bytes);
      this._imageSrc = '[bytes]';
      this._renderImageToBuffer();
    } catch (error) {
      logger.error(`Failed to decode image from bytes: ${error}`);
      throw new Error(`Failed to decode image from bytes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Draw an image onto the canvas at a specific position
   * Similar to CanvasRenderingContext2D.drawImage()
   * @param image Image data to draw (LoadedImage format or raw bytes)
   * @param dx Destination X position in canvas pixels
   * @param dy Destination Y position in canvas pixels
   * @param dw Destination width (optional, defaults to image width)
   * @param dh Destination height (optional, defaults to image height)
   */
  drawImage(
    image: { width: number; height: number; data: Uint8ClampedArray; bytesPerPixel: number } | Uint8Array,
    dx: number,
    dy: number,
    dw?: number,
    dh?: number
  ): void {
    // Decode if raw bytes were passed
    let img: LoadedImage;
    if (image instanceof Uint8Array) {
      img = this.decodeImageBytes(image);
    } else {
      img = image as LoadedImage;
    }

    const destWidth = dw ?? img.width;
    const destHeight = dh ?? img.height;

    // Floor destination position to avoid fractional pixel issues
    const dxInt = Math.floor(dx);
    const dyInt = Math.floor(dy);

    // Calculate visible region (clip to buffer bounds)
    const bufW = this._bufferWidth;
    const bufH = this._bufferHeight;

    const startX = Math.max(0, -dxInt);
    const startY = Math.max(0, -dyInt);
    const endX = Math.min(destWidth, bufW - dxInt);
    const endY = Math.min(destHeight, bufH - dyInt);

    if (startX >= endX || startY >= endY) return; // Nothing visible

    // Scale factors
    const scaleX = img.width / destWidth;
    const scaleY = img.height / destHeight;
    const bpp = img.bytesPerPixel;

    // Draw only the visible portion
    for (let y = startY; y < endY; y++) {
      const bufY = dyInt + y;
      const srcY = Math.floor(y * scaleY);
      const srcRowOffset = srcY * img.width * bpp;
      const bufRowOffset = bufY * bufW;

      for (let x = startX; x < endX; x++) {
        const srcX = Math.floor(x * scaleX);
        const srcIdx = srcRowOffset + srcX * bpp;

        const r = img.data[srcIdx];
        const g = img.data[srcIdx + 1];
        const b = img.data[srcIdx + 2];
        const a = bpp === 4 ? img.data[srcIdx + 3] : 255;

        // Skip fully transparent pixels
        if (a === 0) continue;

        // Pack and set pixel
        const color = packRGBA(r, g, b, a);
        const bufX = dxInt + x;
        this._colorBuffer[bufRowOffset + bufX] = color;
      }
    }

    this._isDirty = true;
  }

  /**
   * Draw a region of an image onto the canvas
   * Similar to CanvasRenderingContext2D.drawImage() with 9 arguments
   * @param image Image data to draw (LoadedImage format or raw bytes)
   * @param sx Source X position in image pixels
   * @param sy Source Y position in image pixels
   * @param sw Source width in image pixels
   * @param sh Source height in image pixels
   * @param dx Destination X position in canvas pixels
   * @param dy Destination Y position in canvas pixels
   * @param dw Destination width in canvas pixels
   * @param dh Destination height in canvas pixels
   */
  drawImageRegion(
    image: { width: number; height: number; data: Uint8ClampedArray; bytesPerPixel: number } | Uint8Array,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ): void {
    // Decode if raw bytes were passed
    let img: LoadedImage;
    if (image instanceof Uint8Array) {
      img = this.decodeImageBytes(image);
    } else {
      img = image as LoadedImage;
    }

    // Clamp source rectangle to image bounds
    const srcX = Math.max(0, Math.floor(sx));
    const srcY = Math.max(0, Math.floor(sy));
    const srcW = Math.min(sw, img.width - srcX);
    const srcH = Math.min(sh, img.height - srcY);

    if (srcW <= 0 || srcH <= 0) return;

    // Floor destination position
    const dxInt = Math.floor(dx);
    const dyInt = Math.floor(dy);

    // Calculate visible region (clip to buffer bounds)
    const bufW = this._bufferWidth;
    const bufH = this._bufferHeight;

    const startX = Math.max(0, -dxInt);
    const startY = Math.max(0, -dyInt);
    const endX = Math.min(dw, bufW - dxInt);
    const endY = Math.min(dh, bufH - dyInt);

    if (startX >= endX || startY >= endY) return; // Nothing visible

    // Scale factors from source region to destination
    const scaleX = srcW / dw;
    const scaleY = srcH / dh;
    const bpp = img.bytesPerPixel;

    // Draw only the visible portion
    for (let y = startY; y < endY; y++) {
      const bufY = dyInt + y;
      const imgY = srcY + Math.floor(y * scaleY);
      const srcRowOffset = imgY * img.width * bpp;
      const bufRowOffset = bufY * bufW;

      for (let x = startX; x < endX; x++) {
        const imgX = srcX + Math.floor(x * scaleX);
        const srcIdx = srcRowOffset + imgX * bpp;

        const r = img.data[srcIdx];
        const g = img.data[srcIdx + 1];
        const b = img.data[srcIdx + 2];
        const a = bpp === 4 ? img.data[srcIdx + 3] : 255;

        // Skip fully transparent pixels
        if (a === 0) continue;

        // Pack and set pixel
        const color = packRGBA(r, g, b, a);
        const bufX = dxInt + x;
        this._colorBuffer[bufRowOffset + bufX] = color;
      }
    }

    this._isDirty = true;
  }

  /**
   * Render the loaded image to the pixel buffer, scaling to fit.
   * Uses nearest neighbor sampling for scaling.
   * Applies onFilter and dithering if set.
   */
  private _renderImageToBuffer(): void {
    if (!this._loadedImage) return;

    const img = this._loadedImage;
    const bufW = this._bufferWidth;
    const bufH = this._bufferHeight;

    // Configure image rendering
    const config: ImageRenderConfig = {
      bufferWidth: bufW,
      bufferHeight: bufH,
      pixelAspectRatio: this.getPixelAspectRatio(),
      objectFit: this.props.objectFit ?? 'contain',
      backgroundColor: this.props.backgroundColor,
    };

    // Calculate scaling dimensions
    const scaling = calculateImageScaling(img, config);
    const { scaledWidth, scaledHeight, offsetX, offsetY } = scaling;

    // Clear the image background buffer (not the drawing layer)
    this._imageColorBuffer.fill(TRANSPARENT);

    // Scale image to temp buffer
    const scaledData = scaleImageToBuffer(img, scaledWidth, scaledHeight);

    // Apply onFilter if set (one-time per-pixel filter, same signature as onShader)
    if (this.props.onFilter) {
      const engine = globalThis.melkerEngine;
      if (engine?.hasPermission?.('shader')) {
        const resolution: ShaderResolution = { width: scaledWidth, height: scaledHeight, pixelAspect: this.getPixelAspectRatio() };
        const srcCopy = new Uint8Array(scaledData); // Copy for source.getPixel
        const source: ShaderSource = {
          hasImage: true, width: scaledWidth, height: scaledHeight,
          mouse: { x: -1, y: -1 }, mouseUV: { u: -1, v: -1 },
          getPixel: (px, py) => {
            if (px < 0 || px >= scaledWidth || py < 0 || py >= scaledHeight) return null;
            const i = (py * scaledWidth + px) * 4;
            return [srcCopy[i], srcCopy[i + 1], srcCopy[i + 2], srcCopy[i + 3]];
          },
        };
        for (let y = 0; y < scaledHeight; y++) {
          for (let x = 0; x < scaledWidth; x++) {
            const rgba = this.props.onFilter(x, y, 0, resolution, source, shaderUtils);
            const idx = (y * scaledWidth + x) * 4;
            scaledData[idx] = Math.max(0, Math.min(255, Math.floor(rgba[0])));
            scaledData[idx + 1] = Math.max(0, Math.min(255, Math.floor(rgba[1])));
            scaledData[idx + 2] = Math.max(0, Math.min(255, Math.floor(rgba[2])));
            scaledData[idx + 3] = rgba.length > 3 ? Math.max(0, Math.min(255, Math.floor((rgba as [number, number, number, number])[3]))) : 255;
          }
        }
      }
    }

    // Apply dithering if enabled (for static image loading path)
    const ditherMode = this.props.dither;
    const bits = this.props.ditherBits ?? 1;
    if (ditherMode === 'sierra-stable' || ditherMode === true) {
      applySierraStableDither(scaledData, scaledWidth, scaledHeight, bits);
    } else if (ditherMode === 'sierra') {
      applySierraDither(scaledData, scaledWidth, scaledHeight, bits);
    } else if (ditherMode === 'floyd-steinberg') {
      applyFloydSteinbergDither(scaledData, scaledWidth, scaledHeight, bits);
    } else if (ditherMode === 'floyd-steinberg-stable') {
      applyFloydSteinbergStableDither(scaledData, scaledWidth, scaledHeight, bits);
    } else if (ditherMode === 'atkinson') {
      applyAtkinsonDither(scaledData, scaledWidth, scaledHeight, bits);
    } else if (ditherMode === 'atkinson-stable') {
      applyAtkinsonStableDither(scaledData, scaledWidth, scaledHeight, bits);
    } else if (ditherMode === 'ordered') {
      applyOrderedDither(scaledData, scaledWidth, scaledHeight, bits);
    } else if (ditherMode === 'blue-noise') {
      applyBlueNoiseDither(scaledData, scaledWidth, scaledHeight, bits);
    }

    // Render scaled data to image buffer with alpha blending
    renderScaledDataToBuffer(
      scaledData,
      scaledWidth,
      scaledHeight,
      offsetX,
      offsetY,
      this._imageColorBuffer,
      bufW,
      bufH,
      this.props.backgroundColor
    );

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

  /**
   * Set a new image source URL (clears existing image and triggers reload)
   * Convenience method that replaces clearImage() + props.src = url
   */
  setSource(url: string): void {
    this.clearImage();
    this.props.src = url;
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
   * - Sixel mode: 1.0 (square pixels at native terminal resolution)
   * - Other modes: Uses detected cell size if available, else charAspectRatio prop
   *
   * For sextant mode, each character cell is 2 columns × 3 rows of pixels:
   * - Each pixel is (cellWidth/2) wide × (cellHeight/3) tall
   * - Aspect ratio = (cellWidth/2) / (cellHeight/3) = (3 * cellWidth) / (2 * cellHeight)
   *
   * A value < 1 means pixels are taller than wide.
   */
  getPixelAspectRatio(): number {
    const gfxMode = getEffectiveGfxMode(this.props.gfxMode);

    if (gfxMode === 'sixel' || gfxMode === 'kitty' || gfxMode === 'iterm2') {
      // Sixel, Kitty, and iTerm2 modes render square pixels at native terminal resolution
      return 1.0;
    }

    // Check for detected cell size from terminal capabilities
    const engine = globalThis.melkerEngine;
    const capabilities = engine?.sixelCapabilities;

    if (capabilities?.cellWidth && capabilities?.cellHeight) {
      // Use detected cell dimensions for accurate aspect ratio
      // Sextant pixel = (cellWidth/2) wide × (cellHeight/3) tall
      return (3 * capabilities.cellWidth) / (2 * capabilities.cellHeight);
    }

    // Fallback to charAspectRatio prop (default 1.05)
    // Combined with sextant block ratio (2 wide : 3 tall per char)
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
   * Get shader context for runner functions
   */
  private _getShaderContext(): ShaderContext {
    return {
      colorBuffer: this._colorBuffer,
      imageColorBuffer: this._imageColorBuffer,
      bufferWidth: this._bufferWidth,
      bufferHeight: this._bufferHeight,
      onShader: this.props.onShader,
      shaderFps: this.props.shaderFps,
      shaderRunTime: this.props.shaderRunTime,
      id: this.props.id,
      getPixelAspectRatio: () => this.getPixelAspectRatio(),
      setDirty: () => { this._isDirty = true; },
      setLoadedImage: (img: LoadedImage) => { this._loadedImage = img; },
      previousColorBuffer: this._previousColorBuffer,
      invalidateDitherCache: () => { this._ditherState.invalidate(); },
    };
  }

  /**
   * Start the shader animation loop.
   * The onShader callback will be called for each pixel on every frame.
   */
  startShader(requestRender?: () => void): void {
    startShader(this._shaderState, this._getShaderContext(), requestRender);
  }

  /**
   * Stop the shader animation loop
   */
  stopShader(): void {
    stopShader(this._shaderState, this._getShaderContext());
  }

  /**
   * Check if shader is currently running
   */
  isShaderRunning(): boolean {
    return isShaderRunning(this._shaderState);
  }

  /**
   * Update shader mouse position from terminal coordinates.
   * Called automatically by the engine for elements with onShader.
   * Can also be called manually if needed.
   */
  updateShaderMouse(termX: number, termY: number): void {
    updateShaderMouse(this._shaderState, termX, termY, this._bufferWidth, this._bufferHeight);
  }

  /**
   * Clear shader mouse position (call on mouse leave)
   */
  clearShaderMouse(): void {
    clearShaderMouse(this._shaderState);
  }

  /**
   * Get current shader mouse position in pixel coordinates
   */
  getShaderMouse(): { x: number; y: number } {
    return getShaderMouse(this._shaderState);
  }

  /**
   * Check if shader finished due to shaderRunTime
   */
  isShaderFinished(): boolean {
    return this._shaderState.finished;
  }

  /**
   * Set shader bounds for mouse coordinate conversion
   */
  setShaderBounds(bounds: Bounds | null): void {
    this._shaderState.bounds = bounds;
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
    this._ditherState.invalidate();
  }

  /**
   * Prepare a dithered buffer by compositing drawing and image layers,
   * then applying the specified dithering algorithm.
   * Returns null if dithering is not enabled, allowing original behavior.
   */
  private _prepareDitheredBuffer(): Uint8Array | null {
    const data: DitherData = {
      colorBuffer: this._colorBuffer,
      imageColorBuffer: this._imageColorBuffer,
      bufferWidth: this._bufferWidth,
      bufferHeight: this._bufferHeight,
      ditherMode: this.props.dither,
      ditherBits: this.props.ditherBits,
      backgroundColor: this.props.backgroundColor,
      isDirty: this._isDirty,
      shaderActive: this._shaderState.timer !== null,
    };
    return prepareDitheredBuffer(data, this._ditherState);
  }

  /**
   * Render canvas to terminal buffer.
   * Delegates to canvas-render.ts for actual rendering logic.
   */
  private _renderToTerminal(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer): void {
    // Prepare render data (minimal interface for render functions)
    const data: CanvasRenderData = {
      colorBuffer: this._colorBuffer,
      imageColorBuffer: this._imageColorBuffer,
      bufferWidth: this._bufferWidth,
      bufferHeight: this._bufferHeight,
      scale: this._scale,
      propsWidth: this.props.width,
      propsHeight: this.props.height,
      backgroundColor: this.props.backgroundColor,
    };

    // Get effective graphics mode
    const gfxMode = getEffectiveGfxMode(this.props.gfxMode);

    // Handle isolines mode separately (uses different render path)
    if (gfxMode === 'isolines' || gfxMode === 'isolines-filled') {
      const isolineProps: IsolineRenderProps = {
        isolineCount: this.props.isolineCount,
        isolineMode: this.props.isolineMode,
        isolines: this.props.isolines,
        isolineSource: this.props.isolineSource,
      };
      renderIsolinesToTerminal(bounds, style, buffer, data, isolineProps, gfxMode === 'isolines-filled');
      return;
    }

    // Get dithered buffer if applicable
    const ditheredBuffer = this._prepareDitheredBuffer();

    // Delegate to extracted render function
    renderToTerminal(bounds, style, buffer, data, this._renderState, ditheredBuffer, gfxMode);
  }

  // NOTE: Render methods have been extracted to canvas-render.ts

  /**
   * Render the canvas to the terminal buffer
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Cache bounds for mouse coordinate conversion in shaders
    this._shaderState.bounds = bounds;

    // Check if buffer needs resizing due to sixel/kitty/iterm2 capabilities becoming available
    // This happens when canvas was created before engine started
    const gfxMode = getEffectiveGfxMode(this.props.gfxMode);
    if (gfxMode === 'sixel' || gfxMode === 'kitty' || gfxMode === 'iterm2') {
      const engine = globalThis.melkerEngine;
      // Use sixel capabilities for cell dimensions
      const capabilities = engine?.sixelCapabilities;
      if (capabilities?.cellWidth && capabilities.cellWidth > 0 && capabilities.cellHeight > 0) {
        const expectedWidth = this.props.width * capabilities.cellWidth;
        const expectedHeight = this.props.height * capabilities.cellHeight;
        if (this._bufferWidth !== expectedWidth || this._bufferHeight !== expectedHeight) {
          logger.debug('graphics mode resize triggered', {
            gfxMode,
            old: `${this._bufferWidth}x${this._bufferHeight}`,
            new: `${expectedWidth}x${expectedHeight}`,
          });
          this.setSize(this.props.width, this.props.height);
          // Re-render image to the new buffer (image was loaded into old smaller buffer)
          if (this._loadedImage) {
            this._renderImageToBuffer();
          }
        }
      }
    }

    // Auto-load image from src prop if not already loaded/loading
    // Skip for video elements (they handle src differently via ffmpeg)
    if ((this.type as string) !== 'video' && this.props.src && !this._loadedImage && !this._imageLoading && this._imageSrc !== this.props.src) {
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
    if (this.props.onShader && this._shaderState.timer === null && !this._shaderState.finished) {
      this.startShader(context.requestRender);
    }

    // Call onPaint handler to allow user to update canvas content before rendering
    if (this.props.onPaint) {
      // Pass as event object for compatibility with string handlers in .melker files
      this.props.onPaint({ canvas: this, bounds });
    }

    // Render to the buffer (sextant/block/pattern/luma, or placeholder for sixel)
    this._renderToTerminal(bounds, style, buffer);

    // Generate sixel/kitty output if in graphics mode
    // Check visibility - graphics can't be clipped, so skip if element extends outside visible area
    const visibleArea = (context as any).clipRect || context.viewport;
    const isFullyVisible = !visibleArea || (
      bounds.x >= visibleArea.x &&
      bounds.y >= visibleArea.y &&
      bounds.x + bounds.width <= visibleArea.x + visibleArea.width &&
      bounds.y + bounds.height <= visibleArea.y + visibleArea.height
    );

    if (gfxMode === 'sixel') {
      logger.debug('Sixel visibility check', {
        id: this.id,
        bounds,
        visibleArea,
        isFullyVisible,
      });

      if (isFullyVisible) {
        this._generateSixelOutput(bounds);
      } else {
        logger.debug('Sixel skipped - element extends outside viewport', {
          id: this.id,
          bounds,
          visibleArea,
        });
        this._sixelOutput = null;
      }
      this._kittyOutput = null;
      this._itermOutput = null;
    } else if (gfxMode === 'kitty') {
      logger.debug('Kitty visibility check', {
        id: this.id,
        bounds,
        visibleArea,
        isFullyVisible,
      });

      if (isFullyVisible) {
        this._generateKittyOutput(bounds);
      } else {
        logger.debug('Kitty skipped - element extends outside viewport', {
          id: this.id,
          bounds,
          visibleArea,
        });
        this._kittyOutput = null;
      }
      this._sixelOutput = null;
      this._itermOutput = null;
    } else if (gfxMode === 'iterm2') {
      logger.debug('iTerm2 visibility check', {
        id: this.id,
        bounds,
        visibleArea,
        isFullyVisible,
      });

      if (isFullyVisible) {
        this._generateITermOutput(bounds);
      } else {
        logger.debug('iTerm2 skipped - element extends outside viewport', {
          id: this.id,
          bounds,
          visibleArea,
        });
        this._itermOutput = null;
      }
      this._sixelOutput = null;
      this._kittyOutput = null;
    } else {
      this._sixelOutput = null;
      this._kittyOutput = null;
      this._itermOutput = null;
    }

    // Mark clean to track changes for next frame
    // Skip for active shaders - they rewrite every pixel and the buffer swap causes glitches
    if (this._isDirty && this._shaderState.timer === null) {
      this._markClean();
    }
    this._isDirty = false;
  }

  /**
   * Generate sixel output for this canvas.
   * Called during render when gfxMode='sixel'.
   */
  private _generateSixelOutput(bounds: Bounds): void {
    // Get sixel capabilities from engine
    const engine = globalThis.melkerEngine;
    const capabilities = engine?.sixelCapabilities;

    if (!capabilities?.supported) {
      this._sixelOutput = null;
      return;
    }

    // Prepare render data
    const data: CanvasRenderData = {
      colorBuffer: this._colorBuffer,
      imageColorBuffer: this._imageColorBuffer,
      bufferWidth: this._bufferWidth,
      bufferHeight: this._bufferHeight,
      scale: this._scale,
      propsWidth: this.props.width,
      propsHeight: this.props.height,
      backgroundColor: this.props.backgroundColor,
    };

    // Determine palette mode based on content type.
    // See src/sixel/palette.ts for detailed documentation on palette modes.
    //
    // - Static images: 'cached' - palette and indexed data computed once, reused
    // - Video/Shaders/Filters/onPaint: 'keyframe' - palette cached from first good frame,
    //   subsequent frames re-indexed against it. Regenerates on >2% color error
    //   or brightness gap. Fast (no quantization per frame).
    const isVideo = (this.type as string) === 'video';
    const isDynamic = !!this.props.onShader || !!this.props.onFilter || !!this.props.onPaint;
    const paletteMode = (isVideo || isDynamic) ? 'keyframe' : 'cached';

    // Cache key includes dimensions - same src at different sizes needs separate entries
    const cacheKey = `${this.props.src || this.id}:${this._bufferWidth}x${this._bufferHeight}`;

    // Determine dither settings for sixel mode
    // Dynamic content benefits from dithering to reduce color banding before 256-color quantization
    let ditherMode: DitherMode | false = false;
    if (isDynamic) {
      const dither = this.props.dither;
      if (dither === undefined || dither === 'auto' || dither === true) {
        // Default to blue-noise for dynamic sixel content
        ditherMode = 'blue-noise';
      } else if (typeof dither === 'string' && dither !== 'none') {
        ditherMode = dither as DitherMode;
      }
    }
    // Priority: prop > env var > default (3 bits = 8 levels per channel)
    const ditherBits = this.props.ditherBits ?? MelkerConfig.get().ditherBits ?? 3;

    this._sixelOutput = generateSixelOutput(bounds, data, capabilities, paletteMode, cacheKey, ditherMode, ditherBits);
    if (this._sixelOutput) {
      this._sixelOutput.elementId = this.id;
    }
  }

  /**
   * Get sixel output data for this canvas (if in sixel mode).
   * Used by engine to render sixel overlays after buffer output.
   */
  getSixelOutput(): SixelOutputData | null {
    return this._sixelOutput;
  }

  /**
   * Check if this canvas is in sixel mode
   */
  isSixelMode(): boolean {
    return getEffectiveGfxMode(this.props.gfxMode) === 'sixel';
  }

  /**
   * Generate kitty output for this canvas.
   * Called during render when gfxMode='kitty'.
   */
  private _generateKittyOutput(bounds: Bounds): void {
    // Get kitty capabilities from engine
    const engine = globalThis.melkerEngine;
    const capabilities = engine?.kittyCapabilities;

    if (!capabilities?.supported) {
      this._kittyOutput = null;
      return;
    }

    // Prepare render data
    const data: CanvasRenderData = {
      colorBuffer: this._colorBuffer,
      imageColorBuffer: this._imageColorBuffer,
      bufferWidth: this._bufferWidth,
      bufferHeight: this._bufferHeight,
      scale: this._scale,
      propsWidth: this.props.width,
      propsHeight: this.props.height,
      backgroundColor: this.props.backgroundColor,
    };

    this._kittyOutput = generateKittyOutput(bounds, data, capabilities, this._renderState);
    if (this._kittyOutput) {
      this._kittyOutput.elementId = this.id;
    }
  }

  /**
   * Get kitty output data for this canvas (if in kitty mode).
   * Used by engine to render kitty overlays after buffer output.
   */
  getKittyOutput(): KittyOutputData | null {
    return this._kittyOutput;
  }

  /**
   * Generate iTerm2 output for this canvas when in iTerm2 mode.
   */
  private _generateITermOutput(bounds: Bounds): void {
    const engine = globalThis.melkerEngine;
    const capabilities = engine?.itermCapabilities;

    if (!capabilities?.supported) {
      this._itermOutput = null;
      return;
    }

    // Prepare render data
    const data: CanvasRenderData = {
      colorBuffer: this._colorBuffer,
      imageColorBuffer: this._imageColorBuffer,
      bufferWidth: this._bufferWidth,
      bufferHeight: this._bufferHeight,
      scale: this._scale,
      propsWidth: this.props.width,
      propsHeight: this.props.height,
      backgroundColor: this.props.backgroundColor,
    };

    this._itermOutput = generateITerm2Output(bounds, data, capabilities, this._renderState);
    if (this._itermOutput) {
      this._itermOutput.elementId = this.id;
    }
  }

  /**
   * Get iTerm2 output data for this canvas (if in iTerm2 mode).
   * Used by engine to render iTerm2 overlays after buffer output.
   */
  getITermOutput(): ITermOutputData | null {
    return this._itermOutput;
  }

  /**
   * Check if this canvas is in iTerm2 mode
   */
  isITermMode(): boolean {
    return getEffectiveGfxMode(this.props.gfxMode) === 'iterm2';
  }

  /**
   * Check if this canvas is in kitty mode
   */
  isKittyMode(): boolean {
    return getEffectiveGfxMode(this.props.gfxMode) === 'kitty';
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

    // If shader is running, stop it and save state for restart
    // We'll restart it after buffer reallocation so it gets a fresh context
    const shaderWasRunning = this._shaderState.timer !== null;
    const savedRequestRender = this._shaderState.requestRender;
    // Preserve elapsed time so animation continues smoothly after resize
    const elapsedTime = shaderWasRunning ? performance.now() - this._shaderState.startTime : 0;
    if (shaderWasRunning) {
      this.stopShader();
    }

    // Update props
    this.props.width = width;
    this.props.height = height;

    // Recalculate buffer dimensions based on gfx mode
    const dims = this._calculateBufferDimensions(width, height, this._scale);
    this._bufferWidth = dims.width;
    this._bufferHeight = dims.height;
    this._pixelsPerCellX = dims.pixelsPerCellX;
    this._pixelsPerCellY = dims.pixelsPerCellY;

    logger.debug('setSize buffer dimensions', {
      terminalSize: `${width}x${height}`,
      bufferSize: `${this._bufferWidth}x${this._bufferHeight}`,
      pixelsPerCell: `${this._pixelsPerCellX}x${this._pixelsPerCellY}`,
      gfxMode: getEffectiveGfxMode(this.props.gfxMode),
    });

    // Reallocate color buffers
    const bufferSize = this._bufferWidth * this._bufferHeight;
    this._colorBuffer = new Uint32Array(bufferSize);
    this._previousColorBuffer = new Uint32Array(bufferSize);
    // Reallocate image background layer buffer
    this._imageColorBuffer = new Uint32Array(bufferSize);
    // Reset shader output buffer (will be reallocated on next frame if needed)
    this._shaderState.outputBuffer = null;
    // Reset dither state (cache will be reallocated on next render if needed)
    this._ditherState.reset();

    // Clear the new canvas and mark as dirty for re-render
    this.markDirty();
    this.clear();

    // Restart shader if it was running, with fresh context pointing to new buffers
    if (shaderWasRunning && this.props.onShader) {
      this.startShader(savedRequestRender ?? undefined);
      // Restore elapsed time so animation continues from where it left off
      this._shaderState.startTime = performance.now() - elapsedTime;
    }
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
import { registerComponent } from '../element.ts';
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
    dither: { type: ['string', 'boolean'], enum: ['auto', 'none', 'floyd-steinberg', 'floyd-steinberg-stable', 'sierra', 'sierra-stable', 'atkinson', 'atkinson-stable', 'ordered', 'blue-noise'], description: 'Dithering algorithm (auto adapts to theme, none disables)' },
    ditherBits: { type: 'number', description: 'Color depth for dithering' },
    gfxMode: { type: 'string', enum: [...GFX_MODES], description: 'Graphics mode (global MELKER_GFX_MODE overrides)' },
    onPaint: { type: ['function', 'string'], description: 'Called when canvas needs repainting, receives event with {canvas, bounds}' },
    onShader: { type: ['function', 'string'], description: 'Shader callback (x, y, time, resolution, source?) => [r,g,b] or [r,g,b,a]. source has getPixel(), mouse, mouseUV' },
    onFilter: { type: ['function', 'string'], description: 'One-time filter callback, runs once when image loads. Same signature as onShader but time is always 0' },
    shaderFps: { type: 'number', description: 'Shader frame rate (default: 30)' },
    shaderRunTime: { type: 'number', description: 'Stop shader after this many ms, final frame becomes static image' },
    isolineCount: { type: 'number', description: 'Number of auto-generated isolines for isolines gfx mode (default: 5, env: MELKER_ISOLINE_COUNT)' },
    isolineMode: { type: 'string', enum: ['equal', 'quantile', 'nice'], description: 'Isoline distribution algorithm (default: equal, env: MELKER_ISOLINE_MODE)' },
    isolines: { type: 'array', description: 'Manual isoline definitions: [{value, color?, label?}]' },
    isolineSource: { type: 'string', enum: ['luma', 'red', 'green', 'blue', 'alpha'], description: 'Color channel for isoline scalar values (default: luma, env: MELKER_ISOLINE_SOURCE)' },
  },
  styleWarnings: {
    width: 'Use width prop instead of style.width for canvas buffer sizing. style.width only affects layout, not pixel resolution.',
    height: 'Use height prop instead of style.height for canvas buffer sizing. style.height only affects layout, not pixel resolution.',
  },
};

registerComponentSchema('canvas', canvasSchema);

// Register canvas component
registerComponent({
  type: 'canvas',
  componentClass: CanvasElement,
  defaultProps: {
    scale: 1,
    disabled: false,
  },
  validate: (props) => CanvasElement.validate(props as any),
});