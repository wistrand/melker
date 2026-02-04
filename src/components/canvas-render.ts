// Canvas terminal rendering - extracted from canvas.ts for modularity
// Handles conversion of pixel buffers to terminal characters (sextant, block, ASCII modes)
// All hot path optimizations preserved via pre-allocated arrays in CanvasRenderState

import { type DualBuffer, type Cell, EMPTY_CHAR } from '../buffer.ts';
import { type Bounds } from '../types.ts';
import { TRANSPARENT, DEFAULT_FG, packRGBA, parseColor } from './color-utils.ts';
import { PIXEL_TO_CHAR, PATTERN_TO_ASCII, LUMA_RAMP } from './canvas-terminal.ts';
import { MelkerConfig } from '../config/mod.ts';
import {
  encodeToSixel,
  positionedSixel,
  quantizePalette,
  type PaletteMode,
  type SixelCapabilities,
} from '../sixel/mod.ts';
import {
  encodeToKitty,
  positionedKitty,
  generateImageId,
  type KittyCapabilities,
} from '../kitty/mod.ts';
import {
  encodeToITerm2,
  positionedITerm2,
  type ITermCapabilities,
} from '../iterm2/mod.ts';
import {
  applyFloydSteinbergDither,
  applyFloydSteinbergStableDither,
  applyAtkinsonDither,
  applyAtkinsonStableDither,
  applyBlueNoiseDither,
  applyOrderedDither,
  applySierraDither,
  applySierraStableDither,
  type DitherMode,
} from '../video/dither.ts';

// Minimal interface for canvas data needed by render functions
export interface CanvasRenderData {
  colorBuffer: Uint32Array;
  imageColorBuffer: Uint32Array;
  bufferWidth: number;
  bufferHeight: number;
  scale: number;
  propsWidth: number;
  propsHeight: number;
  backgroundColor?: number | string;
}

/**
 * Pre-allocated state for canvas rendering operations.
 * Created once per CanvasElement instance to avoid GC pressure in hot paths.
 */
export class CanvasRenderState {
  // Working arrays for _renderToTerminal (avoid per-cell allocations)
  readonly drawingPixels: boolean[] = [false, false, false, false, false, false];
  readonly drawingColors: number[] = [0, 0, 0, 0, 0, 0];
  readonly imagePixels: boolean[] = [false, false, false, false, false, false];
  readonly imageColors: number[] = [0, 0, 0, 0, 0, 0];
  readonly sextantPixels: boolean[] = [false, false, false, false, false, false];
  readonly compositePixels: boolean[] = [false, false, false, false, false, false];
  readonly compositeColors: number[] = [0, 0, 0, 0, 0, 0];
  readonly isDrawing: boolean[] = [false, false, false, false, false, false];

  // Reusable cell style object
  readonly cellStyle: Partial<Cell> = {};

  // Quantization buffers
  readonly qPixels: boolean[] = [false, false, false, false, false, false];
  readonly qBrightness: number[] = [0, 0, 0, 0, 0, 0];
  qFgColor: number = 0;
  qBgColor: number = 0;

  // Kitty compositing buffer (reused across frames, grows as needed)
  private _kittyCompositedBuffer: Uint32Array | null = null;

  // Kitty image cache - skip re-encoding when content unchanged
  private _kittyContentHash: number = 0;
  private _kittyCachedOutput: KittyOutputData | null = null;
  private _kittyCachedBounds: { x: number; y: number; width: number; height: number } | null = null;

  // Stable image ID for this canvas - reused across frames to enable in-place replacement
  // This eliminates flicker from the display+delete cycle that occurs with new IDs each frame
  private _kittyStableImageId: number = generateImageId();

  // iTerm2 image cache - skip re-encoding when content unchanged
  private _itermContentHash: number = 0;
  private _itermCachedOutput: ITermOutputData | null = null;
  private _itermCachedBounds: { x: number; y: number; width: number; height: number } | null = null;

  // iTerm2 compositing buffer (reused across frames, grows as needed)
  private _itermCompositedBuffer: Uint32Array | null = null;

  /**
   * Get or create a kitty compositing buffer of the required size.
   * Reuses existing buffer if large enough, otherwise allocates a new one.
   */
  getKittyCompositedBuffer(pixelCount: number): Uint32Array {
    if (!this._kittyCompositedBuffer || this._kittyCompositedBuffer.length < pixelCount) {
      this._kittyCompositedBuffer = new Uint32Array(pixelCount);
    }
    return this._kittyCompositedBuffer;
  }

  /**
   * Compute a fast hash of a Uint32Array buffer.
   * Uses FNV-1a variant for speed with reasonable collision resistance.
   */
  computeBufferHash(buffer: Uint32Array, length: number): number {
    let hash = 2166136261; // FNV offset basis
    for (let i = 0; i < length; i++) {
      hash ^= buffer[i];
      hash = Math.imul(hash, 16777619); // FNV prime
    }
    return hash >>> 0; // Convert to unsigned
  }

  /**
   * Check if kitty content matches cache and return cached output if so.
   * Returns null if cache miss (content changed or bounds changed).
   */
  getKittyCachedOutput(contentHash: number, bounds: { x: number; y: number; width: number; height: number }): KittyOutputData | null {
    if (
      this._kittyCachedOutput &&
      this._kittyContentHash === contentHash &&
      this._kittyCachedBounds &&
      this._kittyCachedBounds.x === bounds.x &&
      this._kittyCachedBounds.y === bounds.y &&
      this._kittyCachedBounds.width === bounds.width &&
      this._kittyCachedBounds.height === bounds.height
    ) {
      return this._kittyCachedOutput;
    }
    return null;
  }

  /**
   * Store kitty output in cache.
   */
  setKittyCachedOutput(contentHash: number, bounds: { x: number; y: number; width: number; height: number }, output: KittyOutputData): void {
    this._kittyContentHash = contentHash;
    this._kittyCachedBounds = { ...bounds };
    this._kittyCachedOutput = output;
  }

  /**
   * Invalidate kitty cache (e.g., on resize).
   */
  invalidateKittyCache(): void {
    this._kittyContentHash = 0;
    this._kittyCachedOutput = null;
    this._kittyCachedBounds = null;
  }

  /**
   * Get stable image ID for this canvas.
   * Reusing the same ID across frames allows Kitty to replace images in-place,
   * eliminating flicker from the display+delete cycle.
   */
  getKittyStableImageId(): number {
    return this._kittyStableImageId;
  }

  /**
   * Get or create an iTerm2 compositing buffer of the required size.
   * Reuses existing buffer if large enough, otherwise allocates a new one.
   */
  getITermCompositedBuffer(pixelCount: number): Uint32Array {
    if (!this._itermCompositedBuffer || this._itermCompositedBuffer.length < pixelCount) {
      this._itermCompositedBuffer = new Uint32Array(pixelCount);
    }
    return this._itermCompositedBuffer;
  }

  /**
   * Check if iTerm2 content matches cache and return cached output if so.
   * Returns null if cache miss (content changed or bounds changed).
   */
  getITermCachedOutput(contentHash: number, bounds: { x: number; y: number; width: number; height: number }): ITermOutputData | null {
    if (
      this._itermCachedOutput &&
      this._itermContentHash === contentHash &&
      this._itermCachedBounds &&
      this._itermCachedBounds.x === bounds.x &&
      this._itermCachedBounds.y === bounds.y &&
      this._itermCachedBounds.width === bounds.width &&
      this._itermCachedBounds.height === bounds.height
    ) {
      return this._itermCachedOutput;
    }
    return null;
  }

  /**
   * Store iTerm2 output in cache.
   */
  setITermCachedOutput(contentHash: number, bounds: { x: number; y: number; width: number; height: number }, output: ITermOutputData): void {
    this._itermContentHash = contentHash;
    this._itermCachedBounds = { ...bounds };
    this._itermCachedOutput = output;
  }

  /**
   * Invalidate iTerm2 cache (e.g., on resize).
   */
  invalidateITermCache(): void {
    this._itermContentHash = 0;
    this._itermCachedOutput = null;
    this._itermCachedBounds = null;
  }
}

/**
 * Quantize 6 colors into foreground/background groups for sextant rendering.
 * Uses median brightness split with averaged colors per group.
 * Results stored in state.qFgColor, state.qBgColor, and sextantPixels array.
 */
export function quantizeBlockColorsInline(
  colors: number[],
  sextantPixels: boolean[],
  state: CanvasRenderState
): void {
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
      state.qBrightness[i] = bright;
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
      state.qBrightness[i] = -1;
    }
  }

  if (validCount === 0) {
    state.qFgColor = 0;
    state.qBgColor = 0;
    return;
  }

  if (allSame) {
    for (let i = 0; i < 6; i++) {
      if (colors[i] !== TRANSPARENT) sextantPixels[i] = true;
    }
    state.qFgColor = firstColor;
    state.qBgColor = firstColor;
    return;
  }

  // Second pass: partition by threshold and accumulate color sums
  let threshold = (minBright + maxBright) >> 1;
  let fgR = 0, fgG = 0, fgB = 0, fgCount = 0;
  let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;

  for (let i = 0; i < 6; i++) {
    const bright = state.qBrightness[i];
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
      const bright = state.qBrightness[i];
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
    state.qFgColor = packRGBA(
      (fgR / fgCount) | 0,
      (fgG / fgCount) | 0,
      (fgB / fgCount) | 0,
      255
    );
  } else {
    state.qFgColor = 0;
  }

  if (bgCount > 0) {
    state.qBgColor = packRGBA(
      (bgR / bgCount) | 0,
      (bgG / bgCount) | 0,
      (bgB / bgCount) | 0,
      255
    );
  } else {
    state.qBgColor = 0;
  }

  // Fallback: if one group empty, use the other's color for both
  if (state.qFgColor === 0 && state.qBgColor !== 0) {
    state.qFgColor = state.qBgColor;
  } else if (state.qBgColor === 0 && state.qFgColor !== 0) {
    state.qBgColor = state.qFgColor;
  }
}

/**
 * Sixel placeholder: fills region with spaces so buffer content doesn't flash before sixel overlay.
 * The sixel overlay is drawn AFTER buffer output, covering whatever the buffer shows.
 */
export function renderSixelPlaceholder(
  bounds: Bounds,
  style: Partial<Cell>,
  buffer: DualBuffer,
  terminalWidth: number,
  terminalHeight: number,
  data: CanvasRenderData
): void {
  // Use style background, props background, or transparent
  const hasStyleBg = style.background !== undefined;
  const propsBg = data.backgroundColor ? parseColor(data.backgroundColor) : undefined;
  const bgColor = hasStyleBg ? style.background : (propsBg ?? TRANSPARENT);

  for (let ty = 0; ty < terminalHeight; ty++) {
    for (let tx = 0; tx < terminalWidth; tx++) {
      buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
        char: '.',
        foreground: bgColor !== TRANSPARENT ? bgColor : 0x666666FF,
        background: TRANSPARENT,
      });
    }
  }
}

/**
 * Sixel output data for a canvas element
 */
export interface SixelOutputData {
  /** Positioned sixel sequence (includes cursor save/restore) */
  data: string;
  /** Canvas bounds for occlusion detection */
  bounds: Bounds;
  /** Element ID for tracking */
  elementId?: string;
}

/**
 * Kitty output data for a canvas element
 */
export interface KittyOutputData {
  /** Positioned kitty sequence (includes cursor positioning) */
  data: string;
  /** Canvas bounds for occlusion detection */
  bounds: Bounds;
  /** Image ID for cleanup/deletion */
  imageId: number;
  /** Element ID for tracking */
  elementId?: string;
  /** True if this output is from cache (already displayed, skip writing) */
  fromCache?: boolean;
}

/**
 * iTerm2 output data for a canvas element
 */
export interface ITermOutputData {
  /** Positioned iTerm2 sequence (includes cursor positioning) */
  data: string;
  /** Canvas bounds for occlusion detection */
  bounds: Bounds;
  /** Element ID for tracking */
  elementId?: string;
  /** True if this output is from cache (already displayed, skip writing) */
  fromCache?: boolean;
}

/**
 * Scale pixel buffer using nearest-neighbor interpolation.
 * Fast and preserves hard edges.
 */
function scalePixelBuffer(
  src: Uint32Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): Uint32Array {
  const dst = new Uint32Array(dstWidth * dstHeight);

  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;

  for (let y = 0; y < dstHeight; y++) {
    const srcY = Math.floor(y * yRatio);
    const srcRowOffset = srcY * srcWidth;
    const dstRowOffset = y * dstWidth;

    for (let x = 0; x < dstWidth; x++) {
      const srcX = Math.floor(x * xRatio);
      dst[dstRowOffset + x] = src[srcRowOffset + srcX];
    }
  }

  return dst;
}

/**
 * Generate sixel output from canvas data.
 * Returns positioned sixel sequence ready to write to terminal.
 * Scales image to fill the terminal cell area at full pixel resolution.
 *
 * @param ditherMode - Optional dithering mode to apply before quantization.
 *                     Reduces color banding for dynamic content (onPaint/onShader/onFilter).
 * @param ditherBits - Bits per channel for dithering (default 3 = 8 levels per channel).
 */
export function generateSixelOutput(
  bounds: Bounds,
  data: CanvasRenderData,
  capabilities: SixelCapabilities,
  paletteMode: PaletteMode = 'cached',
  cacheKey?: string,
  ditherMode?: DitherMode | false,
  ditherBits?: number
): SixelOutputData | null {
  if (!capabilities.supported) {
    return null;
  }

  // Composite drawing layer over image layer
  const pixelCount = data.bufferWidth * data.bufferHeight;
  const composited = new Uint32Array(pixelCount);
  let hasContent = false;

  for (let i = 0; i < pixelCount; i++) {
    const drawColor = data.colorBuffer[i];
    const imageColor = data.imageColorBuffer[i];

    // Drawing layer takes priority over image layer
    if (drawColor !== TRANSPARENT) {
      composited[i] = drawColor;
      hasContent = true;
    } else if (imageColor !== TRANSPARENT) {
      composited[i] = imageColor;
      hasContent = true;
    } else {
      // Transparent - use background color or transparent
      const bgColor = data.backgroundColor ? parseColor(data.backgroundColor) : TRANSPARENT;
      composited[i] = bgColor ?? TRANSPARENT;
    }
  }

  // Skip if no content (e.g., image not yet loaded)
  if (!hasContent) {
    return null;
  }

  // Calculate target pixel dimensions based on terminal cell size
  // Use min(props, bounds) to match the placeholder and other render modes
  let terminalWidth = Math.min(data.propsWidth, bounds.width);
  const terminalHeight = Math.min(data.propsHeight, bounds.height);

  // Workaround for terminal edge rendering glitch (same as sextant path)
  // When canvas extends to exact right edge, skip the last column to avoid artifacts
  const engine = globalThis.melkerEngine;
  if (engine && bounds.x + terminalWidth >= engine.terminalSize?.width) {
    terminalWidth = Math.max(1, terminalWidth - 1);
  }

  const rawTargetWidth = terminalWidth * capabilities.cellWidth;
  const rawTargetHeight = terminalHeight * capabilities.cellHeight;

  // Round height DOWN to nearest multiple of 6 (sixel row height)
  // This ensures the sixel doesn't extend beyond the intended cell bounds
  // Without this, ceil(height/6)*6 pixels would be rendered, potentially
  // bleeding into the next row of terminal cells
  const targetWidth = rawTargetWidth;
  const targetHeight = Math.floor(rawTargetHeight / 6) * 6;

  // Scale composited buffer to target size if different
  let scaledBuffer: Uint32Array = composited;
  let finalWidth = data.bufferWidth;
  let finalHeight = data.bufferHeight;

  if (targetWidth !== data.bufferWidth || targetHeight !== data.bufferHeight) {
    scaledBuffer = scalePixelBuffer(
      composited,
      data.bufferWidth,
      data.bufferHeight,
      targetWidth,
      targetHeight
    ) as Uint32Array;
    finalWidth = targetWidth;
    finalHeight = targetHeight;
  }

  // Apply dithering before quantization (reduces color banding for dynamic content)
  if (ditherMode && ditherMode !== 'none') {
    const bits = ditherBits ?? 3;  // 3 bits = 8 levels per channel
    const pixelCount = finalWidth * finalHeight;

    // Convert Uint32Array (packed RGBA) to Uint8Array (interleaved RGBA) for dithering
    const rgba = new Uint8Array(pixelCount * 4);
    for (let i = 0; i < pixelCount; i++) {
      const c = scaledBuffer[i];
      rgba[i * 4] = (c >>> 24) & 0xff;      // R
      rgba[i * 4 + 1] = (c >>> 16) & 0xff;  // G
      rgba[i * 4 + 2] = (c >>> 8) & 0xff;   // B
      rgba[i * 4 + 3] = c & 0xff;           // A
    }

    // Apply selected dither algorithm
    switch (ditherMode) {
      case 'ordered':
        applyOrderedDither(rgba, finalWidth, finalHeight, bits);
        break;
      case 'floyd-steinberg':
        applyFloydSteinbergDither(rgba, finalWidth, finalHeight, bits);
        break;
      case 'floyd-steinberg-stable':
        applyFloydSteinbergStableDither(rgba, finalWidth, finalHeight, bits);
        break;
      case 'sierra':
        applySierraDither(rgba, finalWidth, finalHeight, bits);
        break;
      case 'sierra-stable':
        applySierraStableDither(rgba, finalWidth, finalHeight, bits);
        break;
      case 'atkinson':
        applyAtkinsonDither(rgba, finalWidth, finalHeight, bits);
        break;
      case 'atkinson-stable':
        applyAtkinsonStableDither(rgba, finalWidth, finalHeight, bits);
        break;
      case 'blue-noise':
      default:
        applyBlueNoiseDither(rgba, finalWidth, finalHeight, bits);
        break;
    }

    // Convert back to Uint32Array (packed RGBA)
    for (let i = 0; i < pixelCount; i++) {
      scaledBuffer[i] = packRGBA(
        rgba[i * 4],
        rgba[i * 4 + 1],
        rgba[i * 4 + 2],
        rgba[i * 4 + 3]
      );
    }
  }

  // Quantize to palette
  // Use 255 max - some terminals (Konsole) have issues with color index 255
  const maxColors = Math.min(capabilities.colorRegisters, 255);
  const paletteResult = quantizePalette(scaledBuffer, paletteMode, maxColors, cacheKey);

  // Skip if palette is empty (shouldn't happen if hasContent, but safety check)
  if (paletteResult.colors.length === 0) {
    return null;
  }

  // Encode to sixel
  const sixelOutput = encodeToSixel({
    palette: paletteResult.colors,
    indexed: paletteResult.indexed,
    width: finalWidth,
    height: finalHeight,
    transparentIndex: paletteResult.transparentIndex,
    useRLE: true,
  });

  // Position at canvas bounds
  const positioned = positionedSixel(sixelOutput.data, bounds.x, bounds.y);

  // Return bounds that reflect actual sixel coverage (may be smaller than layout bounds)
  return {
    data: positioned,
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: terminalWidth,
      height: terminalHeight,
    },
  };
}

/**
 * Generate Kitty graphics output from canvas data.
 * Returns positioned Kitty sequence ready to write to terminal.
 * Simpler than sixel - no quantization needed, supports full 32-bit RGBA.
 */
export function generateKittyOutput(
  bounds: Bounds,
  data: CanvasRenderData,
  capabilities: KittyCapabilities,
  renderState?: CanvasRenderState,
): KittyOutputData | null {
  if (!capabilities.supported) {
    return null;
  }

  // Composite drawing layer over image layer
  const pixelCount = data.bufferWidth * data.bufferHeight;
  // Reuse buffer from render state if available, otherwise allocate
  const composited = renderState
    ? renderState.getKittyCompositedBuffer(pixelCount)
    : new Uint32Array(pixelCount);
  let hasContent = false;

  // Parse background color once outside loop
  const bgColor = data.backgroundColor ? (parseColor(data.backgroundColor) ?? TRANSPARENT) : TRANSPARENT;

  for (let i = 0; i < pixelCount; i++) {
    const drawColor = data.colorBuffer[i];
    const imageColor = data.imageColorBuffer[i];

    // Drawing layer takes priority over image layer
    if (drawColor !== TRANSPARENT) {
      composited[i] = drawColor;
      hasContent = true;
    } else if (imageColor !== TRANSPARENT) {
      composited[i] = imageColor;
      hasContent = true;
    } else {
      // Transparent - use background color
      composited[i] = bgColor;
    }
  }

  // Skip if no content (e.g., image not yet loaded)
  if (!hasContent) {
    return null;
  }

  // Calculate target terminal dimensions
  let terminalWidth = Math.min(data.propsWidth, bounds.width);
  const terminalHeight = Math.min(data.propsHeight, bounds.height);

  // Workaround for terminal edge rendering glitch (same as sextant/sixel path)
  const engine = globalThis.melkerEngine;
  if (engine && bounds.x + terminalWidth >= engine.terminalSize?.width) {
    terminalWidth = Math.max(1, terminalWidth - 1);
  }

  // Check cache if render state available
  if (renderState) {
    const contentHash = renderState.computeBufferHash(composited, pixelCount);
    const targetBounds = { x: bounds.x, y: bounds.y, width: terminalWidth, height: terminalHeight };

    const cached = renderState.getKittyCachedOutput(contentHash, targetBounds);
    if (cached) {
      // Cache hit - return existing output with fromCache flag
      // Engine will skip writing to terminal (image already displayed)
      return { ...cached, fromCache: true };
    }

    // Cache miss - encode and store using stable image ID
    // Stable ID enables in-place replacement, eliminating display+delete flicker
    const kittyOutput = encodeToKitty({
      pixels: composited,
      width: data.bufferWidth,
      height: data.bufferHeight,
      format: 'rgba',
      columns: terminalWidth,
      rows: terminalHeight,
      imageId: renderState.getKittyStableImageId(),
    });

    const positioned = positionedKitty(kittyOutput, bounds.x + 1, bounds.y + 1);

    const output: KittyOutputData = {
      data: positioned,
      bounds: targetBounds,
      imageId: kittyOutput.imageId,
    };

    renderState.setKittyCachedOutput(contentHash, targetBounds, output);
    return output;
  }

  // No render state - encode without caching (fallback path)
  const kittyOutput = encodeToKitty({
    pixels: composited,
    width: data.bufferWidth,
    height: data.bufferHeight,
    format: 'rgba',
    columns: terminalWidth,
    rows: terminalHeight,
  });

  // Position at canvas bounds (col and row are 1-based for ANSI cursor)
  const positioned = positionedKitty(kittyOutput, bounds.x + 1, bounds.y + 1);

  return {
    data: positioned,
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: terminalWidth,
      height: terminalHeight,
    },
    imageId: kittyOutput.imageId,
  };
}

/**
 * Kitty placeholder: fills region with dots so buffer content doesn't flash before kitty overlay.
 * Similar to sixel placeholder.
 */
export function renderKittyPlaceholder(
  bounds: Bounds,
  style: Partial<Cell>,
  buffer: DualBuffer,
  terminalWidth: number,
  terminalHeight: number,
  data: CanvasRenderData
): void {
  // Use style background, props background, or transparent
  const hasStyleBg = style.background !== undefined;
  const propsBg = data.backgroundColor ? parseColor(data.backgroundColor) : undefined;
  const bgColor = hasStyleBg ? style.background : (propsBg ?? TRANSPARENT);

  for (let ty = 0; ty < terminalHeight; ty++) {
    for (let tx = 0; tx < terminalWidth; tx++) {
      buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
        char: '.',
        foreground: bgColor !== TRANSPARENT ? bgColor : 0x666666FF,
        background: TRANSPARENT,
      });
    }
  }
}

/**
 * Generate iTerm2 graphics output from canvas data.
 * Returns positioned iTerm2 sequence ready to write to terminal.
 * Uses pixel dimensions for display size to ensure correct aspect ratio.
 */
export function generateITerm2Output(
  bounds: Bounds,
  data: CanvasRenderData,
  capabilities: ITermCapabilities,
  renderState?: CanvasRenderState,
): ITermOutputData | null {
  if (!capabilities.supported) {
    return null;
  }

  // Composite drawing layer over image layer
  const pixelCount = data.bufferWidth * data.bufferHeight;
  // Reuse buffer from render state if available, otherwise allocate
  const composited = renderState
    ? renderState.getITermCompositedBuffer(pixelCount)
    : new Uint32Array(pixelCount);
  let hasContent = false;

  // Parse background color once outside loop
  const bgColor = data.backgroundColor ? (parseColor(data.backgroundColor) ?? TRANSPARENT) : TRANSPARENT;

  for (let i = 0; i < pixelCount; i++) {
    const drawColor = data.colorBuffer[i];
    const imageColor = data.imageColorBuffer[i];

    // Drawing layer takes priority over image layer
    if (drawColor !== TRANSPARENT) {
      composited[i] = drawColor;
      hasContent = true;
    } else if (imageColor !== TRANSPARENT) {
      composited[i] = imageColor;
      hasContent = true;
    } else {
      // Transparent - use background color
      composited[i] = bgColor;
    }
  }

  // Skip if no content (e.g., image not yet loaded)
  if (!hasContent) {
    return null;
  }

  // Calculate target terminal dimensions
  let terminalWidth = Math.min(data.propsWidth, bounds.width);
  const terminalHeight = Math.min(data.propsHeight, bounds.height);

  // Workaround for terminal edge rendering glitch (same as sextant/sixel/kitty path)
  const engine = globalThis.melkerEngine;
  if (engine && bounds.x + terminalWidth >= engine.terminalSize?.width) {
    terminalWidth = Math.max(1, terminalWidth - 1);
  }

  // Get cell dimensions from sixel capabilities (detected via terminal query)
  // Fall back to common defaults if not available
  const cellWidth = engine?.sixelCapabilities?.cellWidth || 8;
  const cellHeight = engine?.sixelCapabilities?.cellHeight || 16;

  // Calculate target pixel dimensions for display
  // Use "Npx" format to tell iTerm2 exact pixel size (ensures correct aspect ratio)
  const displayWidthPx = `${terminalWidth * cellWidth}px`;
  const displayHeightPx = `${terminalHeight * cellHeight}px`;

  // Check cache if render state available
  if (renderState) {
    const contentHash = renderState.computeBufferHash(composited, pixelCount);
    const targetBounds = { x: bounds.x, y: bounds.y, width: terminalWidth, height: terminalHeight };

    const cached = renderState.getITermCachedOutput(contentHash, targetBounds);
    if (cached) {
      // Cache hit - return existing output with fromCache flag
      return { ...cached, fromCache: true };
    }

    // Cache miss - encode and store
    // Pass original buffer, let iTerm2 scale to pixel dimensions
    const itermOutput = encodeToITerm2({
      pixels: composited,
      width: data.bufferWidth,
      height: data.bufferHeight,
      displayWidth: displayWidthPx,
      displayHeight: displayHeightPx,
      preserveAspectRatio: false,  // We specify exact dimensions
      useMultipart: capabilities.useMultipart,
    });

    // Position at canvas bounds (col and row are 1-based for ANSI cursor)
    const positioned = positionedITerm2(itermOutput, bounds.x + 1, bounds.y + 1);

    const output: ITermOutputData = {
      data: positioned,
      bounds: targetBounds,
    };

    renderState.setITermCachedOutput(contentHash, targetBounds, output);
    return output;
  }

  // No render state - encode without caching (fallback path)
  const itermOutput = encodeToITerm2({
    pixels: composited,
    width: data.bufferWidth,
    height: data.bufferHeight,
    displayWidth: displayWidthPx,
    displayHeight: displayHeightPx,
    preserveAspectRatio: false,  // We specify exact dimensions
    useMultipart: capabilities.useMultipart,
  });

  // Position at canvas bounds (col and row are 1-based for ANSI cursor)
  const positioned = positionedITerm2(itermOutput, bounds.x + 1, bounds.y + 1);

  return {
    data: positioned,
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: terminalWidth,
      height: terminalHeight,
    },
  };
}

/**
 * iTerm2 placeholder: fills region with dots so buffer content doesn't flash before iTerm2 overlay.
 * Similar to sixel/kitty placeholder.
 */
export function renderITermPlaceholder(
  bounds: Bounds,
  style: Partial<Cell>,
  buffer: DualBuffer,
  terminalWidth: number,
  terminalHeight: number,
  data: CanvasRenderData
): void {
  // Use style background, props background, or transparent
  const hasStyleBg = style.background !== undefined;
  const propsBg = data.backgroundColor ? parseColor(data.backgroundColor) : undefined;
  const bgColor = hasStyleBg ? style.background : (propsBg ?? TRANSPARENT);

  for (let ty = 0; ty < terminalHeight; ty++) {
    for (let tx = 0; tx < terminalWidth; tx++) {
      buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
        char: '.',
        foreground: bgColor !== TRANSPARENT ? bgColor : 0x666666FF,
        background: TRANSPARENT,
      });
    }
  }
}

/**
 * Block mode rendering: 1 colored space per terminal cell (no sextant characters)
 * Each cell shows averaged color from the corresponding 2x3 pixel region
 */
export function renderBlockMode(
  bounds: Bounds,
  style: Partial<Cell>,
  buffer: DualBuffer,
  terminalWidth: number,
  terminalHeight: number,
  data: CanvasRenderData
): void {
  const bufW = data.bufferWidth;
  const bufH = data.bufferHeight;
  const scale = data.scale;
  const halfScale = scale >> 1;
  const hasStyleBg = style.background !== undefined;
  const propsBg = data.backgroundColor ? parseColor(data.backgroundColor) : undefined;

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
          let color = data.colorBuffer[bufIndex];
          if (color === TRANSPARENT) {
            color = data.imageColorBuffer[bufIndex];
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
      let bgColor: number | undefined;
      if (count > 0) {
        const avgR = Math.round(totalR / count);
        const avgG = Math.round(totalG / count);
        const avgB = Math.round(totalB / count);
        bgColor = packRGBA(avgR, avgG, avgB, 255);
      } else {
        bgColor = propsBg ?? (hasStyleBg ? style.background : undefined);
      }

      // Skip empty cells with no background
      if (!bgColor) continue;

      buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
        char: EMPTY_CHAR,
        background: bgColor,
        bold: style.bold,
        dim: style.dim,
      });
    }
  }
}

/**
 * ASCII mode rendering - converts canvas to ASCII characters.
 * Two modes:
 * - 'pattern': Maps 2x3 sextant patterns to spatially-similar ASCII chars
 * - 'luma': Maps pixel brightness to density character ramp
 */
export function renderAsciiMode(
  bounds: Bounds,
  style: Partial<Cell>,
  buffer: DualBuffer,
  terminalWidth: number,
  terminalHeight: number,
  mode: 'pattern' | 'luma',
  data: CanvasRenderData
): void {
  const bufW = data.bufferWidth;
  const bufH = data.bufferHeight;
  const scale = data.scale;
  const halfScale = scale >> 1;
  const hasStyleFg = style.foreground !== undefined;
  const hasStyleBg = style.background !== undefined;
  const propsBg = data.backgroundColor ? parseColor(data.backgroundColor) : undefined;

  for (let ty = 0; ty < terminalHeight; ty++) {
    const baseBufferY = ty * 3 * scale;

    for (let tx = 0; tx < terminalWidth; tx++) {
      const baseBufferX = tx * 2 * scale;

      if (mode === 'luma') {
        // Luminance mode: average brightness → density character
        let totalR = 0, totalG = 0, totalB = 0, count = 0;

        for (let py = 0; py < 3; py++) {
          const bufferY = baseBufferY + py * scale + halfScale;
          if (bufferY < 0 || bufferY >= bufH) continue;
          const rowOffset = bufferY * bufW;

          for (let px = 0; px < 2; px++) {
            const bufferX = baseBufferX + px * scale + halfScale;
            if (bufferX < 0 || bufferX >= bufW) continue;

            const bufIndex = rowOffset + bufferX;
            let color = data.colorBuffer[bufIndex];
            if (color === TRANSPARENT) {
              color = data.imageColorBuffer[bufIndex];
            }
            if (color !== TRANSPARENT) {
              totalR += (color >> 24) & 0xFF;
              totalG += (color >> 16) & 0xFF;
              totalB += (color >> 8) & 0xFF;
              count++;
            }
          }
        }

        if (count === 0) continue;

        const avgR = totalR / count;
        const avgG = totalG / count;
        const avgB = totalB / count;
        // Perceptual luminance: 0.299*R + 0.587*G + 0.114*B
        const luma = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;
        const charIndex = Math.floor((luma / 255) * (LUMA_RAMP.length - 1));
        const char = LUMA_RAMP[Math.min(charIndex, LUMA_RAMP.length - 1)];

        if (char === ' ') continue;

        const fgColor = packRGBA(Math.round(avgR), Math.round(avgG), Math.round(avgB), 255);
        buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
          char,
          foreground: fgColor ?? (hasStyleFg ? style.foreground : undefined),
          background: propsBg ?? (hasStyleBg ? style.background : undefined),
          bold: style.bold,
          dim: style.dim,
        });
      } else {
        // Pattern mode: use brightness thresholding to determine pattern
        // Similar to sextant quantization - bright pixels are "on", dark are "off"
        const colors: number[] = [0, 0, 0, 0, 0, 0];
        const brightness: number[] = [-1, -1, -1, -1, -1, -1];
        let minBright = 256, maxBright = -1;
        let validCount = 0;

        // Sample 2x3 grid - index matches bit position
        // Index: 0=top-left, 1=top-right, 2=mid-left, 3=mid-right, 4=bot-left, 5=bot-right
        const positions = [
          [0, 0], [1, 0],  // top row
          [0, 1], [1, 1],  // mid row
          [0, 2], [1, 2],  // bottom row
        ];

        for (let i = 0; i < 6; i++) {
          const [px, py] = positions[i];
          const bufferX = baseBufferX + px * scale + halfScale;
          const bufferY = baseBufferY + py * scale + halfScale;
          if (bufferX < 0 || bufferX >= bufW || bufferY < 0 || bufferY >= bufH) continue;

          const bufIndex = bufferY * bufW + bufferX;
          let color = data.colorBuffer[bufIndex];
          if (color === TRANSPARENT) {
            color = data.imageColorBuffer[bufIndex];
          }
          if (color !== TRANSPARENT) {
            colors[i] = color;
            const r = (color >> 24) & 0xFF;
            const g = (color >> 16) & 0xFF;
            const b = (color >> 8) & 0xFF;
            const bright = (r * 77 + g * 150 + b * 29) >> 8;
            brightness[i] = bright;
            if (bright < minBright) minBright = bright;
            if (bright > maxBright) maxBright = bright;
            validCount++;
          }
        }

        if (validCount === 0) continue;

        // Use brightness threshold to determine pattern
        const threshold = (minBright + maxBright) >> 1;
        let pattern = 0;
        let fgR = 0, fgG = 0, fgB = 0, fgCount = 0;

        // Bit positions: 5=top-left, 4=top-right, 3=mid-left, 2=mid-right, 1=bot-left, 0=bot-right
        const bitPos = [5, 4, 3, 2, 1, 0];
        for (let i = 0; i < 6; i++) {
          if (brightness[i] >= threshold) {
            pattern |= (1 << bitPos[i]);
            const color = colors[i];
            fgR += (color >> 24) & 0xFF;
            fgG += (color >> 16) & 0xFF;
            fgB += (color >> 8) & 0xFF;
            fgCount++;
          }
        }

        if (pattern === 0) continue;

        const char = PATTERN_TO_ASCII[pattern];
        if (char === ' ') continue;

        let fgColor: number | undefined;
        if (fgCount > 0) {
          fgColor = packRGBA(
            Math.round(fgR / fgCount),
            Math.round(fgG / fgCount),
            Math.round(fgB / fgCount),
            255
          );
        }

        buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
          char,
          foreground: fgColor ?? (hasStyleFg ? style.foreground : undefined),
          background: propsBg ?? (hasStyleBg ? style.background : undefined),
          bold: style.bold,
          dim: style.dim,
        });
      }
    }
  }
}

/**
 * Render from dithered buffer to terminal.
 * Uses the pre-composited and dithered RGBA buffer for output.
 */
export function renderDitheredToTerminal(
  bounds: Bounds,
  style: Partial<Cell>,
  buffer: DualBuffer,
  ditheredBuffer: Uint8Array,
  gfxMode: ResolvedGfxMode,
  data: CanvasRenderData,
  state: CanvasRenderState
): void {
  let terminalWidth = Math.min(data.propsWidth, bounds.width);
  const terminalHeight = Math.min(data.propsHeight, bounds.height);
  const bufW = data.bufferWidth;
  const bufH = data.bufferHeight;
  const scale = data.scale;
  const halfScale = scale >> 1;

  // Workaround for terminal edge rendering glitch (same as non-dithered path)
  const engine = globalThis.melkerEngine;
  if (engine && bounds.x + terminalWidth >= engine.terminalSize?.width) {
    terminalWidth = Math.max(1, terminalWidth - 1);
  }

  // Use pre-allocated arrays
  const sextantPixels = state.sextantPixels;
  const sextantColors = state.compositeColors;

  // Pre-compute base style properties
  const hasStyleFg = style.foreground !== undefined;
  const hasStyleBg = style.background !== undefined;
  const propsBg = data.backgroundColor ? parseColor(data.backgroundColor) : undefined;

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
      if (gfxMode === 'block') {
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
          ? packRGBA(Math.round(totalR / count), Math.round(totalG / count), Math.round(totalB / count), 255)
          : propsBg ?? (hasStyleBg ? style.background : undefined);

        if (!avgColor) continue;

        buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
          char: EMPTY_CHAR,
          background: avgColor,
          bold: style.bold,
          dim: style.dim,
        });
        continue;
      }

      // ASCII mode: convert dithered pixels to ASCII characters
      if (gfxMode === 'pattern' || gfxMode === 'luma') {
        if (!hasAnyPixel) continue;

        let char: string;
        let fgColor: number | undefined;

        if (gfxMode === 'luma') {
          // Luminance mode: average brightness → density character
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
          if (count === 0) continue;

          const avgR = totalR / count;
          const avgG = totalG / count;
          const avgB = totalB / count;
          const luma = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;
          const charIndex = Math.floor((luma / 255) * (LUMA_RAMP.length - 1));
          char = LUMA_RAMP[Math.min(charIndex, LUMA_RAMP.length - 1)];
          fgColor = packRGBA(Math.round(avgR), Math.round(avgG), Math.round(avgB), 255);
        } else {
          // Pattern mode: use brightness thresholding
          const brightness: number[] = [-1, -1, -1, -1, -1, -1];
          let minBright = 256, maxBright = -1;
          let validCount = 0;

          for (let i = 0; i < 6; i++) {
            const color = sextantColors[i];
            if (color !== TRANSPARENT) {
              const r = (color >> 24) & 0xFF;
              const g = (color >> 16) & 0xFF;
              const b = (color >> 8) & 0xFF;
              const bright = (r * 77 + g * 150 + b * 29) >> 8;
              brightness[i] = bright;
              if (bright < minBright) minBright = bright;
              if (bright > maxBright) maxBright = bright;
              validCount++;
            }
          }
          if (validCount === 0) continue;

          // Threshold and build pattern
          const threshold = (minBright + maxBright) >> 1;
          let pattern = 0;
          let fgR = 0, fgG = 0, fgB = 0, fgCount = 0;

          // Bit positions: 5=top-left, 4=top-right, 3=mid-left, 2=mid-right, 1=bot-left, 0=bot-right
          const bitPos = [5, 4, 3, 2, 1, 0];
          for (let i = 0; i < 6; i++) {
            if (brightness[i] >= threshold) {
              pattern |= (1 << bitPos[i]);
              const color = sextantColors[i];
              fgR += (color >> 24) & 0xFF;
              fgG += (color >> 16) & 0xFF;
              fgB += (color >> 8) & 0xFF;
              fgCount++;
            }
          }

          if (pattern === 0) continue;
          char = PATTERN_TO_ASCII[pattern];
          if (fgCount > 0) {
            fgColor = packRGBA(Math.round(fgR / fgCount), Math.round(fgG / fgCount), Math.round(fgB / fgCount), 255);
          }
        }

        if (char === ' ') continue;

        buffer.currentBuffer.setCell(bounds.x + tx, bounds.y + ty, {
          char,
          foreground: fgColor ?? (hasStyleFg ? style.foreground : undefined),
          background: propsBg ?? (hasStyleBg ? style.background : undefined),
          bold: style.bold,
          dim: style.dim,
        });
        continue;
      }

      // Use quantization for color selection (same as image path)
      quantizeBlockColorsInline(sextantColors, sextantPixels, state);
      const fgColor = state.qFgColor !== 0 ? state.qFgColor : undefined;
      const bgColor = state.qBgColor !== 0 ? state.qBgColor : undefined;

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
      const cellStyle = state.cellStyle;
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
 * Main sextant render path - converts pixel buffers to terminal sextant characters.
 * Handles compositing of drawing and image layers with optimized hot path.
 */
export function renderSextantToTerminal(
  bounds: Bounds,
  style: Partial<Cell>,
  buffer: DualBuffer,
  data: CanvasRenderData,
  state: CanvasRenderState
): void {
  let terminalWidth = Math.min(data.propsWidth, bounds.width);
  const terminalHeight = Math.min(data.propsHeight, bounds.height);
  const bufW = data.bufferWidth;
  const bufH = data.bufferHeight;
  const scale = data.scale;
  const halfScale = scale >> 1;

  // Workaround for terminal edge rendering glitch:
  // When canvas extends to the exact right edge of the terminal, some terminals
  // have issues with sextant characters in the last column (autowrap, width calculation).
  // Skip the last column when we're at the terminal edge to avoid visual artifacts.
  const engine = globalThis.melkerEngine;
  if (engine && bounds.x + terminalWidth >= engine.terminalSize?.width) {
    terminalWidth = Math.max(1, terminalWidth - 1);
  }

  // Use pre-allocated arrays
  const drawingPixels = state.drawingPixels;
  const drawingColors = state.drawingColors;
  const imagePixels = state.imagePixels;
  const imageColors = state.imageColors;
  const sextantPixels = state.sextantPixels;
  const compositePixels = state.compositePixels;
  const compositeColors = state.compositeColors;
  const isDrawing = state.isDrawing;

  // Pre-compute base style properties
  const hasStyleFg = style.foreground !== undefined;
  const hasStyleBg = style.background !== undefined;
  const propsBg = data.backgroundColor ? parseColor(data.backgroundColor) : undefined;

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
          drawingColors[0] = data.colorBuffer[bufIndex];
          drawingPixels[0] = drawingColors[0] !== TRANSPARENT;
          imageColors[0] = data.imageColorBuffer[bufIndex];
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
          drawingColors[1] = data.colorBuffer[bufIndex];
          drawingPixels[1] = drawingColors[1] !== TRANSPARENT;
          imageColors[1] = data.imageColorBuffer[bufIndex];
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
          drawingColors[2] = data.colorBuffer[bufIndex];
          drawingPixels[2] = drawingColors[2] !== TRANSPARENT;
          imageColors[2] = data.imageColorBuffer[bufIndex];
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
          drawingColors[3] = data.colorBuffer[bufIndex];
          drawingPixels[3] = drawingColors[3] !== TRANSPARENT;
          imageColors[3] = data.imageColorBuffer[bufIndex];
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
          drawingColors[4] = data.colorBuffer[bufIndex];
          drawingPixels[4] = drawingColors[4] !== TRANSPARENT;
          imageColors[4] = data.imageColorBuffer[bufIndex];
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
          drawingColors[5] = data.colorBuffer[bufIndex];
          drawingPixels[5] = drawingColors[5] !== TRANSPARENT;
          imageColors[5] = data.imageColorBuffer[bufIndex];
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

      let fgColor: number | undefined;
      let bgColor: number | undefined;

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

        if (fgColorVal !== 0) fgColor = fgColorVal;
        if (bgColorVal !== 0) bgColor = bgColorVal;

      } else if (hasImageOn && !hasDrawingOn) {
        // Image-only block: use color quantization for sextant detail
        quantizeBlockColorsInline(imageColors, sextantPixels, state);
        fgColor = state.qFgColor !== 0 ? state.qFgColor : undefined;
        bgColor = state.qBgColor !== 0 ? state.qBgColor : undefined;

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

        if (fgColorVal !== 0) fgColor = fgColorVal;
        if (bgColorVal !== 0) bgColor = bgColorVal;
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
      const cellStyle = state.cellStyle;
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
 * Main entry point for canvas terminal rendering.
 * Dispatches to appropriate render mode based on config and dither state.
 */
export function renderToTerminal(
  bounds: Bounds,
  style: Partial<Cell>,
  buffer: DualBuffer,
  data: CanvasRenderData,
  state: CanvasRenderState,
  ditheredBuffer: Uint8Array | null,
  gfxMode: ResolvedGfxMode
): void {
  let terminalWidth = Math.min(data.propsWidth, bounds.width);
  const terminalHeight = Math.min(data.propsHeight, bounds.height);

  // Workaround for terminal edge rendering glitch
  const engine = globalThis.melkerEngine;
  if (engine && bounds.x + terminalWidth >= engine.terminalSize?.width) {
    terminalWidth = Math.max(1, terminalWidth - 1);
  }

  // Sixel mode: fill with placeholder, actual sixel output is handled by engine overlay
  // Use same dimensions as other modes (min of props and bounds)
  if (gfxMode === 'sixel') {
    renderSixelPlaceholder(bounds, style, buffer, terminalWidth, terminalHeight, data);
    return;
  }

  // Kitty mode: fill with placeholder, actual kitty output is handled by engine overlay
  if (gfxMode === 'kitty') {
    renderKittyPlaceholder(bounds, style, buffer, terminalWidth, terminalHeight, data);
    return;
  }

  // iTerm2 mode: fill with placeholder, actual iTerm2 output is handled by engine overlay
  if (gfxMode === 'iterm2') {
    renderITermPlaceholder(bounds, style, buffer, terminalWidth, terminalHeight, data);
    return;
  }

  // Check for dithered rendering mode
  if (ditheredBuffer) {
    renderDitheredToTerminal(bounds, style, buffer, ditheredBuffer, gfxMode, data, state);
    return;
  }

  // Block mode: 1 colored space per cell instead of sextant characters
  if (gfxMode === 'block') {
    renderBlockMode(bounds, style, buffer, terminalWidth, terminalHeight, data);
    return;
  }

  // ASCII mode: pattern (spatial mapping) or luma (brightness-based)
  if (gfxMode === 'pattern' || gfxMode === 'luma') {
    renderAsciiMode(bounds, style, buffer, terminalWidth, terminalHeight, gfxMode, data);
    return;
  }

  // Default: sextant rendering
  renderSextantToTerminal(bounds, style, buffer, data, state);
}

/** Graphics rendering mode (user-facing, includes 'hires' auto-select) */
export type GfxMode = 'sextant' | 'block' | 'pattern' | 'luma' | 'sixel' | 'kitty' | 'iterm2' | 'hires';

/** Resolved graphics mode (after 'hires' is expanded to actual mode) */
export type ResolvedGfxMode = 'sextant' | 'block' | 'pattern' | 'luma' | 'sixel' | 'kitty' | 'iterm2';

/**
 * Get effective graphics mode from config and props.
 * Falls back to sextant if sixel/kitty/iterm2 is requested but not available.
 */
export function getEffectiveGfxMode(
  propsGfxMode?: GfxMode
): ResolvedGfxMode {
  const globalGfxMode = MelkerConfig.get().gfxMode as GfxMode | undefined;
  const requested = globalGfxMode || propsGfxMode || 'sextant';

  const engine = globalThis.melkerEngine;
  const kittySupported = engine?.kittyCapabilities?.supported ?? false;
  const sixelSupported = engine?.sixelCapabilities?.supported ?? false;
  const itermSupported = engine?.itermCapabilities?.supported ?? false;

  // hires: try kitty → sixel → iterm2 → sextant (best available high-resolution mode)
  if (requested === 'hires') {
    if (kittySupported) {
      return 'kitty';
    }
    if (sixelSupported) {
      return 'sixel';
    }
    if (itermSupported) {
      return 'iterm2';
    }
    return 'sextant';
  }

  // kitty: falls back directly to sextant
  if (requested === 'kitty') {
    if (!kittySupported) {
      return 'sextant';
    }
    return 'kitty';
  }

  // sixel: falls back to sextant
  if (requested === 'sixel') {
    if (!sixelSupported) {
      return 'sextant';
    }
    return 'sixel';
  }

  // iterm2: falls back to sextant
  if (requested === 'iterm2') {
    if (!itermSupported) {
      return 'sextant';
    }
    return 'iterm2';
  }

  return requested;
}
